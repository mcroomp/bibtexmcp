/**
 * DOI metadata via Crossref API, with DataCite fallback.
 *
 * fetchDoiMetadata(doi)            — fetch normalised metadata for a DOI (Crossref, then DataCite).
 * lookupDoiByMetadata(opts, rows)  — search Crossref for a DOI by title/author/year/journal.
 * compareEntryWithDoi(entry, cr)   — compare BibTeX fields against fetched metadata.
 * crossrefToBibFields(cr, fields)  — convert normalised metadata to corrected BibTeX field values.
 */

const CROSSREF_API    = 'https://api.crossref.org/works/';
const CROSSREF_SEARCH = 'https://api.crossref.org/works';
const DATACITE_API    = 'https://api.datacite.org/dois/';
const USER_AGENT      = 'bibtexmcp/1.0 (https://github.com/mcroomp/bibtexmcp)';

// ---------------------------------------------------------------------------
// DOI fetch — Crossref with DataCite fallback
// ---------------------------------------------------------------------------

/**
 * Fetch metadata for an arXiv DOI (10.48550/arXiv.*) via the arXiv API,
 * normalised to Crossref message shape.
 */
async function fetchFromArxiv(arxivId) {
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`arXiv API returned HTTP ${res.status}`);
  const xml = await res.text();

  // Parse Atom entry fields with simple regex — no DOM dependency needed
  const get  = (tag, ns = '')  => xml.match(new RegExp(`<${ns}${tag}[^>]*>([\\s\\S]*?)<\\/${ns}${tag}>`))?.[1]?.trim() ?? null;
  const getAll = (tag, ns = '') => [...xml.matchAll(new RegExp(`<${ns}${tag}[^>]*>([\\s\\S]*?)<\\/${ns}${tag}>`, 'g'))].map(m => m[1].trim());

  if (xml.includes('<opensearch:totalResults>0</opensearch:totalResults>')) {
    throw new Error(`arXiv ID "${arxivId}" not found`);
  }

  const out = {};

  const title = get('title');
  // Skip the feed-level <title> (first match) — the entry title is the second
  const titles = getAll('title');
  const entryTitle = titles.length > 1 ? titles[1] : titles[0];
  if (entryTitle) out.title = [entryTitle.replace(/\s+/g, ' ')];

  const published = get('published');
  const year = published ? parseInt(published.slice(0, 4), 10) : null;
  if (year) out.published = { 'date-parts': [[year]] };

  // Authors: <author><name>Given Family</name></author>
  const authorNames = getAll('name');
  if (authorNames.length) {
    out.author = authorNames.map(name => {
      const parts = name.trim().split(/\s+/);
      const family = parts.pop() ?? '';
      const given  = parts.join(' ');
      return { family, given };
    });
  }

  // Journal ref if available (e.g. already published)
  const journalRef = get('journal_ref', 'arxiv:');
  if (journalRef) out['container-title'] = [journalRef];

  out.publisher = 'arXiv';

  return out;
}

/**
 * Fetch metadata for a DOI from DataCite and normalise it to the same shape
 * as a Crossref `message` object so downstream code can treat both uniformly.
 */
async function fetchFromDatacite(doi) {
  const url = `${DATACITE_API}${encodeURIComponent(doi)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (res.status === 404) {
    // Last resort: check if the DOI at least resolves at doi.org.
    // If it does, the DOI is valid but belongs to a registry with no metadata API
    // (e.g. ACM pseudo-DOIs 10.5555, some institutional repositories, etc.).
    try {
      const doiRes = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, {
        method: 'HEAD',
        headers: { 'User-Agent': USER_AGENT },
      });
      if (doiRes.ok) {
        const e = new Error(
          `DOI "${doi}" is valid but has no metadata API (not in Crossref or DataCite). ` +
          `Use web search to find metadata: https://doi.org/${doi}`
        );
        e.code = 'DOI_NO_API';
        e.doiUrl = `https://doi.org/${doi}`;
        throw e;
      }
    } catch (inner) {
      if (inner.code === 'DOI_NO_API') throw inner;
      // doi.org unreachable or errored — fall through to generic error
    }
    throw new Error(`DOI "${doi}" not found in Crossref, DataCite, or doi.org`);
  }
  if (!res.ok) throw new Error(`DataCite API returned HTTP ${res.status}`);
  const json = await res.json();
  const attr = json.data?.attributes;
  if (!attr) throw new Error(`DataCite returned unexpected response for DOI "${doi}"`);

  // Normalise DataCite attributes to the Crossref message shape
  const out = {};

  const title = attr.titles?.[0]?.title;
  if (title) out.title = [title];

  const year = attr.publicationYear;
  if (year != null) out.published = { 'date-parts': [[year]] };

  if (attr.creators?.length) {
    out.author = attr.creators.map(c =>
      c.familyName
        ? { family: c.familyName, given: c.givenName ?? '' }
        : { family: c.name ?? '', given: '' }         // org / single-name
    );
  }

  const container = attr.container?.title;
  if (container) out['container-title'] = [container];

  if (attr.publisher) out.publisher = attr.publisher;

  return out;
}

/**
 * Fetch normalised metadata for a DOI.
 * Tries Crossref first; falls back to DataCite for DOIs not registered there
 * (e.g. arXiv 10.48550/*, Zenodo 10.5281/*, DataCite-only publishers).
 * Returns a Crossref-shaped `message` object in both cases.
 * Throws on network failure, HTTP errors, or DOI not found in either registry.
 */
export async function fetchDoiMetadata(doi) {
  // arXiv DOIs (10.48550/arXiv.*) are registered with DataCite but the arXiv
  // API returns richer, more reliable metadata — use it directly.
  const arxivMatch = doi.match(/^10\.48550\/arXiv\.(.+)$/i);
  if (arxivMatch) return fetchFromArxiv(arxivMatch[1]);

  const url = `${CROSSREF_API}${encodeURIComponent(doi)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (res.status === 404) return fetchFromDatacite(doi);
  if (!res.ok) throw new Error(`Crossref API returned HTTP ${res.status}`);
  const json = await res.json();
  return json.message;
}

/**
 * Search Crossref for a DOI given bibliographic metadata.
 *
 * @param {{ title?, author?, year?, journal? }} opts  Search fields (at least one required)
 * @param {number} rows  Maximum number of candidates to return (default 5)
 * @returns {Array<{ doi, title, year, authors, journal, score }>}
 */
export async function lookupDoiByMetadata({ title, author, year, journal } = {}, rows = 5) {
  const queryParts = [title, author].filter(Boolean).join(' ');
  if (!queryParts) throw new Error('At least one of title or author must be provided');

  const params = new URLSearchParams({
    'query.bibliographic': queryParts,
    rows: String(rows),
    select: 'DOI,title,author,published,container-title,score',
  });
  if (journal) params.set('query.container-title', journal);
  if (year)    params.set('filter', `from-pub-date:${year},until-pub-date:${year}`);

  const url = `${CROSSREF_SEARCH}?${params}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Crossref API returned HTTP ${res.status}`);
  const json = await res.json();

  return json.message.items.map(item => ({
    doi:     item.DOI ?? null,
    title:   item.title?.[0] ?? null,
    year:    item.published?.['date-parts']?.[0]?.[0] ?? null,
    authors: item.author?.map(a => [a.family, a.given].filter(Boolean).join(', ')).join(' and ') ?? null,
    journal: item['container-title']?.[0] ?? null,
    score:   item.score ?? null,
  }));
}

/**
 * Build a map of corrected BibTeX field values from a Crossref message,
 * limited to fields that are present in `existingFields`.
 *
 * Container-title is mapped to `journal` and/or `booktitle` based on which keys
 * exist in the local entry.
 *
 * @param {object} cr             Raw Crossref message
 * @param {object} existingFields The entry's current fields (used to decide journal vs booktitle)
 * @returns {Record<string, string>}
 */
export function crossrefToBibFields(cr, existingFields = {}) {
  const out = {};

  if (cr.title?.[0] != null)             out.title     = cr.title[0];
  const year = cr.published?.['date-parts']?.[0]?.[0];
  if (year != null)                      out.year      = String(year);
  if (cr.author?.length) {
    out.author = cr.author
      .map(a => [a.family, a.given].filter(Boolean).join(', '))
      .join(' and ');
  }
  const container = cr['container-title']?.[0];
  if (container != null) {
    if ('journal'   in existingFields) out.journal   = container;
    if ('booktitle' in existingFields) out.booktitle = container;
  }
  if (cr.volume    != null) out.volume    = String(cr.volume);
  if (cr.issue     != null) out.number    = String(cr.issue);
  if (cr.page      != null) out.pages     = cr.page.replace(/(?<!-)-(?!-)/, '--');
  if (cr.publisher != null) out.publisher = cr.publisher;

  return out;
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a string for fuzzy comparison:
 * - NFD decompose + strip combining diacritics  (ü→u, é→e, ç→c, \c{c}→c, \"u→u)
 * - strip LaTeX commands (\emph, \", \c, etc.)
 * - strip brace wrappers
 * - lowercase + collapse whitespace
 */
function norm(s) {
  if (s == null) return '';
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip combining diacritics (ü→u, é→e)
    .replace(/\\["'`^~=.]\s*/g, '')    // strip LaTeX one-char diacritic commands (\", \', \`, etc.)
    .replace(/\\[a-zA-Z]+\s*/g, '')    // strip LaTeX word commands (\emph, \c, \u, etc.)
    .replace(/[{}]/g, '')              // strip brace wrappers
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

/**
 * Build a comparable author string from a Crossref author array.
 * Produces a space-joined list of normalised family names.
 */
function normCrossrefAuthors(crossrefAuthors) {
  if (!Array.isArray(crossrefAuthors) || crossrefAuthors.length === 0) return '';
  return crossrefAuthors
    .map(a => norm(a.family ?? ''))
    .filter(Boolean)
    .join(' ');
}

/**
 * Extract and normalise family names from a BibTeX author string.
 * Handles "Family, Given and Family, Given" and "Given Family and Given Family".
 * Applies the same NFD + LaTeX stripping as norm().
 */
function normBibAuthors(bibAuthors) {
  if (!bibAuthors) return '';
  const clean = String(bibAuthors)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip combining diacritics
    .replace(/\\["'`^~=.]\s*/g, '')    // strip one-char diacritic commands
    .replace(/\\[a-zA-Z]+\s*/g, '')    // strip word commands
    .replace(/[{}]/g, '');
  return clean
    .split(/\s+and\s+/i)
    .map(a => {
      a = a.trim();
      if (a.includes(',')) return a.split(',')[0].toLowerCase().trim();
      const parts = a.split(/\s+/);
      return (parts[parts.length - 1] ?? '').toLowerCase().trim();
    })
    .filter(Boolean)
    .join(' ');
}

/** Normalise page strings so "1-10", "1--10", and "1–10" all compare equal. */
function normPages(s) {
  return norm(s).replace(/[-–—]+/g, '--');
}

/**
 * Classify a field mismatch as 'cosmetic' or 'substantive'.
 *
 * Cosmetic: purely a formatting difference (journal abbreviation, publisher short
 * name, Crossref-truncated subtitle) that won't affect rendered output.
 * Substantive: actual content error — wrong year, different people in author list, etc.
 */
function mismatchwSeverity(field, localNorm, remoteNorm) {
  if (['journal', 'booktitle', 'publisher', 'title'].includes(field)) {
    // One value is a prefix of the other → abbreviation or Crossref truncation
    if (localNorm.startsWith(remoteNorm) || remoteNorm.startsWith(localNorm)) {
      return 'cosmetic';
    }
  }
  return 'substantive';
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Compare a BibTeX entry's fields against Crossref metadata.
 *
 * @param {object} entry  { type, key, fields: Record<string,string> }
 * @param {object} cr     Raw Crossref `message` object
 * @returns {Array<{ field, localValue, remoteValue, severity, message }>}
 *   severity: 'cosmetic' | 'substantive'
 */
export function compareEntryWithDoi(entry, cr) {
  const issues = [];
  const f = entry.fields;

  function mismatch(field, local, remote) {
    const severity = mismatchwSeverity(field, norm(local ?? ''), norm(remote ?? ''));
    issues.push({
      field,
      localValue:  local  ?? '(missing)',
      remoteValue: remote ?? '(not available)',
      severity,
      message: `Field "${field}" does not match DOI record`,
    });
  }

  // Title
  const crTitle = cr.title?.[0];
  if (crTitle && f.title !== undefined) {
    if (norm(f.title) !== norm(crTitle)) mismatch('title', f.title, crTitle);
  }

  // Year — from published.date-parts[0][0]
  const crYear = String(cr.published?.['date-parts']?.[0]?.[0] ?? '');
  if (crYear && f.year !== undefined) {
    if (f.year.trim() !== crYear) mismatch('year', f.year, crYear);
  }

  // Authors — compare normalised family-name lists
  const crAuthors  = normCrossrefAuthors(cr.author);
  const bibAuthors = normBibAuthors(f.author);
  if (crAuthors && bibAuthors && crAuthors !== bibAuthors) {
    const remote = cr.author
      ?.map(a => [a.family, a.given].filter(Boolean).join(', '))
      .join(' and ');
    issues.push({
      field:       'author',
      localValue:  f.author,
      remoteValue: remote ?? '(not available)',
      severity:    'substantive',
      message:     'Author list does not match DOI record (compared by family name)',
    });
  }

  // Journal / container-title
  const crContainer = cr['container-title']?.[0];
  if (crContainer) {
    if (f.journal   !== undefined && norm(f.journal)   !== norm(crContainer)) {
      mismatch('journal',   f.journal,   crContainer);
    }
    if (f.booktitle !== undefined && norm(f.booktitle) !== norm(crContainer)) {
      mismatch('booktitle', f.booktitle, crContainer);
    }
  }

  // Volume
  if (cr.volume !== undefined && f.volume !== undefined) {
    if (norm(f.volume) !== norm(String(cr.volume))) mismatch('volume', f.volume, String(cr.volume));
  }

  // Issue → number
  if (cr.issue !== undefined && f.number !== undefined) {
    if (norm(f.number) !== norm(String(cr.issue))) mismatch('number', f.number, String(cr.issue));
  }

  // Pages
  if (cr.page !== undefined && f.pages !== undefined) {
    if (normPages(f.pages) !== normPages(cr.page)) mismatch('pages', f.pages, cr.page);
  }

  // Publisher
  if (cr.publisher !== undefined && f.publisher !== undefined) {
    if (norm(f.publisher) !== norm(cr.publisher)) mismatch('publisher', f.publisher, cr.publisher);
  }

  return issues;
}
