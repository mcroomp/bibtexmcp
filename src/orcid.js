/**
 * ORCID public API client.
 *
 * fetchOrcidWorks(orcidId)          — fetch all work groups for an ORCID profile.
 * fetchOrcidWork(orcidId, putCode)  — fetch a single full work record (with contributors).
 * orcidWorkTypeToBibType(type)      — map ORCID work type to BibTeX entry type.
 * orcidWorkToFields(work)           — extract BibTeX fields from a full work record.
 * orcidSummaryToFields(summary)     — extract BibTeX fields from a work-summary (no authors).
 * makeCiteKey(fields, putCode)      — generate a citation key from entry fields.
 * normalizeOrcidId(input)           — strip URL prefix from an ORCID iD.
 */

const ORCID_API  = 'https://pub.orcid.org/v3.0';
const USER_AGENT = 'bibtexmcp/1.0 (https://github.com/mcroomp/bibtexmcp)';

// ---------------------------------------------------------------------------
// Work-type mapping
// ---------------------------------------------------------------------------

const WORK_TYPE_MAP = {
  'journal-article':      'article',
  'magazine-article':     'article',
  'newsletter-article':   'article',
  'review':               'article',
  'book':                 'book',
  'edited-book':          'book',
  'reference-book':       'book',
  'book-chapter':         'incollection',
  'reference-entry':      'incollection',
  'conference-paper':     'inproceedings',
  'conference-abstract':  'inproceedings',
  'conference-poster':    'inproceedings',
  'thesis':               'phdthesis',
  'report':               'techreport',
  'supervised-student-publication': 'misc',
  'test':                 'misc',
  'preprint':             'misc',
  'working-paper':        'unpublished',
  'dataset':              'misc',
  'software':             'misc',
  'invention':            'misc',
  'disclosure':           'misc',
  'license':              'misc',
  'patent':               'misc',
  'registered-copyright': 'misc',
  'other':                'misc',
  'undefined':            'misc',
};

export function orcidWorkTypeToBibType(orcidType) {
  return WORK_TYPE_MAP[orcidType ?? 'undefined'] ?? 'misc';
}

// ---------------------------------------------------------------------------
// ORCID iD normalisation
// ---------------------------------------------------------------------------

export function normalizeOrcidId(input) {
  return String(input)
    .replace(/^https?:\/\/orcid\.org\//i, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Field extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract a DOI from an ORCID external-ids block.
 * Prefers "self" relationship; falls back to any doi entry.
 */
export function extractDoi(externalIds) {
  const ids = externalIds?.['external-id'] ?? [];
  const self = ids.find(
    id => id['external-id-type'] === 'doi' && id['external-id-relationship'] === 'self'
  );
  const any = ids.find(id => id['external-id-type'] === 'doi');
  const match = self ?? any ?? null;
  return match?.['external-id-normalized']?.value ?? match?.['external-id-value'] ?? null;
}

/** Extract journal/booktitle from ORCID's journal-title field (object or string). */
function extractJournalTitle(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw.value ?? null;
  return String(raw);
}

/** Convert ORCID contributor list to a BibTeX author string. */
function contributorsToAuthor(contributors) {
  const list = contributors?.contributor ?? [];
  const authors = list
    .filter(c => c['contributor-attributes']?.['contributor-role'] === 'author')
    .map(c => c['credit-name']?.value)
    .filter(Boolean);
  return authors.length ? authors.join(' and ') : null;
}

/**
 * Build a BibTeX-type + fields object from a full ORCID work record.
 * Full records include contributors; use this for works without DOIs.
 */
export function orcidWorkToFields(work) {
  const type   = orcidWorkTypeToBibType(work.type);
  const fields = {};

  const title = work.title?.title?.value;
  if (title) fields.title = title;

  const year  = work['publication-date']?.year?.value;
  const month = work['publication-date']?.month?.value;
  if (year)  fields.year  = year;
  if (month) fields.month = month;

  const author = contributorsToAuthor(work.contributors);
  if (author) fields.author = author;

  const doi = extractDoi(work['external-ids']);
  if (doi) fields.doi = doi;

  const url = work.url?.value;
  if (url && !doi) fields.url = url;

  const journalTitle = extractJournalTitle(work['journal-title']);
  if (journalTitle) {
    if (type === 'article')        fields.journal   = journalTitle;
    else if (type === 'inproceedings') fields.booktitle = journalTitle;
    else                           fields.journal   = journalTitle;
  }

  return { type, fields };
}

/**
 * Build a BibTeX-type + fields object from a work-summary.
 * Summaries do not include contributors, so author will be absent.
 */
export function orcidSummaryToFields(summary) {
  const type   = orcidWorkTypeToBibType(summary.type);
  const fields = {};

  const title = summary.title?.title?.value;
  if (title) fields.title = title;

  const year  = summary['publication-date']?.year?.value;
  const month = summary['publication-date']?.month?.value;
  if (year)  fields.year  = year;
  if (month) fields.month = month;

  const doi = extractDoi(summary['external-ids']);
  if (doi) fields.doi = doi;

  const url = summary.url?.value;
  if (url && !doi) fields.url = url;

  const journalTitle = extractJournalTitle(summary['journal-title']);
  if (journalTitle) {
    if (type === 'article')            fields.journal   = journalTitle;
    else if (type === 'inproceedings') fields.booktitle = journalTitle;
    else                               fields.journal   = journalTitle;
  }

  return { type, fields };
}

/**
 * Generate a citation key from entry fields.
 * Format: {firstAuthorFamilyName}{year}  (e.g. "smith2023")
 * Falls back to first meaningful title word + year, then "orcid{putCode}".
 */
export function makeCiteKey(fields, putCode) {
  const year = fields.year ?? '';

  // Try first author's family name
  const authorStr   = fields.author ?? '';
  const firstAuthor = authorStr.split(/\s+and\s+/i)[0]?.trim() ?? '';
  const familyRaw   = firstAuthor.includes(',')
    ? firstAuthor.split(',')[0].trim()
    : (firstAuthor.split(/\s+/).pop() ?? '');
  const family = familyRaw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
  if (family) return `${family}${year}`;

  // Fall back to first substantial title word
  const titleWord = (fields.title ?? '')
    .split(/\s+/)
    .find(w => w.length >= 4 && /^[a-zA-Z]/i.test(w));
  if (titleWord) {
    const t = titleWord
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
    if (t) return `${t}${year}`;
  }

  return `orcid${putCode}`;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/**
 * Fetch all work groups for an ORCID profile.
 * Each group represents one work (possibly with multiple sources as summaries).
 */
export async function fetchOrcidWorks(orcidId) {
  const id  = normalizeOrcidId(orcidId);
  const url = `${ORCID_API}/${id}/works`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (res.status === 404) throw new Error(`ORCID profile "${id}" not found`);
  if (!res.ok) throw new Error(`ORCID API returned HTTP ${res.status}`);
  const json = await res.json();
  return json.group ?? [];
}

/**
 * Fetch a single full work record (includes contributors).
 */
export async function fetchOrcidWork(orcidId, putCode) {
  const id  = normalizeOrcidId(orcidId);
  const url = `${ORCID_API}/${id}/work/${putCode}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`ORCID API returned HTTP ${res.status} for work ${putCode}`);
  return res.json();
}
