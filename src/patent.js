/**
 * Patent validation via the PatentsView API (US patents only).
 *
 * normalizeUsPatentNumber(raw) — reduce a raw patent number to bare digits for lookup.
 * fetchPatentMetadata(number)  — fetch raw PatentsView record for a US patent number.
 * compareEntryWithPatent(entry, pt) — compare BibTeX fields against PatentsView data.
 *
 * PatentsView API: https://api.patentsview.org/patents/query (v1, POST, JSON)
 * Coverage: US patents only.
 */

const PATENTSVIEW_API = 'https://api.patentsview.org/patents/query';
const USER_AGENT = 'bibtexmcp/1.0 (https://github.com/mcroomp/bibtexmcp)';

// ---------------------------------------------------------------------------
// Patent number normalisation
// ---------------------------------------------------------------------------

/**
 * Reduce a raw patent number to the bare digit string expected by PatentsView.
 *
 * Handles formats like:
 *   "US 9,876,543 B2"  →  "9876543"
 *   "US9876543B2"      →  "9876543"
 *   "9,876,543"        →  "9876543"
 *   "9876543"          →  "9876543"
 *
 * Returns null when the result is not all-digits (e.g. EP / WO / GB patents,
 * or strings that don't contain a recognisable US patent number).
 */
export function normalizeUsPatentNumber(raw) {
  const stripped = raw
    .trim()
    .replace(/^US\s*/i, '')    // strip "US" country-code prefix
    .replace(/[,\s]/g, '')     // strip commas and spaces
    .replace(/[A-Za-z]\d*$/, ''); // strip kind-code suffix (B1, B2, A1, A2 …)
  return /^\d+$/.test(stripped) ? stripped : null;
}

// ---------------------------------------------------------------------------
// PatentsView fetch
// ---------------------------------------------------------------------------

/**
 * Fetch a patent record from PatentsView by its bare US patent number.
 * Returns the first match (patents[0]).
 * Throws on network error, HTTP error, or a not-found result.
 */
export async function fetchPatentMetadata(patentNumber) {
  const body = JSON.stringify({
    q: { patent_number: patentNumber },
    f: [
      'patent_number', 'patent_title', 'patent_date',
      'inventor_last_name', 'inventor_first_name',
      'assignee_organization', 'assignee_last_name', 'assignee_first_name',
    ],
  });

  const res = await fetch(PATENTSVIEW_API, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body,
  });

  if (!res.ok) throw new Error(`PatentsView API returned HTTP ${res.status}`);

  const json = await res.json();
  if (!json.patents || json.patents.length === 0) {
    throw new Error(`Patent "${patentNumber}" not found in PatentsView`);
  }
  return json.patents[0];
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

function norm(s) {
  if (s == null) return '';
  return String(s)
    .replace(/\\[a-zA-Z]+\s*/g, '') // strip LaTeX commands
    .replace(/[{}]/g, '')            // strip brace wrappers
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

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

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Compare a BibTeX @patent entry's fields against a PatentsView record.
 *
 * @param {object} entry  { type, key, fields: Record<string,string> }
 * @param {object} pt     PatentsView patents[0] object
 * @returns {Array<{field, localValue, remoteValue, message}>}
 */
export function compareEntryWithPatent(entry, pt) {
  const issues = [];
  const f = entry.fields;

  function mismatch(field, local, remote) {
    issues.push({
      field,
      localValue:  local  ?? '(missing)',
      remoteValue: remote ?? '(not available)',
      message: `Field "${field}" does not match patent record`,
    });
  }

  // Title
  if (pt.patent_title && f.title !== undefined) {
    if (norm(f.title) !== norm(pt.patent_title)) mismatch('title', f.title, pt.patent_title);
  }

  // Year — patent_date is "YYYY-MM-DD"
  const ptYear = pt.patent_date ? String(pt.patent_date).slice(0, 4) : '';
  if (ptYear && f.year !== undefined) {
    if (f.year.trim() !== ptYear) mismatch('year', f.year, ptYear);
  }

  // Author — compare inventor family names
  if (pt.inventors?.length > 0 && f.author !== undefined) {
    const ptAuthors = pt.inventors
      .map(i => (i.inventor_last_name ?? '').toLowerCase().trim())
      .filter(Boolean)
      .join(' ');
    const bibAuthors = normBibAuthors(f.author);
    if (ptAuthors && bibAuthors && ptAuthors !== bibAuthors) {
      const remote = pt.inventors
        .map(i => [i.inventor_last_name, i.inventor_first_name].filter(Boolean).join(', '))
        .join(' and ');
      issues.push({
        field:       'author',
        localValue:  f.author,
        remoteValue: remote,
        message:     'Author list does not match patent record (compared by family name)',
      });
    }
  }

  // Holder — compare against primary assignee
  if (pt.assignees?.length > 0 && f.holder !== undefined) {
    const a0 = pt.assignees[0];
    const ptHolder = norm(
      a0.assignee_organization ||
      [a0.assignee_last_name, a0.assignee_first_name].filter(Boolean).join(' ')
    );
    if (ptHolder && norm(f.holder) !== ptHolder) {
      const remote = pt.assignees
        .map(a => a.assignee_organization ||
          [a.assignee_last_name, a.assignee_first_name].filter(Boolean).join(' '))
        .filter(Boolean)
        .join(' and ');
      mismatch('holder', f.holder, remote);
    }
  }

  return issues;
}
