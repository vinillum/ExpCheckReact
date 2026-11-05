import axios from "axios";
import storage from "./storage";

let checkedStatuses = ["own", "preordered"];
let checkedTypes = [
  "boardgameexpansion",
  "boardgameaccessory",
  "boardgameimplementation",
  "boardgameintegration",
];

const DEFAULT_THUMBNAIL =
  "https://cf.geekdo-images.com/zxVVmggfpHJpmnJY9j-k1w__small/img/Tse35rOD2Z8Pv9EOUj4TfeMuNew=/fit-in/200x150/filters:strip_icc()/pic1657689.jpg";

// Retry policy for BoardGameGeek requests.
// - 202 means "accepted, data is still being prepared": wait, then ask again.
// - Network failures, 429 and 5xx may clear up on their own: retry with a
//   doubling delay (2s, 4s, 8s, 16s), then give up. BGG sends no Retry-After
//   with its 429s, and a limited request was accepted again about 2 seconds
//   later when measured, so this backoff fits.
// - Everything else (401 bad token, 403, 404, ...) will not fix itself, so it
//   fails immediately instead of being retried.
const ERROR_RETRIES = 4;
const ERROR_BASE_DELAY_MS = 2000;

// Pacing. BGG rate-limits but does not say how. Measured: roughly 37-39
// requests back to back (about 2 per second) get a 429, while one request every
// ~1.8 s was accepted for at least 56 in a row. So requests go out back to back
// while fewer than BURST_REQUESTS were made in the last BURST_WINDOW_MS; after
// that each request first waits PACED_DELAY_MS. A normal fetch fits inside the
// burst and never waits; a very large one slows down after the burst is used up.
const BURST_REQUESTS = 20;
const BURST_WINDOW_MS = 60000;
const PACED_DELAY_MS = 1000;

// `thing` lookups: BGG accepts at most 20 ids per request (21 gets a 400).
const BATCH_SIZE = 20;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Start times of the latest requests to BGG, shared by every lookup on the page
// so that a fetch and a history view count against the same allowance.
const recentRequests = [];

async function waitForTurn() {
  const cutoff = Date.now() - BURST_WINDOW_MS;
  while (recentRequests.length > 0 && recentRequests[0] < cutoff) {
    recentRequests.shift();
  }
  if (recentRequests.length >= BURST_REQUESTS) await sleep(PACED_DELAY_MS);
  recentRequests.push(Date.now());
}

function isTransient(error) {
  const status = error.response && error.response.status;
  return !status || status === 429 || status >= 500;
}

// An error whose message is meant to be shown to the user as it is.
function userFacingError(message) {
  const error = new Error(message);
  error.userFacing = true;
  return error;
}

// Parses the body of a 200 response, which BGG also uses for errors: an unknown
// username comes back as 200 with <errors><error><message>...</message></error>
// </errors>, and a proxy or challenge page is a 200 that is not BGG data at
// all. DOMParser never throws on bad input, so check the result explicitly.
function parseXml(text) {
  const xmlDoc = new DOMParser().parseFromString(text, "text/xml");
  const root = xmlDoc.documentElement;
  if (xmlDoc.getElementsByTagName("parsererror").length > 0 || !root) {
    throw userFacingError("Unexpected response from BoardGameGeek");
  }
  if (root.tagName === "errors" || root.tagName === "error") {
    const messages = [...xmlDoc.getElementsByTagName("message")]
      .map((message) => message.textContent.trim())
      .filter(Boolean);
    throw userFacingError(
      (messages.join("; ") || "BoardGameGeek returned an error").slice(0, 200)
    );
  }
  // Both the collection and the thing endpoint answer with an <items> root.
  if (root.tagName !== "items") {
    throw userFacingError("Unexpected response from BoardGameGeek");
  }
  return xmlDoc;
}

// Resolves with the parsed XML document of a 200 response. Rejects when the
// request cannot succeed, the retry budget is used up, or the body is an error
// or not BGG data (see parseXml). A 200 is always honoured, including the one
// that arrives on the very last attempt.
async function fetchXml(url, token, { queuedRetries, queuedDelay }) {
  let queuedAttempts = 0;
  let errorAttempts = 0;
  for (;;) {
    await waitForTurn();
    let resp;
    try {
      resp = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      if (!isTransient(e) || errorAttempts >= ERROR_RETRIES) throw e;
      const backoff = ERROR_BASE_DELAY_MS * 2 ** errorAttempts;
      errorAttempts++;
      await sleep(backoff);
      continue;
    }

    if (resp.status === 200) {
      return parseXml(resp.data);
    }
    if (resp.status !== 202) {
      throw new Error(`Unexpected response status ${resp.status}`);
    }
    if (queuedAttempts >= queuedRetries) {
      throw new Error("BoardGameGeek is still preparing the data");
    }
    queuedAttempts++;
    await sleep(queuedDelay);
  }
}

function filterOwned(xmlDoc) {
  // Sets: the same game can appear more than once (several copies, or both
  // "own" and "preordered" set) and must only be looked up once.
  const owned = new Set();
  const seen = new Set();
  for (let item of xmlDoc.getElementsByTagName("item")) {
    const id = item.getAttribute("objectid");
    const status = item.getElementsByTagName("status")[0];
    if (
      status &&
      checkedStatuses.some((checkedStatus) => status.getAttribute(checkedStatus) === "1")
    ) {
      owned.add(id);
    }
    seen.add(id);
  }
  return { owned: [...owned], seen: [...seen] };
}

// The ids of everything an item links to as an expansion, accessory,
// reimplementation or integration. Links in BOTH directions are kept on
// purpose: BGG marks the back-link from an expansion to its base game, or from
// a reimplementation to its original, with inbound="true", and those
// associated items are wanted too. Do not filter on `inbound`.
function readExpansionLinks(item) {
  const ids = new Set();
  for (let link of item.getElementsByTagName("link")) {
    if (checkedTypes.includes(link.getAttribute("type"))) {
      ids.add(link.getAttribute("id"));
    }
  }
  return [...ids];
}

// What the history view shows for one expansion.
function readDetails(item) {
  const id = item.getAttribute("id");
  // Declared per item so a missing primary name can't inherit the previous item's.
  let name = `Unknown (${id})`;
  for (let link of item.getElementsByTagName("name")) {
    if (link.getAttribute("type") === "primary") {
      name = link.getAttribute("value");
    }
  }
  // New listings often have no cover yet: BGG then leaves out the <thumbnail>
  // element or sends an empty one (seen in live data). Both, and a blank value,
  // fall back to the default image instead of becoming a broken one.
  let thumbnail = DEFAULT_THUMBNAIL;
  for (let link of item.getElementsByTagName("thumbnail")) {
    const url = link.textContent.trim();
    if (url) thumbnail = url;
  }
  return { name, id, thumbnail };
}

// Looks up `ids`, 20 per request, and returns a Map of id -> read(item). Nothing
// is kept between calls: every lookup asks BGG, so new expansions and links show
// up as soon as BGG has them. Rejects if any batch fails. `onBatch`, if given,
// receives the values of each batch as soon as it arrives, so the caller can keep
// what was loaded even if a later batch fails.
async function lookupItems(ids, token, read, onBatch) {
  const unique = [...new Set(ids)];
  const found = new Map();
  for (let start = 0; start < unique.length; start += BATCH_SIZE) {
    const batch = unique.slice(start, start + BATCH_SIZE);
    // `_` is a throwaway parameter that BGG ignores. BGG marks `thing` responses
    // as cacheable for an hour (Cache-Control: max-age=3600) and browsers honour
    // that, so without it a second fetch within the hour would be answered from
    // the browser's own cache and miss anything new. (A request header such as
    // Cache-Control: no-cache is not possible: BGG's CORS preflight only allows
    // Authorization.) If BGG ever rejects unknown parameters this fails loudly
    // with a 400 instead of silently showing stale data.
    const xmlDoc = await fetchXml(
      `https://boardgamegeek.com/xmlapi2/thing?id=${batch.join(",")}&_=${Date.now()}`,
      token,
      { queuedRetries: 5, queuedDelay: 2000 }
    );
    const values = [];
    for (let item of xmlDoc.getElementsByTagName("item")) {
      const value = read(item);
      found.set(item.getAttribute("id"), value);
      values.push(value);
    }
    if (onBatch) onBatch(values);
  }
  return found;
}

// Everything the given games link to as an expansion (may contain duplicates).
async function findExpansionIds(owned, token) {
  const found = await lookupItems(owned, token, readExpansionLinks);
  return [...found.values()].flat();
}

// Name, id and thumbnail for each id, in the order given. `onBatch` receives each
// batch of details as it arrives (the history view keeps them for good).
async function getExpansionDetails(ids, token, onBatch) {
  const found = await lookupItems(ids, token, readDetails, onBatch);
  return [...new Set(ids)].map((id) => found.get(id)).filter(Boolean);
}

// Results that are not already known, de-duplicated, in ascending id order.
function cleanupResults(known, results) {
  const knownIds = new Set(known);
  return [...new Set(results.filter((result) => !knownIds.has(result)))].sort(
    (a, b) => a - b
  );
}

// Calls callback(results, true) once, or callback([], false, message) once if
// anything in the lookup fails. `message` is only set when the reason is worth
// showing to the user (unknown username, empty collection, bad response).
// The callback runs outside the try block on purpose: an error thrown by the
// callback must not be mistaken for a failed lookup (which used to restart the
// whole search).
async function search(username, token, callback) {
  let results;
  try {
    const xmlDoc = await fetchXml(
      `https://boardgamegeek.com/xmlapi/collection/${encodeURIComponent(username.trim())}`,
      token,
      // The collection endpoint answers 202 while it builds the export;
      // 10 polls, 10 seconds apart.
      { queuedRetries: 10, queuedDelay: 10000 }
    );
    if (xmlDoc.getElementsByTagName("item").length === 0) {
      // Nothing to look up. Recording this as a successful, empty check would
      // be misleading (and an unknown username can end up here).
      throw userFacingError("No items found in this collection");
    }
    let { owned, seen } = filterOwned(xmlDoc);
    seen = storage.appendSeen(username, seen);
    let expansions = await findExpansionIds(owned, token);
    results = cleanupResults(seen, expansions);
  } catch (e) {
    callback([], false, e.userFacing ? e.message : undefined);
    return;
  }
  callback(results, true);
}

let exportObj = { search, getExpansionDetails };

export default exportObj;
