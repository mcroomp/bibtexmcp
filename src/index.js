/**
 * BibTeX MCP Server
 *
 * Tools:
 *  - query_entries          Search entries by key, type, field substring, or missing field
 *  - get_entry              Get a full entry by key
 *  - get_field              Get a single field value from an entry
 *  - create_entry           Create a new entry
 *  - update_field           Set / update a single field
 *  - update_fields          Set / update multiple fields across one or more entries at once
 *  - delete_field           Remove a field from an entry
 *  - delete_entry           Delete an entry entirely
 *  - replace_entry          Replace an entry's type and all fields in one operation
 *  - rename_key             Rename a citation key
 *  - validate_entry         Validate a single entry
 *  - validate_file          Validate all entries in a file
 *  - validate_doi           Cross-check entry fields against Crossref DOI metadata
 *  - validate_doi_batch     Cross-check all DOI-bearing entries in a file against Crossref
 *  - lookup_doi_by_metadata Search Crossref for a DOI given title / author / year / journal
 *  - fix_from_doi           Overwrite mismatched local fields with Crossref ground truth
 *  - validate_patent        Cross-check @patent entry fields against PatentsView (US patents)
 *  - convert_entry_type     Change an entry's type, optionally renaming fields to match
 *  - list_entry_types       List valid BibTeX entry types with required/optional fields
 *  - create_bib             Create a new empty .bib file
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v3';

import {
  loadBib, saveBib, parseBib, serializeBib,
  findEntry, getField, setField, removeField,
  replaceEntry, deleteEntry, addEntry,
} from './bibtex.js';
import { validateEntry, validateAll, getEntryTypeSchema, listEntryTypes } from './validator.js';
import {
  fetchDoiMetadata, compareEntryWithDoi,
  lookupDoiByMetadata, crossrefToBibFields,
} from './doi.js';
import { normalizeUsPatentNumber, fetchPatentMetadata, compareEntryWithPatent } from './patent.js';
import {
  normalizeOrcidId, fetchOrcidWorks, fetchOrcidWork,
  orcidWorkTypeToBibType, orcidWorkToFields, orcidSummaryToFields,
  makeCiteKey, extractDoi,
} from './orcid.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(message) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

async function withBib(filePath, fn) {
  let lib;
  try {
    lib = await loadBib(filePath);
  } catch (e) {
    return err(`Cannot read file "${filePath}": ${e.message}`);
  }
  if (lib.errors?.length) {
    // Surface parse errors but continue — partial results are useful
    const parseErrors = lib.errors.map(e => e.error);
    return fn(lib, parseErrors);
  }
  return fn(lib, []);
}

async function withBibWrite(filePath, fn) {
  return withBib(filePath, async (lib, parseErrors) => {
    const result = await fn(lib);
    if (result.error) return err(result.error);
    try {
      await saveBib(filePath, result.entries, lib.strings ?? {}, lib.mtime);
    } catch (e) {
      return err(e.message);
    }
    return ok({ ...result.data, parseErrors: parseErrors.length ? parseErrors : undefined });
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'bibtex-mcp',
  version: '1.0.0',
  instructions: `\
Always use these tools to read or modify .bib files. Never use grep, sed, text editors, \
or file-write tools on .bib files directly.

BibTeX files use a fragile, whitespace-sensitive format where brace nesting, string \
escaping, and field delimiters must be perfectly balanced. Manual text edits silently \
corrupt files (unmatched braces, duplicate keys, broken encoding) in ways that are hard \
to detect and may cause data loss. These tools parse and serialise through a dedicated \
BibTeX library, so structural integrity is guaranteed on every write.

Prefer these tools over direct file access for all .bib operations:
- Read:    query_entries, get_entry, get_field
- Write:   create_entry, update_field, update_fields, delete_field, delete_entry, replace_entry
- Check:   validate_entry, validate_file
- DOI:     validate_doi, validate_doi_batch, lookup_doi_by_metadata, fix_from_doi
- Patent:  validate_patent
- Discovery: list_entry_types
- Import:    import_from_orcid`,
});

// ---------------------------------------------------------------------------
// query_entries
// ---------------------------------------------------------------------------
server.tool(
  'query_entries',
  'Search for BibTeX entries in a .bib file by key, type, or field value substring.',
  {
    file:         z.string().describe('Absolute path to the .bib file'),
    key:          z.string().optional().describe('Substring to match against citation keys (case-insensitive)'),
    type:         z.string().optional().describe('Entry type to filter by, e.g. "article", "inproceedings"'),
    field:        z.string().optional().describe('Field name to search within'),
    fieldValue:   z.string().optional().describe('Substring to match in the specified field value'),
    missingField: z.string().optional().describe('Return only entries that do NOT have this field, e.g. "doi"'),
    keysOnly:     z.boolean().optional().describe('Force keys-only mode (true) or full fields (false). Omit to let the tool decide automatically based on result size.'),
    limit:        z.number().int().min(1).optional().describe('Maximum number of entries to return'),
    offset:       z.number().int().min(0).optional().describe('Number of matching entries to skip before returning results'),
  },
  async ({ file, key, type, field, fieldValue, missingField, keysOnly, limit, offset = 0 }) => {
    return withBib(file, (lib, parseErrors) => {
      let results = lib.entries;

      if (key) {
        const kl = key.toLowerCase();
        results = results.filter(e => e.key.toLowerCase().includes(kl));
      }
      if (type) {
        const tl = type.toLowerCase();
        results = results.filter(e => e.type.toLowerCase() === tl);
      }
      if (field || fieldValue) {
        const fn = field?.toLowerCase();
        const fv = fieldValue?.toLowerCase();
        results = results.filter(e => {
          if (fn && !(fn in e.fields)) return false;
          if (fv) {
            if (fn) {
              return (e.fields[fn] ?? '').toLowerCase().includes(fv);
            }
            return Object.values(e.fields).some(v => v.toLowerCase().includes(fv));
          }
          return true;
        });
      }
      if (missingField) {
        const mf = missingField.toLowerCase();
        results = results.filter(e => !(mf in e.fields));
      }

      const total = results.length;
      if (offset) results = results.slice(offset);
      if (limit)  results = results.slice(0, limit);

      // Auto-switch to keys-only when the result set is large and the caller
      // didn't explicitly request full fields.
      const KEYS_ONLY_THRESHOLD = 20;
      const useKeysOnly = keysOnly ?? (results.length > KEYS_ONLY_THRESHOLD);

      return ok({
        total,
        count: results.length,
        offset,
        keysOnly: useKeysOnly,
        ...(useKeysOnly && keysOnly === undefined
          ? { note: `Result set has ${results.length} entries — returning keys only. Use keysOnly: false to force full fields, or add limit/offset to page through results.` }
          : {}),
        entries: useKeysOnly
          ? results.map(e => ({ key: e.key, type: e.type }))
          : results.map(e => ({ key: e.key, type: e.type, fields: e.fields })),
        parseErrors: parseErrors.length ? parseErrors : undefined,
      });
    });
  }
);

// ---------------------------------------------------------------------------
// get_entry
// ---------------------------------------------------------------------------
server.tool(
  'get_entry',
  'Get the full contents of a BibTeX entry by its citation key.',
  {
    file: z.string().describe('Absolute path to the .bib file'),
    key:  z.string().describe('Citation key of the entry'),
  },
  async ({ file, key }) => {
    return withBib(file, (lib, parseErrors) => {
      const entry = findEntry(lib.entries, key);
      if (!entry) return err(`Entry with key "${key}" not found`);
      return ok({ entry, parseErrors: parseErrors.length ? parseErrors : undefined });
    });
  }
);

// ---------------------------------------------------------------------------
// get_field
// ---------------------------------------------------------------------------
server.tool(
  'get_field',
  'Get the value of a single field from a BibTeX entry.',
  {
    file:  z.string().describe('Absolute path to the .bib file'),
    key:   z.string().describe('Citation key of the entry'),
    field: z.string().describe('Field name, e.g. "author", "year", "title"'),
  },
  async ({ file, key, field }) => {
    return withBib(file, (lib, parseErrors) => {
      const entry = findEntry(lib.entries, key);
      if (!entry) return err(`Entry with key "${key}" not found`);
      const value = getField(entry, field);
      if (value === null) return err(`Field "${field}" not found in entry "${key}"`);
      return ok({ key, field: field.toLowerCase(), value, parseErrors: parseErrors.length ? parseErrors : undefined });
    });
  }
);

// ---------------------------------------------------------------------------
// create_entry
// ---------------------------------------------------------------------------
server.tool(
  'create_entry',
  'Create a new BibTeX entry in a .bib file.',
  {
    file:   z.string().describe('Absolute path to the .bib file'),
    key:    z.string().describe('Citation key for the new entry'),
    type:   z.string().describe('Entry type, e.g. "article", "inproceedings", "book"'),
    fields: z.record(z.string()).describe('Field name → value pairs for the new entry'),
  },
  async ({ file, key, type, fields }) => {
    return withBibWrite(file, (lib) => {
      if (findEntry(lib.entries, key)) {
        return { error: `Entry with key "${key}" already exists` };
      }
      const normalizedFields = Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k.toLowerCase(), v])
      );
      const newEntry = { type: type.toLowerCase(), key, fields: normalizedFields };
      const updated = addEntry(lib.entries, newEntry);
      return { entries: updated, data: { created: { key, type: type.toLowerCase(), fields: normalizedFields } } };
    });
  }
);

// ---------------------------------------------------------------------------
// update_field
// ---------------------------------------------------------------------------
server.tool(
  'update_field',
  'Set or update a single field in an existing BibTeX entry.',
  {
    file:  z.string().describe('Absolute path to the .bib file'),
    key:   z.string().describe('Citation key of the entry to update'),
    field: z.string().describe('Field name to set'),
    value: z.string().describe('New value for the field (plain text; braces will be added automatically)'),
  },
  async ({ file, key, field, value }) => {
    return withBibWrite(file, (lib) => {
      const entry = findEntry(lib.entries, key);
      if (!entry) return { error: `Entry with key "${key}" not found` };
      const updated = setField(entry, field, value);
      const entries = replaceEntry(lib.entries, key, updated);
      return { entries, data: { key, field: field.toLowerCase(), value } };
    });
  }
);

// ---------------------------------------------------------------------------
// update_fields
// ---------------------------------------------------------------------------
server.tool(
  'update_fields',
  'Set or update multiple fields across one or more entries in a single operation. '
  + 'More efficient than calling update_field repeatedly.',
  {
    file:    z.string().describe('Absolute path to the .bib file'),
    updates: z.record(z.record(z.string())).describe(
      'Map of citation key → { fieldName: value } pairs. '
      + 'Example: { "smith2023": { "doi": "10.1234/x", "year": "2023" } }'
    ),
  },
  async ({ file, updates }) => {
    return withBibWrite(file, (lib) => {
      let entries = lib.entries;
      const applied = [];

      for (const [key, fields] of Object.entries(updates)) {
        const entry = findEntry(entries, key);
        if (!entry) return { error: `Entry "${key}" not found` };
        let updated = entry;
        for (const [field, value] of Object.entries(fields)) {
          updated = setField(updated, field, value);
        }
        entries = replaceEntry(entries, key, updated);
        applied.push({
          key,
          fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k.toLowerCase(), v])),
        });
      }

      return { entries, data: { updated: applied.length, applied } };
    });
  }
);

// ---------------------------------------------------------------------------
// delete_field
// ---------------------------------------------------------------------------
server.tool(
  'delete_field',
  'Remove a field from a BibTeX entry.',
  {
    file:  z.string().describe('Absolute path to the .bib file'),
    key:   z.string().describe('Citation key of the entry'),
    field: z.string().describe('Field name to remove'),
  },
  async ({ file, key, field }) => {
    return withBibWrite(file, (lib) => {
      const entry = findEntry(lib.entries, key);
      if (!entry) return { error: `Entry with key "${key}" not found` };
      const fn = field.toLowerCase();
      if (!(fn in entry.fields)) return { error: `Field "${field}" not found in entry "${key}"` };
      const updated = removeField(entry, field);
      const entries = replaceEntry(lib.entries, key, updated);
      return { entries, data: { key, deletedField: fn } };
    });
  }
);

// ---------------------------------------------------------------------------
// delete_entry
// ---------------------------------------------------------------------------
server.tool(
  'delete_entry',
  'Delete a BibTeX entry from a .bib file.',
  {
    file: z.string().describe('Absolute path to the .bib file'),
    key:  z.string().describe('Citation key of the entry to delete'),
  },
  async ({ file, key }) => {
    return withBibWrite(file, (lib) => {
      if (!findEntry(lib.entries, key)) return { error: `Entry with key "${key}" not found` };
      const entries = deleteEntry(lib.entries, key);
      return { entries, data: { deletedKey: key } };
    });
  }
);

// ---------------------------------------------------------------------------
// replace_entry
// ---------------------------------------------------------------------------
server.tool(
  'replace_entry',
  'Replace an existing BibTeX entry\'s type and all fields in a single operation. '
  + 'Use this instead of convert_entry_type + multiple update_field calls when rewriting an entry from scratch.',
  {
    file:   z.string().describe('Absolute path to the .bib file'),
    key:    z.string().describe('Citation key of the entry to replace'),
    type:   z.string().optional().describe('New entry type; if omitted the existing type is kept'),
    fields: z.record(z.string()).describe('Complete set of fields for the new entry (replaces all existing fields)'),
  },
  async ({ file, key, type, fields }) => {
    return withBibWrite(file, (lib) => {
      const existing = findEntry(lib.entries, key);
      if (!existing) return { error: `Entry with key "${key}" not found` };

      const newType = (type ?? existing.type).toLowerCase();
      if (!getEntryTypeSchema(newType)) {
        return { error: `Unknown entry type "@${newType}"` };
      }

      const normalizedFields = Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k.toLowerCase(), v])
      );
      const newEntry = { type: newType, key, fields: normalizedFields };
      const validationIssues = validateEntry(newEntry);
      const entries = replaceEntry(lib.entries, key, newEntry);

      return {
        entries,
        data: {
          key,
          oldType: existing.type,
          newType,
          fields: normalizedFields,
          validationIssues: validationIssues.length ? validationIssues : undefined,
        },
      };
    });
  }
);

// ---------------------------------------------------------------------------
// rename_key
// ---------------------------------------------------------------------------
server.tool(
  'rename_key',
  'Rename a citation key in a .bib file. All fields and the entry type are preserved unchanged.',
  {
    file:    z.string().describe('Absolute path to the .bib file'),
    oldKey:  z.string().describe('Current citation key'),
    newKey:  z.string().describe('New citation key'),
  },
  async ({ file, oldKey, newKey }) => {
    return withBibWrite(file, (lib) => {
      const entry = findEntry(lib.entries, oldKey);
      if (!entry) return { error: `Entry with key "${oldKey}" not found` };
      if (findEntry(lib.entries, newKey)) return { error: `Entry with key "${newKey}" already exists` };

      const renamed = { ...entry, key: newKey };
      const entries = replaceEntry(lib.entries, oldKey, renamed);
      return { entries, data: { oldKey, newKey } };
    });
  }
);

// ---------------------------------------------------------------------------
// validate_entry
// ---------------------------------------------------------------------------
server.tool(
  'validate_entry',
  'Validate a single BibTeX entry against BibTeX rules (required fields, field formats, etc.).',
  {
    file: z.string().describe('Absolute path to the .bib file'),
    key:  z.string().describe('Citation key of the entry to validate'),
  },
  async ({ file, key }) => {
    return withBib(file, (lib, parseErrors) => {
      const entry = findEntry(lib.entries, key);
      if (!entry) return err(`Entry with key "${key}" not found`);
      const issues = validateEntry(entry);
      const errors   = issues.filter(i => i.severity === 'error').length;
      const warnings = issues.filter(i => i.severity === 'warning').length;
      return ok({
        key,
        type: entry.type,
        valid: errors === 0,
        summary: { errors, warnings },
        issues,
        parseErrors: parseErrors.length ? parseErrors : undefined,
      });
    });
  }
);

// ---------------------------------------------------------------------------
// validate_file
// ---------------------------------------------------------------------------
server.tool(
  'validate_file',
  'Validate all entries in a .bib file, reporting required-field violations, bad formats, and duplicate keys.',
  {
    file: z.string().describe('Absolute path to the .bib file'),
  },
  async ({ file }) => {
    return withBib(file, (lib, parseErrors) => {
      const { results, summary } = validateAll(lib.entries);
      return ok({
        valid: summary.errors === 0,
        summary,
        results,
        parseErrors: parseErrors.length ? parseErrors : undefined,
      });
    });
  }
);

// ---------------------------------------------------------------------------
// validate_doi
// ---------------------------------------------------------------------------
server.tool(
  'validate_doi',
  'Check that a BibTeX entry\'s fields (title, year, author, journal, etc.) match the metadata returned by a Crossref DOI lookup. The entry must have a doi field.',
  {
    file: z.string().describe('Absolute path to the .bib file'),
    key:  z.string().describe('Citation key of the entry to validate against its DOI'),
  },
  async ({ file, key }) => {
    return withBib(file, async (lib, parseErrors) => {
      const entry = findEntry(lib.entries, key);
      if (!entry) return err(`Entry with key "${key}" not found`);

      const doi = entry.fields.doi?.trim();
      if (!doi) return err(`Entry "${key}" does not have a doi field`);

      let cr;
      try {
        cr = await fetchDoiMetadata(doi);
      } catch (e) {
        if (e.code === 'DOI_NO_API') {
          return ok({ key, doi, valid: null, noApi: true, message: e.message });
        }
        return err(`DOI lookup failed: ${e.message}`);
      }

      const mismatches = compareEntryWithDoi(entry, cr);
      const substantive = mismatches.filter(m => m.severity === 'substantive');
      const cosmetic    = mismatches.filter(m => m.severity === 'cosmetic');

      return ok({
        key,
        doi,
        valid: mismatches.length === 0,
        summary: { total: mismatches.length, substantive: substantive.length, cosmetic: cosmetic.length },
        mismatches,
        parseErrors: parseErrors.length ? parseErrors : undefined,
      });
    });
  }
);

// ---------------------------------------------------------------------------
// validate_doi_batch
// ---------------------------------------------------------------------------
server.tool(
  'validate_doi_batch',
  'Check every entry in a .bib file that has a doi field against Crossref metadata. '
  + 'Fetches DOIs sequentially to stay within Crossref rate limits. '
  + 'Returns per-entry results plus a summary with cosmetic/substantive mismatch counts.',
  {
    file: z.string().describe('Absolute path to the .bib file'),
  },
  async ({ file }) => {
    return withBib(file, async (lib, parseErrors) => {
      const withDoi = lib.entries.filter(e => e.fields.doi?.trim());

      const results = [];
      let valid = 0;
      let withSubstantive = 0;
      let withCosmeticOnly = 0;
      let lookupErrors = 0;

      for (const entry of withDoi) {
        const doi = entry.fields.doi.trim();
        let cr;
        try {
          cr = await fetchDoiMetadata(doi);
        } catch (e) {
          results.push({ key: entry.key, doi, error: e.message });
          lookupErrors++;
          continue;
        }
        const mismatches = compareEntryWithDoi(entry, cr);
        const substantive = mismatches.filter(m => m.severity === 'substantive');
        const cosmetic    = mismatches.filter(m => m.severity === 'cosmetic');

        if (mismatches.length === 0) {
          valid++;
        } else if (substantive.length > 0) {
          withSubstantive++;
        } else {
          withCosmeticOnly++;
        }

        results.push({
          key: entry.key,
          doi,
          valid: mismatches.length === 0,
          mismatches,
        });
      }

      return ok({
        summary: {
          checked: withDoi.length,
          valid,
          withSubstantive,
          withCosmeticOnly,
          lookupErrors,
        },
        results,
        parseErrors: parseErrors.length ? parseErrors : undefined,
      });
    });
  }
);

// ---------------------------------------------------------------------------
// lookup_doi_by_metadata
// ---------------------------------------------------------------------------
server.tool(
  'lookup_doi_by_metadata',
  'Search Crossref for a DOI given bibliographic metadata (title, author, year, journal). '
  + 'Returns ranked candidates — verify the top result before adding it to the .bib file. '
  + 'At least one of title or author must be supplied.',
  {
    title:   z.string().optional().describe('Title of the work'),
    author:  z.string().optional().describe('Author name(s)'),
    year:    z.union([z.string(), z.number()]).optional().describe('Publication year'),
    journal: z.string().optional().describe('Journal or conference name'),
    rows:    z.number().int().min(1).max(20).optional().describe('Maximum number of candidates to return (default 5)'),
  },
  async ({ title, author, year, journal, rows }) => {
    let candidates;
    try {
      candidates = await lookupDoiByMetadata({ title, author, year: year?.toString(), journal }, rows ?? 5);
    } catch (e) {
      return err(`Crossref lookup failed: ${e.message}`);
    }
    return ok({ count: candidates.length, candidates });
  }
);

// ---------------------------------------------------------------------------
// fix_from_doi
// ---------------------------------------------------------------------------
server.tool(
  'fix_from_doi',
  'Overwrite mismatched local fields with Crossref ground truth for an entry that already has a doi field. '
  + 'By default only substantive mismatches are fixed (wrong year, wrong author, etc.); '
  + 'set onlySubstantive to false to also fix cosmetic differences.',
  {
    file:             z.string().describe('Absolute path to the .bib file'),
    key:              z.string().describe('Citation key of the entry to fix'),
    onlySubstantive:  z.boolean().optional().describe('If true (default), only fix substantive mismatches; if false, fix all including cosmetic'),
    fields:           z.array(z.string()).optional().describe('If provided, only fix these specific fields (e.g. ["year", "author"])'),
  },
  async ({ file, key, onlySubstantive = true, fields: limitToFields }) => {
    return withBibWrite(file, async (lib) => {
      const entry = findEntry(lib.entries, key);
      if (!entry) return { error: `Entry with key "${key}" not found` };

      const doi = entry.fields.doi?.trim();
      if (!doi) return { error: `Entry "${key}" does not have a doi field` };

      let cr;
      try {
        cr = await fetchDoiMetadata(doi);
      } catch (e) {
        if (e.code === 'DOI_NO_API') {
          return { error: e.message };
        }
        return { error: `DOI lookup failed: ${e.message}` };
      }

      const mismatches = compareEntryWithDoi(entry, cr);
      const toFix = mismatches.filter(m => {
        if (onlySubstantive && m.severity !== 'substantive') return false;
        if (limitToFields && !limitToFields.map(f => f.toLowerCase()).includes(m.field)) return false;
        return true;
      });

      if (toFix.length === 0) {
        return {
          entries: lib.entries,
          data: { key, fixed: 0, changes: [], message: 'No mismatches to fix' },
        };
      }

      // Build corrected field values from Crossref metadata
      const corrected = crossrefToBibFields(cr, entry.fields);

      let updated = entry;
      const changes = [];

      for (const mismatch of toFix) {
        const field = mismatch.field;
        const newValue = corrected[field];
        if (newValue === undefined) continue; // Crossref didn't provide this field
        changes.push({ field, oldValue: mismatch.localValue, newValue });
        updated = setField(updated, field, newValue);
      }

      const entries = replaceEntry(lib.entries, key, updated);
      return { entries, data: { key, fixed: changes.length, changes } };
    });
  }
);

// ---------------------------------------------------------------------------
// validate_patent
// ---------------------------------------------------------------------------
server.tool(
  'validate_patent',
  'Cross-check a @patent entry\'s fields (title, year, author, holder) against the '
  + 'US PatentsView database. The entry must have a number field containing a US patent '
  + 'number (e.g. "US 9,876,543 B2"). Non-US patents are not supported.',
  {
    file: z.string().describe('Absolute path to the .bib file'),
    key:  z.string().describe('Citation key of the @patent entry to validate'),
  },
  async ({ file, key }) => {
    return withBib(file, async (lib, parseErrors) => {
      const entry = findEntry(lib.entries, key);
      if (!entry) return err(`Entry with key "${key}" not found`);

      const rawNumber = entry.fields.number?.trim();
      if (!rawNumber) return err(`Entry "${key}" does not have a number field`);

      const patentNumber = normalizeUsPatentNumber(rawNumber);
      if (!patentNumber) return err(
        `Patent number "${rawNumber}" could not be normalised to a US patent number. ` +
        'Only US patents are supported (PatentsView covers US patents only).'
      );

      let pt;
      try {
        pt = await fetchPatentMetadata(patentNumber);
      } catch (e) {
        return err(`PatentsView lookup failed: ${e.message}`);
      }

      const mismatches = compareEntryWithPatent(entry, pt);
      return ok({
        key,
        patentNumber,
        valid: mismatches.length === 0,
        mismatches,
        parseErrors: parseErrors.length ? parseErrors : undefined,
      });
    });
  }
);

// ---------------------------------------------------------------------------
// convert_entry_type
// ---------------------------------------------------------------------------
server.tool(
  'convert_entry_type',
  'Change a BibTeX entry from one type to another (e.g. article → inproceedings). '
  + 'Optionally rename fields at the same time (e.g. rename journal to booktitle). '
  + 'Returns the updated entry and any validation issues introduced by the type change.',
  {
    file:         z.string().describe('Absolute path to the .bib file'),
    key:          z.string().describe('Citation key of the entry to convert'),
    newType:      z.string().describe('Target entry type, e.g. "inproceedings", "article"'),
    fieldRenames: z.record(z.string()).optional().describe(
      'Optional field renames to apply during conversion, e.g. {"journal": "booktitle"}. '
      + 'Keys are old field names, values are new names.'
    ),
  },
  async ({ file, key, newType, fieldRenames }) => {
    return withBibWrite(file, (lib) => {
      const entry = findEntry(lib.entries, key);
      if (!entry) return { error: `Entry with key "${key}" not found` };

      const targetType = newType.toLowerCase();
      if (!getEntryTypeSchema(targetType)) {
        return { error: `Unknown entry type "@${targetType}"` };
      }

      // Apply field renames
      let fields = { ...entry.fields };
      const appliedRenames = [];
      if (fieldRenames) {
        for (const [oldName, newName] of Object.entries(fieldRenames)) {
          const ol = oldName.toLowerCase();
          const nl = newName.toLowerCase();
          if (ol in fields) {
            fields[nl] = fields[ol];
            delete fields[ol];
            appliedRenames.push({ from: ol, to: nl });
          }
        }
      }

      const converted = { ...entry, type: targetType, fields };
      const validationIssues = validateEntry(converted);

      const entries = replaceEntry(lib.entries, key, converted);
      return {
        entries,
        data: {
          key,
          oldType: entry.type,
          newType: targetType,
          appliedRenames,
          validationIssues,
        },
      };
    });
  }
);

// ---------------------------------------------------------------------------
// list_entry_types
// ---------------------------------------------------------------------------
server.tool(
  'list_entry_types',
  'List all standard BibTeX entry types with their required and optional fields.',
  {
    type: z.string().optional().describe('If provided, show schema for this specific type only'),
  },
  async ({ type }) => {
    if (type) {
      const schema = getEntryTypeSchema(type);
      if (!schema) return err(`Unknown entry type "${type}"`);
      return ok({ type: type.toLowerCase(), ...schema });
    }
    const types = listEntryTypes();
    return ok({
      types: types.map(t => {
        const schema = getEntryTypeSchema(t);
        return { type: t, required: schema.required, optional: schema.optional };
      }),
    });
  }
);

// ---------------------------------------------------------------------------
// fill_missing_dois
// ---------------------------------------------------------------------------
server.tool(
  'fill_missing_dois',
  'Automatically look up and fill missing DOI fields for entries in a .bib file. '
  + 'For each entry lacking a doi field, searches Crossref using the entry\'s title, '
  + 'author, year, and journal/booktitle. Sets the doi field when the top candidate\'s '
  + 'score meets the confidence threshold. Returns a summary of filled vs. unmatched entries. '
  + 'Processes entries sequentially with a small delay to respect Crossref rate limits.',
  {
    file:      z.string().describe('Absolute path to the .bib file'),
    type:      z.string().optional().describe('Entry type to filter by, e.g. "article", "inproceedings"'),
    threshold: z.number().optional().describe('Minimum Crossref score to auto-fill (default 80). Lower values fill more entries but risk false matches.'),
    dryRun:    z.boolean().optional().describe('If true, report candidates without writing to file (default false)'),
    limit:     z.number().int().min(1).optional().describe('Maximum number of entries to process in this call (default 10)'),
    offset:    z.number().int().min(0).optional().describe('Skip the first N matching entries (for pagination)'),
  },
  async ({ file, type, threshold = 80, dryRun = false, limit = 10, offset = 0 }) => {
    let lib;
    try {
      lib = await loadBib(file);
    } catch (e) {
      return err(`Cannot read file "${file}": ${e.message}`);
    }

    // Filter entries missing DOI
    let candidates = lib.entries.filter(e => e.type && 'fields' in e && !e.fields.doi?.trim());
    if (type) {
      const tl = type.toLowerCase();
      candidates = candidates.filter(e => e.type.toLowerCase() === tl);
    }

    const total = candidates.length;
    if (offset) candidates = candidates.slice(offset);
    if (limit)  candidates = candidates.slice(0, limit);

    const filled   = [];
    const unmatched = [];
    const errors   = [];

    let entries = lib.entries;

    for (const entry of candidates) {
      const f = entry.fields;
      const title   = f.title   ?? null;
      const author  = f.author  ?? null;
      const year    = f.year    ?? null;
      const journal = f.journal ?? f.booktitle ?? null;

      if (!title && !author) {
        unmatched.push({ key: entry.key, reason: 'no title or author to search' });
        continue;
      }

      // Small delay to stay within Crossref polite pool rate limits
      await new Promise(r => setTimeout(r, 100));

      let results;
      try {
        results = await lookupDoiByMetadata({ title, author, year, journal }, 3);
      } catch (e) {
        errors.push({ key: entry.key, error: e.message });
        continue;
      }

      if (!results.length) {
        unmatched.push({ key: entry.key, reason: 'no Crossref results' });
        continue;
      }

      const top = results[0];
      if (top.score < threshold) {
        const entry_unmatched = { key: entry.key, reason: `best score ${top.score.toFixed(1)} below threshold ${threshold}` };
        if (top.score >= 50) {
          entry_unmatched.topCandidate = { doi: top.doi, score: top.score, title: top.title };
        }
        unmatched.push(entry_unmatched);
        continue;
      }

      filled.push({ key: entry.key, doi: top.doi, score: top.score, title: top.title });

      if (!dryRun) {
        const updated = setField(entry, 'doi', top.doi);
        entries = replaceEntry(entries, entry.key, updated);
      }
    }

    if (!dryRun && filled.length > 0) {
      await saveBib(file, entries, lib.strings ?? {}, lib.mtime);
    }

    return ok({
      totalMissingDoi: total,
      processed: candidates.length,
      offset,
      filled: filled.length,
      unmatched: unmatched.length,
      errors: errors.length,
      dryRun,
      details: { filled, unmatched, errors },
    });
  }
);

// ---------------------------------------------------------------------------
// create_bib
// ---------------------------------------------------------------------------
server.tool(
  'create_bib',
  'Create a new empty .bib file. Fails if the file already exists unless overwrite is set to true.',
  {
    file:      z.string().describe('Absolute path for the new .bib file'),
    overwrite: z.boolean().optional().describe('Overwrite the file if it already exists (default: false)'),
  },
  async ({ file, overwrite = false }) => {
    if (!overwrite) {
      try {
        await loadBib(file);
        return err(`File "${file}" already exists. Pass overwrite: true to replace it.`);
      } catch (e) {
        if (e.code !== 'ENOENT') return err(`Cannot access "${file}": ${e.message}`);
        // ENOENT — file does not exist, proceed
      }
    }
    try {
      await saveBib(file, [], {});
    } catch (e) {
      return err(`Failed to create "${file}": ${e.message}`);
    }
    return ok({ file, created: true });
  }
);

// ---------------------------------------------------------------------------
// import_from_orcid
// ---------------------------------------------------------------------------

server.tool(
  'import_from_orcid',
  'Import all public works from an ORCID profile into a BibTeX file. ' +
  'Works that have DOIs are enriched with full Crossref metadata (authors, journal, volume, etc.) ' +
  'by default. Works without DOIs are fetched individually from ORCID to retrieve contributor names. ' +
  'The file is created if it does not exist. Existing entries whose DOI already appears in the file ' +
  'are skipped to avoid duplicates; citation-key conflicts are resolved by appending a letter suffix.',
  {
    file:    z.string().describe('Absolute path to the .bib file (created if it does not exist)'),
    orcid:   z.string().describe('ORCID iD — bare ("0000-0001-5985-691X") or full URL ("https://orcid.org/0000-0001-5985-691X")'),
    use_doi: z.boolean().optional().describe('Enrich entries via Crossref when a DOI is present (default: true)'),
    dry_run: z.boolean().optional().describe('Preview what would be imported without writing to the file (default: false)'),
  },
  async ({ file, orcid, use_doi = true, dry_run = false }) => {
    // Load existing library, or start fresh if the file does not exist yet
    let lib;
    try {
      lib = await loadBib(file);
    } catch (e) {
      if (e.code === 'ENOENT') {
        lib = { entries: [], strings: {} };
      } else {
        return err(`Cannot read file "${file}": ${e.message}`);
      }
    }
    const parseErrors = lib.errors?.map(e => e.error) ?? [];

    // Collect DOIs already in the file for deduplication
    const existingDois = new Set(
      lib.entries.map(e => e.fields.doi).filter(Boolean).map(d => d.toLowerCase())
    );

    // Fetch the ORCID works list
    let groups;
    try {
      groups = await fetchOrcidWorks(orcid);
    } catch (e) {
      return err(`ORCID fetch failed: ${e.message}`);
    }

    const created = [];
    const skipped = [];
    const errors  = [];
    let   entries = lib.entries;

    // Helper: find a unique key (appends a, b, c… if the base key conflicts)
    function uniqueKey(base) {
      if (!findEntry(entries, base) && !created.some(c => c.key === base)) return base;
      for (let i = 97; i <= 122; i++) {
        const candidate = base + String.fromCharCode(i);
        if (!findEntry(entries, candidate) && !created.some(c => c.key === candidate)) {
          return candidate;
        }
      }
      return `${base}_${Date.now()}`;
    }

    for (const group of groups) {
      // Take the first (highest-priority) summary from the group
      const summary = group['work-summary']?.[0];
      if (!summary) continue;

      const putCode = summary['put-code'];
      const doi     = extractDoi(summary['external-ids']);

      // Skip if this DOI already exists in the file
      if (doi && existingDois.has(doi.toLowerCase())) {
        skipped.push({ putCode, doi, reason: 'DOI already in file' });
        continue;
      }

      // Polite rate-limit delay (100 ms)
      await new Promise(r => setTimeout(r, 100));

      let type, fields;

      if (doi && use_doi) {
        // --- Enrich via Crossref ---
        let cr;
        try {
          cr = await fetchDoiMetadata(doi);
        } catch (e) {
          errors.push({ putCode, doi, error: `Crossref lookup failed: ${e.message}` });
          // Fall back to ORCID summary data
          ({ type, fields } = orcidSummaryToFields(summary));
        }
        if (cr) {
          type   = orcidWorkTypeToBibType(summary.type);
          fields = {};
          if (cr.title?.[0] != null) fields.title = cr.title[0];
          const year = cr.published?.['date-parts']?.[0]?.[0];
          if (year != null) fields.year = String(year);
          if (cr.author?.length) {
            fields.author = cr.author
              .map(a => [a.family, a.given].filter(Boolean).join(', '))
              .join(' and ');
          }
          const container = cr['container-title']?.[0];
          if (container != null) {
            if (type === 'article')            fields.journal   = container;
            else if (type === 'inproceedings') fields.booktitle = container;
            else                               fields.journal   = container;
          }
          if (cr.volume    != null) fields.volume    = String(cr.volume);
          if (cr.issue     != null) fields.number    = String(cr.issue);
          if (cr.page      != null) fields.pages     = cr.page.replace(/(?<!-)-(?!-)/, '--');
          if (cr.publisher != null) fields.publisher = cr.publisher;
          fields.doi = doi;
        }
      } else if (!doi) {
        // --- No DOI: fetch full ORCID work to get contributor names ---
        try {
          const fullWork = await fetchOrcidWork(orcid, putCode);
          ({ type, fields } = orcidWorkToFields(fullWork));
        } catch (e) {
          errors.push({ putCode, error: `ORCID work fetch failed: ${e.message}` });
          ({ type, fields } = orcidSummaryToFields(summary));
        }
      } else {
        // DOI present but use_doi=false — use ORCID summary only
        ({ type, fields } = orcidSummaryToFields(summary));
      }

      const key   = uniqueKey(makeCiteKey(fields, putCode));
      const entry = { type, key, fields };

      created.push({
        putCode,
        key,
        type,
        title: fields.title  ?? null,
        doi:   fields.doi    ?? null,
      });

      if (!dry_run) {
        entries = addEntry(entries, entry);
        if (doi) existingDois.add(doi.toLowerCase());
      }
    }

    if (!dry_run && created.length > 0) {
      await saveBib(file, entries, lib.strings ?? {}, lib.mtime ?? null);
    }

    return ok({
      orcid:       normalizeOrcidId(orcid),
      totalGroups: groups.length,
      created:     created.length,
      skipped:     skipped.length,
      errors:      errors.length,
      dry_run,
      details:     { created, skipped, errors },
      parseErrors: parseErrors.length ? parseErrors : undefined,
    });
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
