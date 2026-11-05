// Local storage: the per-account history (keys, merging, order) and the store of
// loaded names and covers. These run against jsdom's real localStorage and the
// real lowdb, nothing is mocked.
import storage from "./storage";
import { EXPANSIONS_KEY } from "./testHelpers";

const when = (iso) => String(new Date(iso)); // a history key, as the app writes them
const seed = (user, keys) =>
  window.localStorage.setItem(
    "history:" + user,
    JSON.stringify(Object.fromEntries(keys.map((key, i) => [key, [String(i)]])))
  );

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("which key an account's history lives under", () => {
  test("history saved by an older version under the raw username is copied to the new key, case-insensitively, and left in place", () => {
    window.localStorage.setItem(
      "Alice",
      JSON.stringify({ "Mon Jan 05 2026 10:00:00 GMT+0000 (UTC)": ["1", "2"] })
    );
    expect(storage.getHistory("Alice")).toEqual([
      "Mon Jan 05 2026 10:00:00 GMT+0000 (UTC)",
    ]);
    expect(window.localStorage.getItem("history:alice")).not.toBeNull();
    expect(storage.getHistory("alice")).toHaveLength(1);
    expect(storage.appendSeen("ALICE", ["9"]).sort()).toEqual(["1", "2", "9"]);
    expect(window.localStorage.getItem("Alice")).not.toBeNull(); // not destroyed
  });

  test("a user named like one of the app's own keys neither collides with it nor crashes", () => {
    window.localStorage.setItem("USERNAME", "bob");
    window.localStorage.setItem("API_TOKEN", "secret-token");
    expect(() => storage.getHistory("USERNAME")).not.toThrow();
    expect(() => storage.getHistory("API_TOKEN")).not.toThrow();

    storage.updateHistory("USERNAME", ["5"]);
    expect(window.localStorage.getItem("USERNAME")).toBe("bob");
    expect(window.localStorage.getItem("API_TOKEN")).toBe("secret-token");
    expect(storage.getHistory("USERNAME")).toHaveLength(1);
  });

  test("a value under a username that is not a history is ignored, not parsed", () => {
    window.localStorage.setItem("carol", "not json");
    window.localStorage.setItem("dave", JSON.stringify([1, 2, 3]));
    expect(storage.getHistory("carol")).toEqual([]);
    expect(storage.getHistory("dave")).toEqual([]);
  });

  test("accounts are independent", () => {
    storage.updateHistory("dave", ["1"]);
    storage.updateHistory("erin", ["2"]);
    expect(storage.getHistoryIds("erin", storage.getHistory("erin")[0])).toEqual([
      "2",
    ]);
    expect(storage.getHistory("frank")).toEqual([]);
  });
});

describe("updateHistory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T10:00:00.000Z"));
  });

  test("two updates in the same second are merged, not replaced", () => {
    storage.updateHistory("dave", ["200"]);
    storage.updateHistory("dave", ["300"]);
    const history = storage.getHistory("dave");
    expect(history).toHaveLength(1);
    expect(storage.getHistoryIds("dave", history[0])).toEqual(["200", "300"]);
    // both still count as seen, so neither is reported as new again
    expect(storage.appendSeen("dave", ["1"]).sort()).toEqual(["1", "200", "300"]);
  });

  test("a merge removes duplicates and keeps ids in ascending numeric order", () => {
    storage.updateHistory("dave", ["10", "2"]);
    storage.updateHistory("dave", ["2", "3"]);
    const [key] = storage.getHistory("dave");
    expect(storage.getHistoryIds("dave", key)).toEqual(["2", "3", "10"]);
  });

  test("a first update is stored exactly as given, an empty one too", () => {
    storage.updateHistory("dave", ["30", "5"]);
    expect(storage.getHistoryIds("dave", storage.getHistory("dave")[0])).toEqual([
      "30",
      "5",
    ]);
    storage.updateHistory("erin", []);
    expect(storage.getHistoryIds("erin", storage.getHistory("erin")[0])).toEqual(
      []
    );
  });

  test("an empty update in the same second does not wipe an existing entry", () => {
    storage.updateHistory("dave", ["200"]);
    storage.updateHistory("dave", []);
    expect(storage.getHistoryIds("dave", storage.getHistory("dave")[0])).toEqual([
      "200",
    ]);
  });

  test("a damaged entry (not a list) under the key is replaced instead of crashing", () => {
    const key = String(new Date());
    window.localStorage.setItem("history:dave", JSON.stringify({ [key]: "garbage" }));
    expect(() => storage.updateHistory("dave", ["7"])).not.toThrow();
    expect(storage.getHistoryIds("dave", key)).toEqual(["7"]);
  });

  test("updates in different seconds stay separate", () => {
    storage.updateHistory("dave", ["1"]);
    vi.setSystemTime(new Date("2026-11-05T10:00:01.000Z"));
    storage.updateHistory("dave", ["2"]);
    const history = storage.getHistory("dave");
    expect(history.map((key) => storage.getHistoryIds("dave", key))).toEqual([
      ["2"],
      ["1"],
    ]);
  });
});

describe("getHistory: newest first", () => {
  test("entries written by the app come back newest first", () => {
    vi.useFakeTimers();
    const written = [];
    for (let i = 0; i < 40; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 10, 0, 0) + i * 1500));
      storage.updateHistory("dave", [String(i)]);
      written.push(String(new Date()));
    }
    const history = storage.getHistory("dave");
    expect(history).toEqual([...new Set(written)].reverse());
    expect(storage.getHistoryIds("dave", history[0])).toEqual(["39"]);
    expect(storage.getHistoryIds("dave", history[history.length - 1])).toEqual(["0"]);
  });

  test("the order follows the dates, not the order the entries were stored in", () => {
    const chronological = Array.from({ length: 30 }, (_, i) =>
      String(new Date(Date.UTC(2026, 5, 1, 12, 0, 0) + i * 3_600_000))
    );
    const shuffled = chronological.slice();
    let seedValue = 7; // a fixed shuffle, the same on every run
    for (let i = shuffled.length - 1; i > 0; i--) {
      seedValue = (seedValue * 1103515245 + 12345) % 2147483648;
      const j = seedValue % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    expect(shuffled).not.toEqual(chronological);
    seed("erin", shuffled);
    expect(storage.getHistory("erin")).toEqual(chronological.slice().reverse());
  });

  test("keys written in different time zones are ordered by real time, across a year boundary", () => {
    const keys = {
      dec31: "Wed Dec 31 2025 23:59:59 GMT+0000 (Coordinated Universal Time)",
      jan1: "Thu Jan 01 2026 00:00:01 GMT+0000 (Coordinated Universal Time)",
      nov5a: "Thu Nov 05 2026 08:59:25 GMT+0200 (Eastern European Standard Time)", // 06:59:25 UTC
      nov5b: "Thu Nov 05 2026 07:00:00 GMT+0000 (Greenwich Mean Time)", // newer, despite the smaller hour
    };
    seed("frank", [keys.nov5a, keys.dec31, keys.nov5b, keys.jan1]);
    expect(storage.getHistory("frank")).toEqual([
      keys.nov5b,
      keys.nov5a,
      keys.jan1,
      keys.dec31,
    ]);
  });

  test("an unreadable key sorts last without breaking the others; ties keep the latest added first", () => {
    const a = when("2026-11-05T10:00:00Z");
    const b = when("2026-11-05T09:00:00Z");
    seed("gina", ["not a date", a, "", b, "garbage"]);
    expect(storage.getHistory("gina")).toEqual([a, b, "garbage", "", "not a date"]);

    const sameInstantTwice = [
      "Thu Nov 05 2026 12:00:00 GMT+0200 (Eastern European Standard Time)",
      "Thu Nov 05 2026 10:00:00 GMT+0000 (Coordinated Universal Time)",
    ];
    seed("hank", sameInstantTwice);
    expect(storage.getHistory("hank")).toEqual([...sameInstantTwice].reverse());
  });

  test("an account without history gives an empty list", () => {
    expect(storage.getHistory("nobody")).toEqual([]);
  });
});

describe("the store of loaded names and covers", () => {
  const item = (id, extra = {}) => ({ id, name: "Name " + id, thumbnail: "http://i/" + id, ...extra });

  test("what was saved is read back, and only for the ids asked for", () => {
    storage.saveDetails([item("1"), item("2")]);
    const found = storage.getDetails(["1", "3"]);
    expect([...found.keys()]).toEqual(["1"]);
    expect(found.get("1")).toEqual(item("1"));
  });

  test("saving adds to what is already there", () => {
    storage.saveDetails([item("1")]);
    storage.saveDetails([item("2")]);
    expect([...storage.getDetails(["1", "2"]).keys()].sort()).toEqual(["1", "2"]);
  });

  test("only the three fields are kept", () => {
    storage.saveDetails([item("1", { description: "long text", extra: 1 })]);
    expect(JSON.parse(window.localStorage.getItem(EXPANSIONS_KEY))).toEqual({
      1: item("1"),
    });
  });

  test("a store that is not JSON, or not an object, counts as empty and is replaced on the next save", () => {
    window.localStorage.setItem(EXPANSIONS_KEY, "{{{ not json");
    expect(storage.getDetails(["1"]).size).toBe(0);
    window.localStorage.setItem(EXPANSIONS_KEY, JSON.stringify([1, 2]));
    expect(storage.getDetails(["1"]).size).toBe(0);
    storage.saveDetails([item("1")]);
    expect(storage.getDetails(["1"]).size).toBe(1);
  });

  test("entries of the wrong shape are ignored, and names every object has are not mistaken for ids", () => {
    window.localStorage.setItem(
      EXPANSIONS_KEY,
      JSON.stringify({
        1: "garbage",
        2: { id: "2", name: 5, thumbnail: "x" },
        3: { id: 3, name: "n", thumbnail: "x" },
        4: item("4"),
      })
    );
    expect([...storage.getDetails(["1", "2", "3", "4"]).keys()]).toEqual(["4"]);

    window.localStorage.setItem(EXPANSIONS_KEY, "{}");
    expect(storage.getDetails(["constructor", "toString", "__proto__"]).size).toBe(0);
  });

  test("full or refusing storage does not throw", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => storage.saveDetails([item("1")])).not.toThrow();
  });

  test("saving nothing writes nothing", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    storage.saveDetails([]);
    expect(setItem).not.toHaveBeenCalled();
  });
});
