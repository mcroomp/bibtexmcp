/**
 * BibTeX MCP Server
 *
 * Tools:
 *  - query_entries     Search entries by key, type, or field substring
 *  - get_entry         Get a full entry by key
 *  - get_field         Get a single field value from an entry
 *  - create_entry      Create a new entry
 *  - update_field      Set / update a single field
 *  - delete_field      Remove a field from an entry
 *  - delete_entry      Delete an entry entirely
 *  - validate_entry    Validate a single entry
 *  - validate_file     Validate all entries in a file
 *  - validate_doi      Cross-check entry fields against Crossref DOI metadata
 *  - validate_doi_batch Cross-check all DOI-bearing entries in a file against Crossref
 *  - convert_entry_type Change an entry's type, optionally renaming fields to match
 *  - list_entry_types  List valid BibTeX entry types with required/optional fields
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
import { fetchDoiMetadata, compareEntryWithDoi } from './doi.js';

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
    await saveBib(filePath, result.entries, lib.strings ?? {});
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
- Read: query_entries, get_entry, get_field
- Write: create_entry, update_field, delete_field, delete_entry
- Check: validate_entry, validate_file
- Discovery: list_entry_types`,
});

// ---------------------------------------------------------------------------
// query_entries
// ---------------------------------------------------------------------------
server.tool(
  'query_entries',
  'Search for BibTeX entries in a .bib file by key, type, or field value substring.',
  {
    file:       z.string().describe('Absolute path to the .bib file'),
    key:        z.string().optional().describe('Substring to match against citation keys (case-insensitive)'),
    type:       z.string().optional().describe('Entry type to filter by, e.g. "article", "inproceedings"'),
    field:      z.string().optional().describe('Field name to search within'),
    fieldValue: z.string().optional().describe('Substring to match in the specified field value'),
  },
  async ({ file, key, type, field, fieldValue }) => {
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

      return ok({
        count: results.length,
        entries: results.map(e => ({
          key: e.key,
          type: e.type,
          fields: e.fields,
        })),
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
        return err(`DOI lookup failed: ${e.message}`);
      }

      const mismatches = compareEntryWithDoi(entry, cr);
      return ok({
        key,
        doi,
        valid: mismatches.length === 0,
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
  + 'Returns per-entry results plus a summary.',
  {
    file: z.string().describe('Absolute path to the .bib file'),
  },
  async ({ file }) => {
    return withBib(file, async (lib, parseErrors) => {
      const withDoi = lib.entries.filter(e => e.fields.doi?.trim());

      const results = [];
      let valid = 0;
      let withMismatches = 0;
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
        if (mismatches.length === 0) {
          valid++;
        } else {
          withMismatches++;
        }
        results.push({ key: entry.key, doi, valid: mismatches.length === 0, mismatches });
      }

      return ok({
        summary: {
          checked: withDoi.length,
          valid,
          withMismatches,
          lookupErrors,
        },
        results,
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
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
