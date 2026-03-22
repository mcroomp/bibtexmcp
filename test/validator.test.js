import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateEntry, validateAll, getEntryTypeSchema, listEntryTypes } from '../src/validator.js';

// ---------------------------------------------------------------------------
// Synthetic entry helpers
// ---------------------------------------------------------------------------

function makeEntry(type, key, fields = {}) {
  return { type, key, fields };
}

// ---------------------------------------------------------------------------
// validateEntry — valid entries
// ---------------------------------------------------------------------------

describe('validateEntry – valid entries', () => {
  it('accepts a complete article', () => {
    const e = makeEntry('article', 'smith2023', {
      author:  'Smith, J.',
      title:   'A Title',
      journal: 'Some Journal',
      year:    '2023',
    });
    const issues = validateEntry(e);
    assert.equal(issues.filter(i => i.severity === 'error').length, 0);
  });

  it('accepts a complete book with author', () => {
    const e = makeEntry('book', 'jones2020', {
      author:    'Jones, A.',
      title:     'My Book',
      publisher: 'Press',
      year:      '2020',
    });
    const issues = validateEntry(e);
    assert.equal(issues.filter(i => i.severity === 'error').length, 0);
  });

  it('accepts a complete book with editor instead of author', () => {
    const e = makeEntry('book', 'ed2021', {
      editor:    'Editor, E.',
      title:     'Edited Volume',
      publisher: 'Press',
      year:      '2021',
    });
    const issues = validateEntry(e);
    assert.equal(issues.filter(i => i.severity === 'error').length, 0);
  });

  it('accepts a misc entry with no required fields', () => {
    const e = makeEntry('misc', 'misc1', { title: 'Something', year: '2022' });
    const issues = validateEntry(e);
    assert.equal(issues.filter(i => i.severity === 'error').length, 0);
  });

  it('accepts an inproceedings entry', () => {
    const e = makeEntry('inproceedings', 'conf2022', {
      author:    'Author, A.',
      title:     'A Paper',
      booktitle: 'Proc. of the Conference',
      year:      '2022',
    });
    const issues = validateEntry(e);
    assert.equal(issues.filter(i => i.severity === 'error').length, 0);
  });
});

// ---------------------------------------------------------------------------
// validateEntry — missing required fields
// ---------------------------------------------------------------------------

describe('validateEntry – missing required fields', () => {
  it('reports error for missing author in article', () => {
    const e = makeEntry('article', 'x', { title: 'T', journal: 'J', year: '2020' });
    const issues = validateEntry(e);
    const errs = issues.filter(i => i.severity === 'error' && i.field === 'author');
    assert.ok(errs.length > 0, 'should report missing author');
  });

  it('reports error for missing title in article', () => {
    const e = makeEntry('article', 'x', { author: 'A', journal: 'J', year: '2020' });
    const issues = validateEntry(e);
    assert.ok(issues.some(i => i.severity === 'error' && i.field === 'title'));
  });

  it('reports error for missing year in article', () => {
    const e = makeEntry('article', 'x', { author: 'A', title: 'T', journal: 'J' });
    assert.ok(validateEntry(e).some(i => i.severity === 'error' && i.field === 'year'));
  });

  it('reports error when book has neither author nor editor', () => {
    const e = makeEntry('book', 'x', { title: 'T', publisher: 'P', year: '2020' });
    const issues = validateEntry(e);
    assert.ok(issues.some(i => i.severity === 'error'));
  });

  it('reports no error when book has editor but not author', () => {
    const e = makeEntry('book', 'x', { editor: 'E', title: 'T', publisher: 'P', year: '2020' });
    assert.equal(validateEntry(e).filter(i => i.severity === 'error').length, 0);
  });
});

// ---------------------------------------------------------------------------
// validateEntry — field format checks
// ---------------------------------------------------------------------------

describe('validateEntry – field format warnings', () => {
  it('warns about a non-4-digit year', () => {
    const e = makeEntry('misc', 'x', { year: '99' });
    assert.ok(validateEntry(e).some(i => i.severity === 'warning' && i.field === 'year'));
  });

  it('accepts a valid 4-digit year', () => {
    const e = makeEntry('misc', 'x', { year: '2023' });
    assert.ok(!validateEntry(e).some(i => i.field === 'year' && i.severity === 'warning'));
  });

  it('warns about a bad pages format', () => {
    const e = makeEntry('misc', 'x', { pages: 'pp.1-10' });
    assert.ok(validateEntry(e).some(i => i.severity === 'warning' && i.field === 'pages'));
  });

  it('accepts "123--456" pages format', () => {
    // Use article (which has pages as optional) so "not standard" warning doesn't fire
    const e = makeEntry('article', 'x', {
      author: 'A', title: 'T', journal: 'J', year: '2023', pages: '123--456',
    });
    const pageIssues = validateEntry(e).filter(i => i.field === 'pages');
    assert.equal(pageIssues.length, 0);
  });

  it('warns about a bad DOI', () => {
    const e = makeEntry('misc', 'x', { doi: 'not-a-doi' });
    assert.ok(validateEntry(e).some(i => i.severity === 'warning' && i.field === 'doi'));
  });

  it('accepts a valid DOI', () => {
    const e = makeEntry('misc', 'x', { doi: '10.1234/test.2023' });
    assert.ok(!validateEntry(e).some(i => i.field === 'doi'));
  });

  it('warns about an http URL', () => {
    // https is fine; bare http is also fine — let's check a truly bad URL
    const e = makeEntry('misc', 'x', { url: 'ftp://old.example.com/file' });
    assert.ok(validateEntry(e).some(i => i.severity === 'warning' && i.field === 'url'));
  });

  it('accepts an https URL', () => {
    const e = makeEntry('misc', 'x', { url: 'https://example.com' });
    assert.ok(!validateEntry(e).some(i => i.field === 'url'));
  });

  it('warns about an empty field value', () => {
    const e = makeEntry('misc', 'x', { title: '' });
    assert.ok(validateEntry(e).some(i => i.severity === 'warning' && i.field === 'title'));
  });
});

// ---------------------------------------------------------------------------
// validateEntry — citation key checks
// ---------------------------------------------------------------------------

describe('validateEntry – citation key checks', () => {
  it('reports error for whitespace in key', () => {
    const e = makeEntry('misc', 'bad key', {});
    assert.ok(validateEntry(e).some(i => i.severity === 'error' && i.field === null));
  });

  it('warns about unusual characters in key', () => {
    const e = makeEntry('misc', 'bad@key', {});
    assert.ok(validateEntry(e).some(i => i.severity === 'warning' && i.field === null));
  });

  it('accepts standard alphanumeric keys', () => {
    const e = makeEntry('misc', 'smith2023', {});
    assert.ok(!validateEntry(e).some(i => i.field === null && i.message.includes('key')));
  });

  it('accepts keys with colons and hyphens', () => {
    const e = makeEntry('misc', 'smith:2023-ai', {});
    const keyIssues = validateEntry(e).filter(i => i.message.toLowerCase().includes('key'));
    assert.equal(keyIssues.filter(i => i.severity === 'error').length, 0);
  });
});

// ---------------------------------------------------------------------------
// validateEntry — unknown entry type
// ---------------------------------------------------------------------------

describe('validateEntry – unknown entry type', () => {
  it('warns about an unknown entry type', () => {
    const e = makeEntry('unknowntype', 'x', {});
    assert.ok(validateEntry(e).some(i => i.severity === 'warning' && i.field === null));
  });

  it('does not report unknown type as an error', () => {
    const e = makeEntry('unknowntype', 'x', {});
    assert.equal(validateEntry(e).filter(i => i.severity === 'error').length, 0);
  });
});

// ---------------------------------------------------------------------------
// validateAll
// ---------------------------------------------------------------------------

describe('validateAll', () => {
  it('detects duplicate keys', () => {
    const entries = [
      makeEntry('misc', 'dupkey', { title: 'First' }),
      makeEntry('misc', 'dupkey', { title: 'Second' }),
    ];
    const { results, summary } = validateAll(entries);
    assert.ok(summary.errors > 0);
    const dupIssue = results.flatMap(r => r.issues).find(i => i.message.includes('Duplicate'));
    assert.ok(dupIssue, 'should report duplicate key error');
  });

  it('reports summary counts correctly', () => {
    const entries = [
      makeEntry('article', 'ok', { author: 'A', title: 'T', journal: 'J', year: '2023' }),
      makeEntry('article', 'bad', { title: 'T', journal: 'J', year: '2023' }),  // missing author
    ];
    const { summary } = validateAll(entries);
    assert.ok(summary.errors >= 1);
    assert.equal(summary.entriesChecked, 2);
  });

  it('returns empty results for an all-valid library', () => {
    const entries = [
      makeEntry('misc', 'a', { title: 'A' }),
      makeEntry('misc', 'b', { title: 'B' }),
    ];
    const { results, summary } = validateAll(entries);
    assert.equal(summary.errors, 0);
  });

  it('handles an empty entries list', () => {
    const { results, summary } = validateAll([]);
    assert.equal(results.length, 0);
    assert.equal(summary.entriesChecked, 0);
  });
});

// ---------------------------------------------------------------------------
// getEntryTypeSchema / listEntryTypes
// ---------------------------------------------------------------------------

describe('getEntryTypeSchema', () => {
  it('returns schema for a known type', () => {
    const schema = getEntryTypeSchema('article');
    assert.ok(schema);
    assert.ok(Array.isArray(schema.required));
    assert.ok(Array.isArray(schema.optional));
    assert.ok(schema.required.includes('author'));
  });

  it('is case-insensitive', () => {
    assert.ok(getEntryTypeSchema('ARTICLE'));
    assert.ok(getEntryTypeSchema('Article'));
  });

  it('returns null for unknown type', () => {
    assert.equal(getEntryTypeSchema('nosuchtype'), null);
  });
});

describe('listEntryTypes', () => {
  it('returns an array of known type strings', () => {
    const types = listEntryTypes();
    assert.ok(Array.isArray(types));
    assert.ok(types.includes('article'));
    assert.ok(types.includes('book'));
    assert.ok(types.includes('inproceedings'));
    assert.ok(types.length >= 10);
  });
});
