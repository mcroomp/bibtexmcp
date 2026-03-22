/**
 * BibTeX file I/O layer built on @retorquere/bibtex-parser.
 *
 * Uses verbatimFields (match-all regex) so ALL field values are kept as raw strings,
 * making the representation suitable for round-trip editing.
 *
 * Internal entry shape:
 *   { type: string, key: string, fields: Record<string, string> }
 */

import { readFile, writeFile } from 'fs/promises';
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

/** Read and parse a .bib file. */
export async function loadBib(filePath) {
  const src = await readFile(filePath, 'utf8');
  return parseBib(src);
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

/** Write entries back to a .bib file (replaces file contents). */
export async function saveBib(filePath, entries, strings = {}) {
  await writeFile(filePath, serializeBib(entries, strings), 'utf8');
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
