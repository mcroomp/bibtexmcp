import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeUsPatentNumber, compareEntryWithPatent } from '../src/patent.js';

// ---------------------------------------------------------------------------
// normalizeUsPatentNumber
// ---------------------------------------------------------------------------

describe('normalizeUsPatentNumber', () => {
  it('handles a bare digit string', () => {
    assert.equal(normalizeUsPatentNumber('9876543'), '9876543');
  });

  it('strips commas', () => {
    assert.equal(normalizeUsPatentNumber('9,876,543'), '9876543');
  });

  it('strips "US" prefix and kind code', () => {
    assert.equal(normalizeUsPatentNumber('US 9,876,543 B2'), '9876543');
  });

  it('strips "US" prefix without spaces', () => {
    assert.equal(normalizeUsPatentNumber('US9876543B2'), '9876543');
  });

  it('strips "us" lowercase prefix', () => {
    assert.equal(normalizeUsPatentNumber('us9876543b1'), '9876543');
  });

  it('strips kind code A1', () => {
    assert.equal(normalizeUsPatentNumber('12345678A1'), '12345678');
  });

  it('strips kind code B3', () => {
    assert.equal(normalizeUsPatentNumber('12345678B3'), '12345678');
  });

  it('returns null for a non-US EP patent', () => {
    assert.equal(normalizeUsPatentNumber('EP1234567A1'), null);
  });

  it('returns null for a WO patent', () => {
    assert.equal(normalizeUsPatentNumber('WO2020123456A1'), null);
  });

  it('returns null for a non-numeric string', () => {
    assert.equal(normalizeUsPatentNumber('not-a-patent'), null);
  });
});

// ---------------------------------------------------------------------------
// compareEntryWithPatent helpers
// ---------------------------------------------------------------------------

function makeEntry(fields = {}) {
  return { type: 'patent', key: 'smith2023pat', fields };
}

// Minimal PatentsView record
function makePt(overrides = {}) {
  return {
    patent_number: '9876543',
    patent_title:  'A Better Widget',
    patent_date:   '2018-01-23',
    inventors: [
      { inventor_last_name: 'Smith',  inventor_first_name: 'John'  },
      { inventor_last_name: 'Jones',  inventor_first_name: 'Alice' },
    ],
    assignees: [
      { assignee_organization: 'Acme Corp' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// compareEntryWithPatent – matching entries
// ---------------------------------------------------------------------------

describe('compareEntryWithPatent – matching entries', () => {
  it('reports no issues when all fields match', () => {
    const entry = makeEntry({
      title:  'A Better Widget',
      year:   '2018',
      author: 'Smith, John and Jones, Alice',
      holder: 'Acme Corp',
    });
    assert.equal(compareEntryWithPatent(entry, makePt()).length, 0);
  });

  it('ignores case and braces in title', () => {
    const entry = makeEntry({ title: '{A better widget}' });
    assert.equal(compareEntryWithPatent(entry, makePt()).filter(i => i.field === 'title').length, 0);
  });

  it('strips LaTeX commands before comparing title', () => {
    const entry = makeEntry({ title: 'A \\emph{Better} Widget' });
    assert.equal(compareEntryWithPatent(entry, makePt()).filter(i => i.field === 'title').length, 0);
  });

  it('accepts "Given Family" author format', () => {
    const entry = makeEntry({ author: 'John Smith and Alice Jones' });
    assert.equal(compareEntryWithPatent(entry, makePt()).filter(i => i.field === 'author').length, 0);
  });

  it('skips comparison for fields absent from the entry', () => {
    const entry = makeEntry({ number: 'US 9,876,543 B2' });
    assert.equal(compareEntryWithPatent(entry, makePt()).length, 0);
  });

  it('skips author comparison when PatentsView has no inventors', () => {
    const entry = makeEntry({ author: 'Smith, John' });
    assert.equal(
      compareEntryWithPatent(entry, makePt({ inventors: [] }))
        .filter(i => i.field === 'author').length,
      0
    );
  });

  it('skips holder comparison when PatentsView has no assignees', () => {
    const entry = makeEntry({ holder: 'Acme Corp' });
    assert.equal(
      compareEntryWithPatent(entry, makePt({ assignees: [] }))
        .filter(i => i.field === 'holder').length,
      0
    );
  });
});

// ---------------------------------------------------------------------------
// compareEntryWithPatent – detecting mismatches
// ---------------------------------------------------------------------------

describe('compareEntryWithPatent – detecting mismatches', () => {
  it('flags a wrong title', () => {
    const entry = makeEntry({ title: 'Wrong Title' });
    assert.ok(compareEntryWithPatent(entry, makePt()).some(i => i.field === 'title'));
  });

  it('flags a wrong year', () => {
    const entry = makeEntry({ year: '2020' });
    assert.ok(compareEntryWithPatent(entry, makePt()).some(i => i.field === 'year'));
  });

  it('includes remoteValue in year mismatch', () => {
    const entry = makeEntry({ year: '2020' });
    const issue = compareEntryWithPatent(entry, makePt()).find(i => i.field === 'year');
    assert.equal(issue.remoteValue, '2018');
  });

  it('flags a wrong author list', () => {
    const entry = makeEntry({ author: 'Brown, Bob and Green, Carol' });
    assert.ok(compareEntryWithPatent(entry, makePt()).some(i => i.field === 'author'));
  });

  it('includes remote inventor names in author mismatch', () => {
    const entry = makeEntry({ author: 'Brown, Bob' });
    const issue = compareEntryWithPatent(entry, makePt()).find(i => i.field === 'author');
    assert.ok(issue.remoteValue.includes('Smith'));
  });

  it('flags a wrong holder', () => {
    const entry = makeEntry({ holder: 'Wrong Corp' });
    assert.ok(compareEntryWithPatent(entry, makePt()).some(i => i.field === 'holder'));
  });

  it('includes localValue and remoteValue in each mismatch', () => {
    const entry = makeEntry({ title: 'Wrong Title' });
    const issue = compareEntryWithPatent(entry, makePt()).find(i => i.field === 'title');
    assert.ok(issue.localValue);
    assert.ok(issue.remoteValue);
    assert.ok(issue.message);
  });
});

// ---------------------------------------------------------------------------
// compareEntryWithPatent – edge cases
// ---------------------------------------------------------------------------

describe('compareEntryWithPatent – edge cases', () => {
  it('handles an empty PatentsView record gracefully', () => {
    const entry = makeEntry({ title: 'A Better Widget', year: '2018' });
    assert.equal(compareEntryWithPatent(entry, {}).length, 0);
  });

  it('handles a missing patent_date gracefully', () => {
    const entry = makeEntry({ year: '2018' });
    assert.equal(
      compareEntryWithPatent(entry, makePt({ patent_date: undefined }))
        .filter(i => i.field === 'year').length,
      0
    );
  });

  it('accepts a holder matching an individual assignee (no organization)', () => {
    // PatentsView returns names as "Last First" (space-joined), so BibTeX holder
    // should use the same format when there is no assignee_organization.
    const entry = makeEntry({ holder: 'Smith John' });
    const pt = makePt({
      assignees: [{ assignee_organization: null, assignee_last_name: 'Smith', assignee_first_name: 'John' }],
    });
    assert.equal(compareEntryWithPatent(entry, pt).filter(i => i.field === 'holder').length, 0);
  });
});
