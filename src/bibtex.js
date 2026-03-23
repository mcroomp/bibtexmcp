/**
 * BibTeX file I/O layer built on @retorquere/bibtex-parser.
 *
 * Uses verbatimFields (match-all regex) so ALL field values are kept as raw strings,
 * making the representation suitable for round-trip editing.
 *
 * Internal entry shape:
 *   { type: string, key: string, fields: Record<string, string> }
 */

import { readFile, writeFile, rename, unlink, stat } from 'fs/promises';
import { parse } from '@retorquere/bibtex-parser';

const VERBATIM_ALL = { verbatimFields: [new RegExp('.*')] };

// ---------------------------------------------------------------------------
// Parse / serialize
// ---------------------------------------------------------------------------

/**
 * Parse a BibTeX string.
 * Returns { entries, strings, comments, errors, preamble }.
 * All field values in entries are raw strings.
 */
export function parseBib(src) {
  return parse(src, VERBATIM_ALL);
}

/**
 * Read and parse a .bib file.
 * Returns the parsed result plus a `mtime` field (ms since epoch) captured
 * before the read, so it can be passed back to saveBib as a concurrency guard.
 */
export async function loadBib(filePath) {
  // Stat before read: if a concurrent writer modifies the file between our
  // stat and our read we'll have an older mtime than the current file, which
  // causes saveBib to reject our stale view — the safe direction to err.
  const { mtimeMs } = await stat(filePath);
  const src = await readFile(filePath, 'utf8');
  const result = parseBib(src);
  result.mtime = mtimeMs;
  return result;
}

/**
 * Serialize entries (and optional @string macros) to a BibTeX string.
 * @param {Array}  entries  Array of { type, key, fields }
 * @param {Record} strings  Optional @string macros { name: value }
 */
export function serializeBib(entries, strings = {}) {
  const parts = [];

  for (const [name, value] of Object.entries(strings)) {
    parts.push(`@string{${name} = {${value}}}`);
  }

  for (const entry of entries) {
    const fieldLines = Object.entries(entry.fields)
      .map(([name, value]) => `  ${name} = ${braceWrap(value)}`)
      .join(',\n');
    parts.push(`@${entry.type}{${entry.key},\n${fieldLines}\n}`);
  }

  return parts.join('\n\n') + '\n';
}

/**
 * Write entries back to a .bib file.
 *
 * Uses an atomic write: content is written to a sibling `.tmp` file first,
 * then renamed over the target in a single filesystem operation so readers
 * never see a partially-written file.
 *
 * If `expectedMtime` is provided (the value returned by loadBib), the file's
 * current mtime is checked before the write.  A mismatch means another process
 * modified the file after we read it; the write is aborted with an error.
 * Pass `null` (or omit) to skip the check, e.g. when creating a new file.
 */
export async function saveBib(filePath, entries, strings = {}, expectedMtime = null) {
  if (expectedMtime !== null) {
    const { mtimeMs } = await stat(filePath);
    if (mtimeMs !== expectedMtime) {
      throw new Error(
        `"${filePath}" was modified by another process while this operation was in progress — ` +
        `aborting to avoid overwriting changes. Re-read the file and retry.`
      );
    }
  }

  const content = serializeBib(entries, strings);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(tmpPath, content, 'utf8');
    await rename(tmpPath, filePath);
  } catch (e) {
    try { await unlink(tmpPath); } catch { /* ignore cleanup failure */ }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Entry helpers (pure — return new objects, never mutate)
// ---------------------------------------------------------------------------

/** Find an entry by key (case-insensitive). Returns entry or null. */
export function findEntry(entries, key) {
  return entries.find(e => e.key.toLowerCase() === key.toLowerCase()) ?? null;
}

/** Get a raw field value from an entry. Returns string or null. */
export function getField(entry, fieldName) {
  return entry.fields[fieldName.toLowerCase()] ?? null;
}

/** Return a new entry with the given field set to value. */
export function setField(entry, fieldName, value) {
  return {
    ...entry,
    fields: { ...entry.fields, [fieldName.toLowerCase()]: String(value) },
  };
}

/** Return a new entry with the given field removed. */
export function removeField(entry, fieldName) {
  const fields = { ...entry.fields };
  delete fields[fieldName.toLowerCase()];
  return { ...entry, fields };
}

/** Return a new entries array with the matching entry replaced. */
export function replaceEntry(entries, key, newEntry) {
  return entries.map(e =>
    e.key.toLowerCase() === key.toLowerCase() ? newEntry : e
  );
}

/** Return a new entries array with the entry removed. */
export function deleteEntry(entries, key) {
  return entries.filter(e => e.key.toLowerCase() !== key.toLowerCase());
}

/** Return a new entries array with a new entry appended. */
export function addEntry(entries, entry) {
  return [...entries, entry];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a value in braces unless it is already wrapped or a bare integer.
 */
function braceWrap(value) {
  if (value === undefined || value === null) return '{}';
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return s;
  if ((s.startsWith('{') && s.endsWith('}')) ||
      (s.startsWith('"') && s.endsWith('"'))) return s;
  return `{${s}}`;
}
