/**
 * BibTeX entry validator.
 *
 * Works with the entry shape produced by @retorquere/bibtex-parser (verbatim mode):
 *   { type: string, key: string, fields: Record<string, string> }
 *
 * Returns issues as { severity: 'error'|'warning', field: string|null, message: string }.
 */

const ENTRY_TYPES = {
  article: {
    required: ['author', 'title', 'journal', 'year'],
    optional: ['volume', 'number', 'pages', 'month', 'doi', 'url', 'note', 'issn', 'abstract', 'keywords'],
  },
  book: {
    required: [['author', 'editor'], 'title', 'publisher', 'year'],
    optional: ['volume', 'number', 'series', 'address', 'edition', 'month', 'note', 'isbn', 'doi', 'url'],
  },
  booklet: {
    required: ['title'],
    optional: ['author', 'howpublished', 'address', 'month', 'year', 'note'],
  },
  conference: {
    required: ['author', 'title', 'booktitle', 'year'],
    optional: ['editor', 'volume', 'number', 'series', 'pages', 'address', 'month', 'organization', 'publisher', 'note', 'doi', 'url'],
  },
  inbook: {
    required: [['author', 'editor'], 'title', ['chapter', 'pages'], 'publisher', 'year'],
    optional: ['volume', 'number', 'series', 'type', 'address', 'edition', 'month', 'note'],
  },
  incollection: {
    required: ['author', 'title', 'booktitle', 'publisher', 'year'],
    optional: ['editor', 'volume', 'number', 'series', 'type', 'chapter', 'pages', 'address', 'edition', 'month', 'note', 'doi', 'url'],
  },
  inproceedings: {
    required: ['author', 'title', 'booktitle', 'year'],
    optional: ['editor', 'volume', 'number', 'series', 'pages', 'address', 'month', 'organization', 'publisher', 'note', 'doi', 'url'],
  },
  manual: {
    required: ['title'],
    optional: ['author', 'organization', 'address', 'edition', 'month', 'year', 'note'],
  },
  mastersthesis: {
    required: ['author', 'title', 'school', 'year'],
    optional: ['type', 'address', 'month', 'note', 'url'],
  },
  misc: {
    required: [],
    optional: ['author', 'title', 'howpublished', 'month', 'year', 'note', 'url', 'doi'],
  },
  phdthesis: {
    required: ['author', 'title', 'school', 'year'],
    optional: ['type', 'address', 'month', 'note', 'url'],
  },
  proceedings: {
    required: ['title', 'year'],
    optional: ['editor', 'volume', 'number', 'series', 'address', 'month', 'publisher', 'organization', 'note'],
  },
  techreport: {
    required: ['author', 'title', 'institution', 'year'],
    optional: ['type', 'number', 'address', 'month', 'note', 'url', 'doi'],
  },
  unpublished: {
    required: ['author', 'title', 'note'],
    optional: ['month', 'year', 'url'],
  },
};

const FIELD_VALIDATORS = {
  year: (val) => {
    if (!/^\d{4}$/.test(val.trim())) return 'Year should be a 4-digit number';
    const y = parseInt(val.trim(), 10);
    if (y < 1000 || y > 2100) return `Year ${y} looks implausible`;
    return null;
  },
  pages: (val) => {
    const t = val.trim();
    if (t && !/^(\d+(-{1,3}\d+)?|[ivxlcdm]+-[ivxlcdm]+)$/i.test(t))
      return 'Pages should be in format "123" or "123--456"';
    return null;
  },
  month: (val) => {
    const valid = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec',
                   'january','february','march','april','june','july','august','september',
                   'october','november','december'];
    const v = val.trim().toLowerCase();
    if (v && !valid.includes(v) && !/^\d{1,2}$/.test(v))
      return `Month "${val.trim()}" is not a standard month name or number`;
    return null;
  },
  doi: (val) => {
    const t = val.trim();
    if (t && !/^10\.\d{4,}/.test(t)) return 'DOI should start with "10." followed by a registrant code';
    return null;
  },
  url: (val) => {
    const t = val.trim();
    if (t && !/^https?:\/\//.test(t)) return 'URL should start with http:// or https://';
    return null;
  },
};

/**
 * Validate a single entry.
 * entry shape: { type: string, key: string, fields: Record<string, string> }
 */
export function validateEntry(entry) {
  const issues = [];
  const type = entry.type.toLowerCase();
  const schema = ENTRY_TYPES[type];
  const fieldNames = new Set(Object.keys(entry.fields).map(k => k.toLowerCase()));

  if (!schema) {
    issues.push({ severity: 'warning', field: null, message: `Unknown entry type "@${entry.type}"` });
  }

  // Citation key checks
  if (!entry.key || !entry.key.trim()) {
    issues.push({ severity: 'error', field: null, message: 'Entry is missing a citation key' });
  } else if (/\s/.test(entry.key)) {
    issues.push({ severity: 'error', field: null, message: `Citation key "${entry.key}" contains whitespace` });
  } else if (!/^[a-zA-Z0-9_\-:.+/]+$/.test(entry.key)) {
    issues.push({ severity: 'warning', field: null, message: `Citation key "${entry.key}" contains unusual characters` });
  }

  if (schema) {
    // Required fields
    for (const req of schema.required) {
      if (Array.isArray(req)) {
        if (!req.some(r => fieldNames.has(r))) {
          issues.push({
            severity: 'error',
            field: req.join('/'),
            message: `@${type} requires at least one of: ${req.join(', ')}`,
          });
        }
      } else {
        if (!fieldNames.has(req)) {
          issues.push({ severity: 'error', field: req, message: `@${type} requires field "${req}"` });
        }
      }
    }

    // Unknown fields
    const knownFields = new Set([...schema.required.flat(), ...schema.optional]);
    for (const fname of fieldNames) {
      if (!knownFields.has(fname)) {
        issues.push({ severity: 'warning', field: fname, message: `Field "${fname}" is not standard for @${type}` });
      }
    }
  }

  // Field-level value checks
  for (const [name, value] of Object.entries(entry.fields)) {
    const lname = name.toLowerCase();
    if (!value && value !== '0') {
      issues.push({ severity: 'warning', field: lname, message: `Field "${lname}" is empty` });
    }
    const validator = FIELD_VALIDATORS[lname];
    if (validator && value) {
      const msg = validator(value);
      if (msg) issues.push({ severity: 'warning', field: lname, message: msg });
    }
  }

  return issues;
}

/**
 * Validate all entries in an array.
 * Returns { results: [{key, type, issues}], summary: {errors, warnings, entriesChecked} }.
 */
export function validateAll(entries) {
  const results = [];
  const keys = new Set();
  let errors = 0;
  let warnings = 0;

  for (const entry of entries) {
    if (!entry.type || !('fields' in entry)) continue;  // skip non-entry nodes

    const lk = entry.key.toLowerCase();

    if (keys.has(lk)) {
      const dupIssue = { severity: 'error', field: null, message: `Duplicate citation key "${entry.key}"` };
      results.push({ key: entry.key, type: entry.type, issues: [dupIssue] });
      errors++;
    }
    keys.add(lk);

    const issues = validateEntry(entry);
    if (issues.length > 0) {
      results.push({ key: entry.key, type: entry.type, issues });
      errors   += issues.filter(i => i.severity === 'error').length;
      warnings += issues.filter(i => i.severity === 'warning').length;
    }
  }

  return { results, summary: { errors, warnings, entriesChecked: keys.size } };
}

/** Return the schema for a given entry type, or null. */
export function getEntryTypeSchema(type) {
  return ENTRY_TYPES[type.toLowerCase()] ?? null;
}

/** Return all known entry type names. */
export function listEntryTypes() {
  return Object.keys(ENTRY_TYPES);
}
