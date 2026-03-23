import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { compareEntryWithDoi, crossrefToBibFields, lookupDoiByMetadata } from '../src/doi.js';

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

// ---------------------------------------------------------------------------
// Mismatch severity
// ---------------------------------------------------------------------------

describe('compareEntryWithDoi – mismatch severity', () => {
  it('marks a wrong year as substantive', () => {
    const entry = makeEntry({ year: '2020' });
    const issues = compareEntryWithDoi(entry, makeCr());
    const issue = issues.find(i => i.field === 'year');
    assert.equal(issue.severity, 'substantive');
  });

  it('marks wrong pages as substantive', () => {
    const entry = makeEntry({ pages: '1--10' });
    const issues = compareEntryWithDoi(entry, makeCr());
    const issue = issues.find(i => i.field === 'pages');
    assert.equal(issue.severity, 'substantive');
  });

  it('marks a wrong author list as substantive', () => {
    const entry = makeEntry({ author: 'Brown, Bob and Green, Carol' });
    const issues = compareEntryWithDoi(entry, makeCr());
    const issue = issues.find(i => i.field === 'author');
    assert.equal(issue.severity, 'substantive');
  });

  it('marks a journal abbreviation as cosmetic (local is prefix of remote)', () => {
    const entry = makeEntry({ journal: 'Human Factors' });
    const cr = makeCr({ 'container-title': ['Human Factors: The Journal of the Human Factors and Ergonomics Society'] });
    const issues = compareEntryWithDoi(entry, cr);
    const issue = issues.find(i => i.field === 'journal');
    assert.ok(issue, 'should report a mismatch');
    assert.equal(issue.severity, 'cosmetic');
  });

  it('marks a publisher abbreviation as cosmetic (local is prefix of remote)', () => {
    const entry = makeEntry({ publisher: 'Elsevier' });
    const cr = makeCr({ publisher: 'Elsevier BV' });
    const issues = compareEntryWithDoi(entry, cr);
    const issue = issues.find(i => i.field === 'publisher');
    assert.ok(issue, 'should report a mismatch');
    assert.equal(issue.severity, 'cosmetic');
  });

  it('marks Crossref-truncated title as cosmetic (remote is prefix of local)', () => {
    const entry = makeEntry({ title: 'To Trust or to Think: Cognitive Forcing Functions Can Reduce Overreliance' });
    const cr = makeCr({ title: ['To Trust or to Think'] });
    const issues = compareEntryWithDoi(entry, cr);
    const issue = issues.find(i => i.field === 'title');
    assert.ok(issue, 'should report a mismatch');
    assert.equal(issue.severity, 'cosmetic');
  });

  it('marks a completely wrong journal name as substantive', () => {
    const entry = makeEntry({ journal: 'Completely Different Journal' });
    const issues = compareEntryWithDoi(entry, makeCr());
    const issue = issues.find(i => i.field === 'journal');
    assert.equal(issue.severity, 'substantive');
  });

  it('every mismatch has a severity field', () => {
    const entry = makeEntry({
      title: 'Wrong', year: '2000', author: 'Nobody', journal: 'Wrong', publisher: 'Wrong',
    });
    const issues = compareEntryWithDoi(entry, makeCr());
    for (const issue of issues) {
      assert.ok(
        issue.severity === 'cosmetic' || issue.severity === 'substantive',
        `Expected cosmetic or substantive, got "${issue.severity}" for field "${issue.field}"`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Unicode / LaTeX encoding normalisation
// ---------------------------------------------------------------------------

describe('compareEntryWithDoi – unicode and LaTeX encoding', () => {
  it('treats LaTeX \\"{u} and unicode ü as equal in author names', () => {
    const entry = makeEntry({ author: 'Gr{\\"u}tzner, Cassandra' });
    const cr = makeCr({ author: [{ family: 'Grützner', given: 'Cassandra' }] });
    const issues = compareEntryWithDoi(entry, cr);
    assert.equal(issues.filter(i => i.field === 'author').length, 0);
  });

  it('treats LaTeX \\c{c} and unicode ç as equal in author names', () => {
    const entry = makeEntry({ author: 'Bu\\c{c}inca, Zana' });
    const cr = makeCr({ author: [{ family: 'Buçinca', given: 'Zana' }] });
    const issues = compareEntryWithDoi(entry, cr);
    assert.equal(issues.filter(i => i.field === 'author').length, 0);
  });

  it("treats LaTeX \\'{e} and unicode é as equal in author names", () => {
    const entry = makeEntry({ author: "Letouz\\'{e}, Emmanuel" });
    const cr = makeCr({ author: [{ family: 'Letouzé', given: 'Emmanuel' }] });
    const issues = compareEntryWithDoi(entry, cr);
    assert.equal(issues.filter(i => i.field === 'author').length, 0);
  });

  it('still flags genuinely different author family names after unicode normalisation', () => {
    const entry = makeEntry({ author: 'Mueller, Hans' });
    const cr = makeCr({ author: [{ family: 'Schneider', given: 'Hans' }] });
    const issues = compareEntryWithDoi(entry, cr);
    assert.ok(issues.some(i => i.field === 'author'));
  });
});

// ---------------------------------------------------------------------------
// crossrefToBibFields
// ---------------------------------------------------------------------------

describe('crossrefToBibFields', () => {
  const cr = {
    title:            ['A Great Paper: Full Subtitle'],
    published:        { 'date-parts': [[2023]] },
    author:           [{ family: 'Smith', given: 'John' }, { family: 'Jones', given: 'Alice' }],
    'container-title': ['Journal of Things'],
    volume:           '10',
    issue:            '2',
    page:             '123-456',
    publisher:        'Some Publisher',
  };

  it('maps title', () => {
    const f = crossrefToBibFields(cr, { title: '' });
    assert.equal(f.title, 'A Great Paper: Full Subtitle');
  });

  it('maps year', () => {
    const f = crossrefToBibFields(cr, { year: '' });
    assert.equal(f.year, '2023');
  });

  it('maps authors in Family, Given and ... format', () => {
    const f = crossrefToBibFields(cr, { author: '' });
    assert.equal(f.author, 'Smith, John and Jones, Alice');
  });

  it('maps container-title to journal when journal exists in entry', () => {
    const f = crossrefToBibFields(cr, { journal: '' });
    assert.equal(f.journal, 'Journal of Things');
    assert.equal(f.booktitle, undefined);
  });

  it('maps container-title to booktitle when booktitle exists in entry', () => {
    const f = crossrefToBibFields(cr, { booktitle: '' });
    assert.equal(f.booktitle, 'Journal of Things');
    assert.equal(f.journal, undefined);
  });

  it('normalises page dash to double-dash', () => {
    const f = crossrefToBibFields(cr, { pages: '' });
    assert.equal(f.pages, '123--456');
  });

  it('does not emit fields absent from the Crossref message', () => {
    const f = crossrefToBibFields({}, {});
    assert.deepEqual(f, {});
  });
});

// ---------------------------------------------------------------------------
// lookupDoiByMetadata — error paths (no network required)
// ---------------------------------------------------------------------------

describe('lookupDoiByMetadata – error path', () => {
  it('throws when neither title nor author is provided', async () => {
    await assert.rejects(
      () => lookupDoiByMetadata({}),
      /at least one of title or author/i
    );
  });
});
