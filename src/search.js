import axios from "axios";
import storage from "./storage";

let checkedStatuses = ["own", "preordered"];
let checkedTypes = [
  "boardgameexpansion",
  "boardgameaccessory",
  "boardgameimplementation",
  "boardgameintegration",
];

function filterOwned(xmlDoc) {
  let owned = [];
  let seen = [];
  for (let item of xmlDoc.getElementsByTagName("item")) {
    let status = item.getElementsByTagName("status")[0];
    for (let checkedStatus of checkedStatuses) {
      if (status.getAttribute(checkedStatus) === "1") {
        owned.push(item.getAttribute("objectid"));
      }
    }
    seen.push(item.getAttribute("objectid"));
  }
  return { owned, seen };
}

function filterNewExpansions(xmlDoc) {
  let expansions = [];
  for (let item of xmlDoc.getElementsByTagName("item")) {
    var id = item.getAttribute("id");
    for (let link of item.getElementsByTagName("name")) {
      if (link.getAttribute("type") === "primary") {
        var name = link.getAttribute("value");
      }
    }
    for (let link of item.getElementsByTagName("thumbnail")) {
      var thumbnail = link.textContent;
    }
    expansions.push({
      name,
      id,
      thumbnail,
    });
  }
  return expansions;
}

function filterExpansions(xmlDoc) {
  let expansions = [];
  for (let item of xmlDoc.getElementsByTagName("item")) {
    for (let link of item.getElementsByTagName("link")) {
      for (let checkedType of checkedTypes) {
        if (link.getAttribute("type") === checkedType) {
          expansions.push(link.getAttribute("id"));
        }
      }
    }
  }
  return expansions;
}

async function getExpansions(searchList, filterFunction) {
  let expansions = [];
  let status = 202;
  while (status === 202) {
    try {
      let resp = await axios.get(
        `https://www.boardgamegeek.com/xmlapi2/thing?id=${searchList.join(",")}`
      );
      status = resp.status;
      if (status === 200) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(resp.data, "text/xml");
        expansions = filterFunction(xmlDoc);
      }
    } catch (e) {}
  }
  return expansions;
}

async function searchExpansions(owned, filterFunction) {
  let expansions = [];
  let searchList = [];
  for (let own of owned) {
    searchList.push(own);
    if (searchList.length === 50) {
      expansions = expansions.concat(
        await getExpansions(searchList, filterFunction)
      );
      searchList = [];
    }
  }
  if (searchList.length !== 0) {
    expansions = expansions.concat(
      await getExpansions(searchList, filterFunction)
    );
  }
  return expansions;
}

function uniq(a) {
  return a
    .sort((b, c) => b - c)
    .filter(function (item, pos, ary) {
      return !pos || item !== ary[pos - 1];
    });
}

function cleanupResults(owned, results) {
  let result = results.filter((result) => owned.indexOf(result) === -1);
  return uniq(result);
}

function search(username, callback) {
  axios
    .get(`https://www.boardgamegeek.com/xmlapi/collection/${username}`)
    .then(async (resp) => {
      if (resp.status === 202)
        setTimeout(() => search(username, callback), 10000);
      else if (resp.status !== 200) callback([]);
      else {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(resp.data, "text/xml");
        let { owned, seen } = filterOwned(xmlDoc);
        seen = storage.appendSeen(username, seen);
        let expansions = await searchExpansions(owned, filterExpansions);
        let results = cleanupResults(seen, expansions);
        callback(results);
      }
    })
    .catch(() => {
      setTimeout(() => search(username, callback), 10000);
    });
}

let exportObj = { search, searchExpansions, filterNewExpansions };

export default exportObj;
