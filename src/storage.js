const { LocalStoragePreset } = require("lowdb/browser");

function getDb(username) {
  const db = LocalStoragePreset(username, {});
  db.read();
  return db;
}

function getHistory(username) {
  const db = getDb(username);
  return Object.keys(db.data).sort((a, b) => {
    var dateA = Date(a);
    var dateB = Date(b);
    return dateB > dateA ? 1 : -1;
  });
}

function updateHistory(username, ids) {
  const db = getDb(username);
  db.update(() => {
    db.data[new Date()] = ids;
  })
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

let exportObj = { getHistory, updateHistory, getHistoryIds, appendSeen };
export default exportObj;
