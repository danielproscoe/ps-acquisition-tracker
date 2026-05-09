// fetch-filing.mjs — SEC EDGAR client. Pulls company submissions index +
// individual filing documents.
//
// Two endpoints in play:
//   data.sec.gov/submissions/CIK{cik}.json   — recent filings index
//   www.sec.gov/Archives/edgar/data/{cik}/{accession}/{doc}  — filing docs
//
// SEC enforces a 10 req/sec rate limit and requires a User-Agent header.
// Our use case stays well below that — we add a small inter-request delay
// to be polite (not strictly required at our volume).

import { padCIK, SEC_HEADERS, SEC_ARCHIVE_HEADERS } from "./cik-registry.mjs";

const SUBMISSIONS_BASE = "https://data.sec.gov/submissions";
const ARCHIVE_BASE = "https://www.sec.gov/Archives/edgar/data";

async function politeFetch(url, headers) {
  // Brief courtesy delay between requests (200ms = 5 req/s, half the limit).
  await new Promise((r) => setTimeout(r, 200));
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    throw new Error(`SEC EDGAR ${resp.status} on ${url}: ${(await resp.text()).slice(0, 200)}`);
  }
  return resp;
}

/**
 * Fetch the submissions index for a CIK. Returns the SEC's parsed JSON
 * which includes recent filings (form type, date, accession number, primary doc).
 */
export async function fetchSubmissionsIndex(cik) {
  const url = `${SUBMISSIONS_BASE}/CIK${padCIK(cik)}.json`;
  const resp = await politeFetch(url, SEC_HEADERS);
  return resp.json();
}

/**
 * Walk the submissions index and return a list of {form, filingDate,
 * accessionNumber, primaryDocument} for filings matching the predicate.
 */
export function listFilings(submissionsIndex, predicate) {
  const recent = submissionsIndex.filings?.recent;
  if (!recent) return [];
  const n = recent.accessionNumber.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const filing = {
      form: recent.form[i],
      filingDate: recent.filingDate[i],
      reportDate: recent.reportDate[i],
      accessionNumber: recent.accessionNumber[i],
      primaryDocument: recent.primaryDocument[i],
      primaryDocDescription: recent.primaryDocDescription[i],
      isXBRL: recent.isXBRL[i],
    };
    if (!predicate || predicate(filing)) out.push(filing);
  }
  return out;
}

/**
 * Fetch the primary document HTML for a specific filing.
 * Returns raw HTML text.
 */
export async function fetchFilingDocument(cik, accessionNumber, primaryDocument) {
  // Accession numbers in URLs need dashes stripped.
  const accessionNoDashes = accessionNumber.replace(/-/g, "");
  const url = `${ARCHIVE_BASE}/${cik}/${accessionNoDashes}/${primaryDocument}`;
  const resp = await politeFetch(url, SEC_ARCHIVE_HEADERS);
  return resp.text();
}

/**
 * Build the public EDGAR URL for a filing — useful for citing in the
 * comp database (so the audit trail links back to the actual filing).
 */
export function buildFilingURL(cik, accessionNumber, primaryDocument) {
  const accessionNoDashes = accessionNumber.replace(/-/g, "");
  return `${ARCHIVE_BASE}/${cik}/${accessionNoDashes}/${primaryDocument}`;
}

/**
 * Find the most recent filing of a specific form type for a CIK.
 * Returns the filing record or null if none found.
 */
export async function fetchLatestFiling(cik, formType) {
  const idx = await fetchSubmissionsIndex(cik);
  const filings = listFilings(idx, (f) => f.form === formType);
  return filings.length > 0 ? filings[0] : null;
}
