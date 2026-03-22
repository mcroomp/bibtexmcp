import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { compareEntryWithDoi } from '../src/doi.js';

function makeEntry(fields = {}) {
  return { type: 'article', key: 'test2023', fields };
}

// Minimal Crossref message for a journal article
function makeCr(overrides = {}) {
  return {
    title: ['A Great Paper'],
    published: { 'date-parts': [[2023]] },
    author: [
      { family: 'Smith', given: 'John' },
      { family: 'Jones', given: 'Alice' },
    ],
    'container-title': ['Journal of Things'],
    volume: '10',
    issue: '2',
    page: '123-456',
    publisher: 'Some Publisher',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// No mismatches — all fields match
// ---------------------------------------------------------------------------

describe('compareEntryWithDoi – matching entries', () => {
  it('reports no issues when all fields match', () => {
    const entry = makeEntry({
      title:     'A Great Paper',
      year:      '2023',
      author:    'Smith, John and Jones, Alice',
      journal:   'Journal of Things',
      volume:    '10',
      number:    '2',
      pages:     '123-456',
      publisher: 'Some Publisher',
    });
    const issues = compareEntryWithDoi(entry, makeCr());
    assert.equal(issues.length, 0);
  });

  it('accepts double-dash page separator as equivalent to single dash', () => {
    const entry = makeEntry({ pages: '123--456' });
    const issues = compareEntryWithDoi(entry, makeCr({ page: '123-456' }));
    const pageIssues = issues.filter(i => i.field === 'pages');
    assert.equal(pageIssues.length, 0);
  });

  it('ignores case and surrounding braces in title', () => {
    const entry = makeEntry({ title: '{A great paper}' });
    const issues = compareEntryWithDoi(entry, makeCr({ title: ['A Great Paper'] }));
    const titleIssues = issues.filter(i => i.field === 'title');
    assert.equal(titleIssues.length, 0);
  });

  it('strips LaTeX commands before comparing title', () => {
    const entry = makeEntry({ title: 'A \\emph{Great} Paper' });
    const issues = compareEntryWithDoi(entry, makeCr({ title: ['A Great Paper'] }));
    assert.equal(issues.filter(i => i.field === 'title').length, 0);
  });

  it('accepts "Given Family and Given Family" author format', () => {
    const entry = makeEntry({ author: 'John Smith and Alice Jones' });
    const issues = compareEntryWithDoi(entry, makeCr());
    assert.equal(issues.filter(i => i.field === 'author').length, 0);
  });

  it('skips comparison for fields absent in the entry', () => {
    // Entry has no title, year, etc. — should produce no mismatches
    const entry = makeEntry({ doi: '10.1234/test' });
    const issues = compareEntryWithDoi(entry, makeCr());
    assert.equal(issues.length, 0);
  });

  it('skips author comparison when Crossref has no author list', () => {
    const entry = makeEntry({ author: 'Smith, John' });
    const issues = compareEntryWithDoi(entry, makeCr({ author: undefined }));
    assert.equal(issues.filter(i => i.field === 'author').length, 0);
  });
});

// ---------------------------------------------------------------------------
// Mismatches detected
// ---------------------------------------------------------------------------

describe('compareEntryWithDoi – detecting mismatches', () => {
  it('flags a wrong title', () => {
    const entry = makeEntry({ title: 'Wrong Title' });
    const issues = compareEntryWithDoi(entry, makeCr());
    assert.ok(issues.some(i => i.field === 'title'));
  });

  it('flags a wrong year', () => {
    const entry = makeEntry({ year: '2020' });
    const issues = compareEntryWithDoi(entry, makeCr());
    assert.ok(issues.some(i => i.field === 'year'));
  });

  it('includes the remote year value in the mismatch', () => {
    const entry = makeEntry({ year: '2020' });
    const issues = compareEntryWithDoi(entry, makeCr());
    const yearIssue = issues.find(i => i.field === 'year');
    assert.equal(yearIssue.remoteValue, '2023');
  });

  it('flags a wrong author list', () => {
    const entry = makeEntry({ author: 'Brown, Bob and Green, Carol' });
    const issues = compareEntryWithDoi(entry, makeCr());
    assert.ok(issues.some(i => i.field === 'author'));
  });

  it('flags a wrong journal', () => {
    const entry = makeEntry({ journal: 'Wrong Journal' });
    const issues = compareEntryWithDoi(entry, makeCr());
    assert.ok(issues.some(i => i.field === 'journal'));
  });

  it('flags a wrong volume', () => {
    const entry = makeEntry({ volume: '99' });
    const issues = compareEntryWithDoi(entry, makeCr());
    assert.ok(issues.some(i => i.field === 'volume'));
  });

  it('flags a wrong issue number', () => {
    const entry = makeEntry({ number: '9' });
    const issues = compareEntryWithDoi(entry, makeCr());
    assert.ok(issues.some(i => i.field === 'number'));
  });

  it('flags wrong pages', () => {
    const entry = makeEntry({ pages: '1--10' });
    const issues = compareEntryWithDoi(entry, makeCr());
    assert.ok(issues.some(i => i.field === 'pages'));
  });

  it('flags a wrong publisher', () => {
    const entry = makeEntry({ publisher: 'Other Publisher' });
    const issues = compareEntryWithDoi(entry, makeCr());
    assert.ok(issues.some(i => i.field === 'publisher'));
  });

  it('includes localValue and remoteValue in each mismatch', () => {
    const entry = makeEntry({ title: 'Wrong Title' });
    const issues = compareEntryWithDoi(entry, makeCr());
    const issue = issues.find(i => i.field === 'title');
    assert.ok(issue.localValue);
    assert.ok(issue.remoteValue);
    assert.ok(issue.message);
  });
});

// ---------------------------------------------------------------------------
// booktitle (inproceedings)
// ---------------------------------------------------------------------------

describe('compareEntryWithDoi – booktitle', () => {
  it('compares booktitle against container-title', () => {
    const entry = { type: 'inproceedings', key: 'conf2023', fields: {
      booktitle: 'Wrong Proceedings',
    }};
    const cr = makeCr({ 'container-title': ['Great Conference Proceedings'] });
    const issues = compareEntryWithDoi(entry, cr);
    assert.ok(issues.some(i => i.field === 'booktitle'));
  });

  it('accepts matching booktitle', () => {
    const entry = { type: 'inproceedings', key: 'conf2023', fields: {
      booktitle: 'Great Conference Proceedings',
    }};
    const cr = makeCr({ 'container-title': ['Great Conference Proceedings'] });
    const issues = compareEntryWithDoi(entry, cr);
    assert.equal(issues.filter(i => i.field === 'booktitle').length, 0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('compareEntryWithDoi – edge cases', () => {
  it('handles empty Crossref message gracefully', () => {
    const entry = makeEntry({ title: 'A Great Paper', year: '2023' });
    const issues = compareEntryWithDoi(entry, {});
    assert.equal(issues.length, 0);
  });

  it('handles missing published date in Crossref gracefully', () => {
    const entry = makeEntry({ year: '2023' });
    const issues = compareEntryWithDoi(entry, makeCr({ published: undefined }));
    assert.equal(issues.filter(i => i.field === 'year').length, 0);
  });

  it('handles en-dash page separator', () => {
    const entry = makeEntry({ pages: '123–456' });
    const issues = compareEntryWithDoi(entry, makeCr({ page: '123-456' }));
    assert.equal(issues.filter(i => i.field === 'pages').length, 0);
  });
});
