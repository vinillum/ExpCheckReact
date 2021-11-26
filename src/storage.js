const low = require("lowdb");
const LocalStorage = require("lowdb/adapters/LocalStorage");

const adapter = new LocalStorage();
const db = low(adapter);

function getHistory(username) {
  if (!db.has(username).value()) {
    return [];
  }

  return Object.keys(db.get(username).value()).sort((a, b) => {
    var dateA = Date(a);
    var dateB = Date(b);
    return dateB > dateA ? 1 : -1;
  });
}

function updateHistory(username, ids) {
  let state = db.has(username).value() ? db.get(username).value() : {};
  state[new Date()] = ids;
  db.set(username, state).write();
}

function getHistoryIds(username, date) {
  return db.get(username).value()[date];
}

function appendSeen(username, seen) {
  let result = seen;
  if (!db.has(username).value()) {
    return result;
  }

  let known = db.get(username).value();

  for (let key of Object.keys(known)) {
    result = result.concat(known[key]);
  }
  return result;
}

let exportObj = { getHistory, updateHistory, getHistoryIds, appendSeen };
export default exportObj;
