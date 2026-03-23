import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeOrcidId,
  orcidWorkTypeToBibType,
  orcidSummaryToFields,
  orcidWorkToFields,
  makeCiteKey,
  extractDoi,
} from '../src/orcid.js';

// ---------------------------------------------------------------------------
// normalizeOrcidId
// ---------------------------------------------------------------------------

test('normalizeOrcidId strips URL prefix', () => {
  assert.equal(
    normalizeOrcidId('https://orcid.org/0000-0001-5985-691X'),
    '0000-0001-5985-691X'
  );
});

test('normalizeOrcidId leaves bare iD unchanged', () => {
  assert.equal(normalizeOrcidId('0000-0001-5985-691X'), '0000-0001-5985-691X');
});

test('normalizeOrcidId handles http prefix', () => {
  assert.equal(
    normalizeOrcidId('http://orcid.org/0000-0002-1825-0097'),
    '0000-0002-1825-0097'
  );
});

// ---------------------------------------------------------------------------
// orcidWorkTypeToBibType
// ---------------------------------------------------------------------------

test('orcidWorkTypeToBibType maps journal-article to article', () => {
  assert.equal(orcidWorkTypeToBibType('journal-article'), 'article');
});

test('orcidWorkTypeToBibType maps conference-paper to inproceedings', () => {
  assert.equal(orcidWorkTypeToBibType('conference-paper'), 'inproceedings');
});

test('orcidWorkTypeToBibType maps book-chapter to incollection', () => {
  assert.equal(orcidWorkTypeToBibType('book-chapter'), 'incollection');
});

test('orcidWorkTypeToBibType maps thesis to phdthesis', () => {
  assert.equal(orcidWorkTypeToBibType('thesis'), 'phdthesis');
});

test('orcidWorkTypeToBibType maps unknown type to misc', () => {
  assert.equal(orcidWorkTypeToBibType('invented-type'), 'misc');
});

test('orcidWorkTypeToBibType handles null', () => {
  assert.equal(orcidWorkTypeToBibType(null), 'misc');
});

// ---------------------------------------------------------------------------
// extractDoi
// ---------------------------------------------------------------------------

test('extractDoi returns DOI from self external-id', () => {
  const externalIds = {
    'external-id': [
      {
        'external-id-type': 'doi',
        'external-id-value': '10.1145/3757887.3763007',
        'external-id-normalized': { value: '10.1145/3757887.3763007', transient: true },
        'external-id-relationship': 'self',
      },
    ],
  };
  assert.equal(extractDoi(externalIds), '10.1145/3757887.3763007');
});

test('extractDoi returns null when no DOI present', () => {
  const externalIds = {
    'external-id': [
      {
        'external-id-type': 'lensid',
        'external-id-value': '123-456',
        'external-id-relationship': 'self',
      },
    ],
  };
  assert.equal(extractDoi(externalIds), null);
});

test('extractDoi returns null for null input', () => {
  assert.equal(extractDoi(null), null);
});

test('extractDoi uses external-id-normalized value when present', () => {
  const externalIds = {
    'external-id': [
      {
        'external-id-type': 'doi',
        'external-id-value': '10.1000/XYZ',
        'external-id-normalized': { value: '10.1000/xyz' },
        'external-id-relationship': 'self',
      },
    ],
  };
  assert.equal(extractDoi(externalIds), '10.1000/xyz');
});

// ---------------------------------------------------------------------------
// orcidSummaryToFields
// ---------------------------------------------------------------------------

const ARTICLE_SUMMARY = {
  type: 'journal-article',
  title: { title: { value: 'Machine Learning in Practice' } },
  'publication-date': { year: { value: '2023' }, month: { value: '06' } },
  'external-ids': {
    'external-id': [{
      'external-id-type': 'doi',
      'external-id-value': '10.1000/test.123',
      'external-id-normalized': { value: '10.1000/test.123' },
      'external-id-relationship': 'self',
    }],
  },
  'journal-title': { value: 'Journal of ML' },
  url: { value: 'https://doi.org/10.1000/test.123' },
};

test('orcidSummaryToFields extracts article fields', () => {
  const { type, fields } = orcidSummaryToFields(ARTICLE_SUMMARY);
  assert.equal(type, 'article');
  assert.equal(fields.title, 'Machine Learning in Practice');
  assert.equal(fields.year, '2023');
  assert.equal(fields.month, '06');
  assert.equal(fields.doi, '10.1000/test.123');
  assert.equal(fields.journal, 'Journal of ML');
  // url omitted because doi is present
  assert.equal(fields.url, undefined);
});

test('orcidSummaryToFields maps conference-paper booktitle', () => {
  const summary = {
    type: 'conference-paper',
    title: { title: { value: 'A Conference Paper' } },
    'publication-date': { year: { value: '2022' } },
    'external-ids': { 'external-id': [] },
    'journal-title': { value: 'Proc. of Some Conference' },
    url: null,
  };
  const { type, fields } = orcidSummaryToFields(summary);
  assert.equal(type, 'inproceedings');
  assert.equal(fields.booktitle, 'Proc. of Some Conference');
  assert.equal(fields.journal, undefined);
});

test('orcidSummaryToFields includes url when no doi', () => {
  const summary = {
    type: 'other',
    title: { title: { value: 'Some Work' } },
    'publication-date': { year: { value: '2021' } },
    'external-ids': { 'external-id': [] },
    'journal-title': null,
    url: { value: 'https://example.com/work' },
  };
  const { fields } = orcidSummaryToFields(summary);
  assert.equal(fields.url, 'https://example.com/work');
  assert.equal(fields.doi, undefined);
});

test('orcidSummaryToFields handles null journal-title', () => {
  const summary = {
    type: 'journal-article',
    title: { title: { value: 'Test' } },
    'publication-date': { year: { value: '2020' } },
    'external-ids': { 'external-id': [] },
    'journal-title': null,
    url: null,
  };
  const { fields } = orcidSummaryToFields(summary);
  assert.equal(fields.journal, undefined);
});

// ---------------------------------------------------------------------------
// orcidWorkToFields
// ---------------------------------------------------------------------------

const FULL_WORK = {
  type: 'journal-article',
  title: { title: { value: 'Deep Learning Survey' } },
  'publication-date': { year: { value: '2024' }, month: { value: '03' } },
  'external-ids': {
    'external-id': [{
      'external-id-type': 'doi',
      'external-id-value': '10.9999/survey.2024',
      'external-id-normalized': { value: '10.9999/survey.2024' },
      'external-id-relationship': 'self',
    }],
  },
  'journal-title': { value: 'Neural Networks' },
  url: { value: 'https://doi.org/10.9999/survey.2024' },
  contributors: {
    contributor: [
      {
        'credit-name': { value: 'Alice Smith' },
        'contributor-attributes': { 'contributor-role': 'author' },
      },
      {
        'credit-name': { value: 'Bob Jones' },
        'contributor-attributes': { 'contributor-role': 'author' },
      },
      {
        'credit-name': { value: 'Eve Editor' },
        'contributor-attributes': { 'contributor-role': 'editor' },
      },
    ],
  },
};

test('orcidWorkToFields extracts contributors as BibTeX author string', () => {
  const { type, fields } = orcidWorkToFields(FULL_WORK);
  assert.equal(type, 'article');
  assert.equal(fields.author, 'Alice Smith and Bob Jones');
  // editor role excluded from author field
  assert.ok(!fields.author.includes('Eve Editor'));
});

test('orcidWorkToFields sets title, year, doi, journal', () => {
  const { fields } = orcidWorkToFields(FULL_WORK);
  assert.equal(fields.title, 'Deep Learning Survey');
  assert.equal(fields.year, '2024');
  assert.equal(fields.month, '03');
  assert.equal(fields.doi, '10.9999/survey.2024');
  assert.equal(fields.journal, 'Neural Networks');
});

test('orcidWorkToFields handles empty contributors', () => {
  const work = { ...FULL_WORK, contributors: { contributor: [] } };
  const { fields } = orcidWorkToFields(work);
  assert.equal(fields.author, undefined);
});

test('orcidWorkToFields handles null contributors', () => {
  const work = { ...FULL_WORK, contributors: null };
  const { fields } = orcidWorkToFields(work);
  assert.equal(fields.author, undefined);
});

// ---------------------------------------------------------------------------
// makeCiteKey
// ---------------------------------------------------------------------------

test('makeCiteKey uses first author family name + year (Family, Given format)', () => {
  const fields = { author: 'Smith, Alice and Jones, Bob', year: '2023' };
  assert.equal(makeCiteKey(fields, 99), 'smith2023');
});

test('makeCiteKey uses first author family name + year (Given Family format)', () => {
  const fields = { author: 'Alice Smith and Bob Jones', year: '2023' };
  assert.equal(makeCiteKey(fields, 99), 'smith2023');
});

test('makeCiteKey falls back to title word when no author', () => {
  const fields = { title: 'A Survey of Deep Learning Methods', year: '2022' };
  assert.equal(makeCiteKey(fields, 42), 'survey2022');
});

test('makeCiteKey falls back to orcid+putCode when no author or title', () => {
  assert.equal(makeCiteKey({}, 12345), 'orcid12345');
});

test('makeCiteKey strips accents from family name', () => {
  const fields = { author: 'Müller, Hans', year: '2021' };
  assert.equal(makeCiteKey(fields, 1), 'muller2021');
});

test('makeCiteKey handles missing year gracefully', () => {
  const fields = { author: 'Taylor, Sam' };
  assert.equal(makeCiteKey(fields, 7), 'taylor');
});

test('makeCiteKey skips short title words when choosing fallback', () => {
  // "A", "The", "In" are short — skip; first word >= 4 chars is used
  const fields = { title: 'A New Deep Framework', year: '2020' };
  assert.equal(makeCiteKey(fields, 5), 'deep2020');
});
