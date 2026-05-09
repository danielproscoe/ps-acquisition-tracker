// fetch-filing-docs.mjs — Multi-document filing handler. Some issuers
// (notably SmartStop) put Schedule III in a SEPARATE exhibit file rather
// than the primary 10-K HTM. The SEC's per-filing index.json lists all
// attached documents so we can find and fetch the right one.

import { SEC_ARCHIVE_HEADERS } from "./cik-registry.mjs";

const ARCHIVE_BASE = "https://www.sec.gov/Archives/edgar/data";

async function politeFetch(url) {
  await new Promise((r) => setTimeout(r, 200));
  const resp = await fetch(url, { headers: SEC_ARCHIVE_HEADERS });
  if (!resp.ok) throw new Error(`SEC EDGAR ${resp.status} on ${url}`);
  return resp;
}

/**
 * Fetch the per-filing document index for an accession number.
 * Returns an array of {name, type, size, url} for every document in the filing.
 */
export async function fetchFilingDocList(cik, accessionNumber) {
  const accessionNoDashes = accessionNumber.replace(/-/g, "");
  const url = `${ARCHIVE_BASE}/${cik}/${accessionNoDashes}/index.json`;
  const resp = await politeFetch(url);
  const data = await resp.json();
  const items = data?.directory?.item || [];
  return items.map((item) => ({
    name: item.name,
    type: item.type,
    size: parseInt(item.size, 10),
    lastModified: item["last-modified"],
    url: `${ARCHIVE_BASE}/${cik}/${accessionNoDashes}/${item.name}`,
  }));
}

/**
 * Find the Schedule III exhibit for a multi-document filing. Heuristic:
 *   - Filename contains "schedule" / "scheduleiii" / "ex-99" / "exhibit99"
 *   - OR file is in the .htm range and has a smaller size (suggests
 *     supplementary schedule rather than the primary narrative)
 */
export async function findScheduleIIIDoc(cik, accessionNumber) {
  const docs = await fetchFilingDocList(cik, accessionNumber);
  // Prefer documents with "schedule" or "exhibit" in the name
  const candidates = docs.filter((d) =>
    /\.htm$/i.test(d.name) &&
    (
      /schedule/i.test(d.name) ||
      /exhibit/i.test(d.name) ||
      /ex.?99/i.test(d.name) ||
      /^s-?\d/i.test(d.name) ||  // page S-1 style filenames
      /real.?estate/i.test(d.name)
    )
  );
  return candidates;
}

/**
 * Fetch all .htm documents for a filing and concatenate their text. Used
 * as a fallback when we don't know which specific doc holds the schedule.
 */
export async function fetchAllFilingHTMs(cik, accessionNumber) {
  const docs = await fetchFilingDocList(cik, accessionNumber);
  const htmDocs = docs.filter((d) => /\.htm$/i.test(d.name) && !/cover|signature/i.test(d.name));
  const results = [];
  for (const doc of htmDocs) {
    try {
      const resp = await politeFetch(doc.url);
      const html = await resp.text();
      results.push({ ...doc, html });
    } catch (e) {
      results.push({ ...doc, error: e.message });
    }
  }
  return results;
}
