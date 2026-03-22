/**
 * DOI validation via Crossref API.
 *
 * fetchDoiMetadata(doi) — fetch raw Crossref message for a DOI.
 * compareEntryWithDoi(entry, crMessage) — compare BibTeX fields against Crossref data.
 */

const CROSSREF_API = 'https://api.crossref.org/works/';
const USER_AGENT = 'bibtexmcp/1.0 (https://github.com/mcroomp/bibtexmcp)';

// ---------------------------------------------------------------------------
// Crossref fetch
// ---------------------------------------------------------------------------

/**
 * Fetch metadata for a DOI from the Crossref API.
 * Returns the raw `message` object from the Crossref response.
 * Throws on network failure, HTTP errors, or a 404.
 */
export async function fetchDoiMetadata(doi) {
  const url = `${CROSSREF_API}${encodeURIComponent(doi)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (res.status === 404) throw new Error(`DOI "${doi}" not found in Crossref`);
  if (!res.ok) throw new Error(`Crossref API returned HTTP ${res.status}`);
  const json = await res.json();
  return json.message;
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a string for fuzzy comparison:
 * strip LaTeX braces/commands, lowercase, collapse whitespace.
 */
function norm(s) {
  if (s == null) return '';
  return String(s)
    .replace(/\\[a-zA-Z]+\s*/g, '')  // strip LaTeX commands like \emph
    .replace(/[{}]/g, '')            // strip brace wrappers
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

/**
 * Build a comparable author string from a Crossref author array.
 * Produces a space-joined list of lowercased family names, e.g. "smith jones brown".
 */
function normCrossrefAuthors(crossrefAuthors) {
  if (!Array.isArray(crossrefAuthors) || crossrefAuthors.length === 0) return '';
  return crossrefAuthors
    .map(a => (a.family ?? '').toLowerCase().trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Extract and normalise family names from a BibTeX author string.
 * Handles both "Family, Given and Family, Given" and "Given Family and Given Family".
 * Returns the same space-joined format as normCrossrefAuthors.
 */
function normBibAuthors(bibAuthors) {
  if (!bibAuthors) return '';
  const clean = bibAuthors
    .replace(/\\[a-zA-Z]+\s*/g, '')
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

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Compare a BibTeX entry's fields against Crossref metadata.
 *
 * @param {object} entry  { type, key, fields: Record<string,string> }
 * @param {object} cr     Raw Crossref `message` object
 * @returns {Array<{field, localValue, remoteValue, message}>}
 */
export function compareEntryWithDoi(entry, cr) {
  const issues = [];
  const f = entry.fields;

  function mismatch(field, local, remote) {
    issues.push({
      field,
      localValue:  local  ?? '(missing)',
      remoteValue: remote ?? '(not available)',
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

  // Authors — compare last-name lists
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
      message:     'Author list does not match DOI record (compared by family name)',
    });
  }

  // Journal / container-title
  const crContainer = cr['container-title']?.[0];
  if (crContainer) {
    if (f.journal !== undefined && norm(f.journal) !== norm(crContainer)) {
      mismatch('journal', f.journal, crContainer);
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
