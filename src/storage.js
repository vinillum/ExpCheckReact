import { LocalStoragePreset } from "lowdb/browser";

// localStorage keys the app itself uses (see SearchBox and ApiBox). A history
// must never be stored under one of them.
const APP_KEYS = ["USERNAME", "API_TOKEN"];
const HISTORY_PREFIX = "history:";

// BGG usernames are case-insensitive, so "Foo" and "foo" share one history.
function historyKey(username) {
  return HISTORY_PREFIX + username.trim().toLowerCase();
}

// Histories used to live directly under the raw username. Copy such an entry
// to its new key the first time it is needed, so existing users keep their
// history (and with it the list of expansions already seen). The old entry is
// deliberately left in place.
function migrateLegacyHistory(username, key) {
  const store = window.localStorage;
  if (APP_KEYS.includes(username) || store.getItem(key) !== null) return;
  const legacy = store.getItem(username);
  if (legacy === null) return;
  try {
    const parsed = JSON.parse(legacy);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      store.setItem(key, legacy);
    }
  } catch (e) {
    // Not a history (some other value stored under that name): ignore it.
  }
}

function getDb(username) {
  const key = historyKey(username);
  migrateLegacyHistory(username, key);
  const db = LocalStoragePreset(key, {});
  db.read();
  return db;
}

// Entries are keyed by Date.toString(), e.g. "Thu Nov 05 2026 08:59:25 GMT+0200
// (Eastern European Standard Time)". The language guarantees that Date.parse
// reads that format back, in every engine. A key that cannot be read counts as
// the oldest possible time instead of breaking the sort.
function entryTime(key) {
  const time = Date.parse(key);
  return Number.isNaN(time) ? -Infinity : time;
}

// Newest first. Entries with the same (or unreadable) time keep the order they
// were added in, latest first.
function getHistory(username) {
  const db = getDb(username);
  return Object.keys(db.data)
    .map((key, index) => ({ key, index, time: entryTime(key) }))
    .sort((a, b) => b.time - a.time || b.index - a.index)
    .map((entry) => entry.key);
}

function updateHistory(username, ids) {
  const db = getDb(username);
  db.update(() => {
    const key = String(new Date());
    // The key only has one-second resolution. If an entry already exists for
    // this second, add to it instead of replacing it: the ids of a replaced
    // entry would drop out of the history, and with it out of the "already
    // seen" list, so they would be reported as new again.
    const existing = db.data[key];
    db.data[key] = Array.isArray(existing)
      ? [...new Set([...existing, ...ids])].sort((a, b) => a - b)
      : ids;
  });
}

// Names and covers of the expansions listed in the history entries. Once an
// expansion has been loaded it is kept for good, so an entry never has to be
// loaded from BGG twice, not even after a reload, and can be browsed without an
// API token. Shared by all accounts: an expansion looks the same to everyone.
// Best effort: unreadable or full storage just means "not kept".
const DETAILS_KEY = "expcheck:expansions:v1";

function readStoredDetails() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DETAILS_KEY));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (e) {
    // unreadable: start empty
  }
  return {};
}

function isDetails(value) {
  return (
    value &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.thumbnail === "string"
  );
}

// A Map of id -> {id, name, thumbnail} for the ids that are stored.
function getDetails(ids) {
  const stored = readStoredDetails();
  const found = new Map();
  for (let id of ids) {
    if (Object.prototype.hasOwnProperty.call(stored, id) && isDetails(stored[id])) {
      found.set(id, stored[id]);
    }
  }
  return found;
}

function saveDetails(list) {
  if (list.length === 0) return;
  const stored = readStoredDetails();
  for (let { id, name, thumbnail } of list) {
    stored[id] = { id, name, thumbnail };
  }
  try {
    window.localStorage.setItem(DETAILS_KEY, JSON.stringify(stored));
  } catch (e) {
    // e.g. storage is full: the entry still opens, it just is not kept
  }
}

function getHistoryIds(username, date) {
  const db = getDb(username);
  return db.data[date];
}

function appendSeen(username, seen) {
  const db = getDb(username);

  let result = seen;
  let known = db.data;

  for (let key of Object.keys(known)) {
    result = result.concat(known[key]);
  }
  return result;
}

let exportObj = {
  getHistory,
  updateHistory,
  getHistoryIds,
  appendSeen,
  getDetails,
  saveDetails,
};
export default exportObj;
