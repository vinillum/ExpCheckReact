// Everything the app asks of BoardGameGeek: pacing, retries, error handling, what
// counts as a new expansion, and the details shown in the history view.
//
// axios is mocked. Time is faked: every request "takes" 800 ms, and waiting
// advances the clock instantly, so pacing and backoff can be checked exactly.
import { idsOf, DEFAULT_COVER } from "./testHelpers";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

const REQUEST_TIME = 800;
const realSetTimeout = global.setTimeout;
let now; // the fake clock, in ms
let waits; // every delay the code asked for
let requestTimes; // when each request was made
let calls; // every URL requested
let axios;
let search;

beforeEach(async () => {
  vi.resetModules(); // search.js keeps its pacing allowance in module state
  window.localStorage.clear();
  now = 1_000_000;
  waits = [];
  requestTimes = [];
  calls = [];
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(global, "setTimeout").mockImplementation((fn, ms) => {
    waits.push(ms);
    now += ms;
    return realSetTimeout(fn, 0);
  });
  axios = (await import("axios")).default;
  search = (await import("./search")).default;
});
afterEach(() => vi.restoreAllMocks());

// ---- helpers -------------------------------------------------------------

// handler(url, config, n) answers each request; n counts requests from 1
function bggAnswers(handler) {
  axios.get.mockImplementation((url, config) => {
    now += REQUEST_TIME;
    requestTimes.push(now);
    calls.push(url);
    return handler(url, config, calls.length);
  });
}
const ok = (data) => Promise.resolve({ status: 200, data });
const fails = (status, headers) =>
  Promise.reject(Object.assign(new Error("failed " + status), { response: { status, headers } }));
const things = () => calls.filter((url) => url.includes("/thing"));
const collections = () => calls.filter((url) => url.includes("/collection/"));
const pauses = () => waits.filter((ms) => ms === 1000).length;
const busiest = (windowMs) =>
  Math.max(...requestTimes.map((t) => requestTimes.filter((x) => x >= t && x < t + windowMs).length));

const run = (username = "u") =>
  new Promise((resolve) =>
    search.search(username, "tok", (data, success, reason) => resolve({ data, success, reason }))
  );

// A collection of n owned games, and a thing answer in which game g links to expansion 1000+g
const collectionOf = (n) =>
  `<items>${Array.from({ length: n }, (_, i) => `<item objectid="${i + 1}"><status own="1"/></item>`).join("")}</items>`;
const thingAnswer = (url, extraLinks = {}) =>
  `<items>${idsOf(url)
    .map(
      (id) =>
        `<item id="${id}"><name type="primary" value="N${id}"/><thumbnail>http://i/${id}</thumbnail><link type="boardgameexpansion" id="${1000 + Number(id)}"/>${extraLinks[id] || ""}</item>`
    )
    .join("")}</items>`;
const world = (games, extraLinks) => (url) =>
  ok(url.includes("/collection/") ? collectionOf(games) : thingAnswer(url, extraLinks));

// ---- pacing --------------------------------------------------------------

describe("pacing", () => {
  test("a normal fetch (the collection plus 14 batches) never waits", async () => {
    bggAnswers(world(274));
    const result = await run();
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(15);
    expect(things()).toHaveLength(14);
    expect(waits).toEqual([]);
  });

  test("a 56-request lookup sends the first 20 back to back, then waits 1 s before each", async () => {
    bggAnswers((url) => ok(thingAnswer(url)));
    const ids = Array.from({ length: 1120 }, (_, i) => String(i + 1));
    const details = await search.getExpansionDetails(ids, "tok");

    expect(things()).toHaveLength(56);
    expect(waits).toHaveLength(36);
    expect(pauses()).toBe(36);
    expect(details).toHaveLength(1120);
    expect(details[0].id).toBe("1");
    expect(details[1119].id).toBe("1120");
    // BGG turned away a burst of about 37 requests in 17-24 s; this stays well below it
    expect(busiest(24000)).toBeLessThanOrEqual(30);
  });

  test("two fetches back to back: only the 10 requests beyond the allowance wait", async () => {
    bggAnswers(world(274));
    await run();
    expect(waits).toEqual([]);
    await run();
    expect(pauses()).toBe(10);
  });

  test("after a quiet minute the allowance is back", async () => {
    bggAnswers(world(274));
    await run();
    now += 61000;
    waits = [];
    await run();
    expect(waits).toEqual([]);
  });

  test("two lookups running at the same time both finish correctly", async () => {
    bggAnswers(world(274));
    const [first, second] = await Promise.all([run(), run()]);
    expect(first.success && second.success).toBe(true);
    expect(first.data).toHaveLength(274);
    expect(second.data).toHaveLength(274);
  });
});

// ---- retries -------------------------------------------------------------

describe("retries and backoff", () => {
  const collectionThen = (thingAnswerFn) => (url, config, n) =>
    url.includes("/collection/") ? ok(collectionOf(5)) : thingAnswerFn(url, config, n);

  test("a server error is retried with 2, 4, 8 and 16 s waits, then reported as a failure", async () => {
    bggAnswers(collectionThen(() => fails(503)));
    const result = await run();
    expect(result.success).toBe(false);
    expect(result.reason).toBe("BoardGameGeek is still returning error 503");
    expect(things()).toHaveLength(5);
    expect(waits).toEqual([2000, 4000, 8000, 16000]);
  });

  test.each([
    [429, "BoardGameGeek is still limiting requests"],
    [500, "BoardGameGeek is still returning error 500"],
    [502, "BoardGameGeek is still returning error 502"],
    [504, "BoardGameGeek is still returning error 504"],
  ])("a %i that never clears is reported with its reason, for the collection, `thing` requests and the history view", async (status, reason) => {
    bggAnswers(collectionThen(() => fails(status)));
    expect(await run()).toEqual({ data: [], success: false, reason });
    expect(things()).toHaveLength(5); // asked once and retried four times

    calls.length = 0;
    bggAnswers(() => fails(status)); // now the collection request itself fails
    expect(await run()).toEqual({ data: [], success: false, reason });
    expect(calls).toHaveLength(5);

    await expect(search.getExpansionDetails(["1"], "tok")).rejects.toMatchObject({ userFacing: true, message: reason });
  });

  test("the retries are a budget of four: four failures and then an answer succeed, a fifth failure does not", async () => {
    bggAnswers(collectionThen((url, config, n) => (n <= 5 ? fails(503) : ok(thingAnswer(url)))));
    const result = await run();
    expect(result.success).toBe(true); // collection, then 4 failures, then the answer
    expect(result.reason).toBeUndefined();

    calls.length = 0;
    bggAnswers(collectionThen((url, config, n) => (n <= 6 ? fails(503) : ok(thingAnswer(url)))));
    expect((await run()).reason).toBe("BoardGameGeek is still returning error 503");
  });

  test("a network error (no response at all) is retried the same way and is bounded", async () => {
    bggAnswers(collectionThen(() => Promise.reject(new Error("Network Error"))));
    const result = await run();
    expect(result.success).toBe(false);
    expect(things()).toHaveLength(5);
    expect(waits).toEqual([2000, 4000, 8000, 16000]);
  });

  test("when BGG cannot be reached at all, the reason says so", async () => {
    bggAnswers(collectionThen(() => Promise.reject(new Error("Network Error"))));
    expect((await run()).reason).toBe("Could not reach BoardGameGeek");
  });

  test("the same when the very first request, for the collection, cannot get through", async () => {
    bggAnswers(() => Promise.reject(new Error("Network Error")));
    const result = await run();
    expect(result).toEqual({ data: [], success: false, reason: "Could not reach BoardGameGeek" });
    expect(calls).toHaveLength(5);
  });

  test("a network error that clears up on a retry is not reported", async () => {
    bggAnswers(
      collectionThen((url, config, n) =>
        n === 2 ? Promise.reject(new Error("Network Error")) : ok(thingAnswer(url))
      )
    );
    const result = await run();
    expect(result.success).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test("the history view's lookup fails with the same user-facing reason", async () => {
    bggAnswers(() => Promise.reject(new Error("Network Error")));
    await expect(search.getExpansionDetails(["1"], "tok")).rejects.toMatchObject({
      userFacing: true,
      message: "Could not reach BoardGameGeek",
    });
  });

  test("a 429 waits 2 s and then succeeds; a Retry-After header is not read", async () => {
    bggAnswers(
      collectionThen((url, config, n) =>
        n === 2 ? fails(429, { "retry-after": "7" }) : ok(thingAnswer(url))
      )
    );
    const result = await run();
    expect(result.success).toBe(true);
    expect(waits[0]).toBe(2000);
  });

  test("a 401 is not retried, and the reason says the token was not accepted", async () => {
    bggAnswers(collectionThen(() => fails(401)));
    const result = await run();
    expect(result.success).toBe(false);
    expect(result.reason).toBe("BoardGameGeek did not accept the API token");
    expect(things()).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  test("the same when the collection request is the one refused, and for the history view's lookup", async () => {
    bggAnswers(() => fails(401));
    expect(await run()).toEqual({
      data: [],
      success: false,
      reason: "BoardGameGeek did not accept the API token",
    });
    expect(calls).toHaveLength(1);
    await expect(search.getExpansionDetails(["1"], "tok")).rejects.toMatchObject({
      userFacing: true,
      message: "BoardGameGeek did not accept the API token",
    });
  });

  test("other client errors (403, 404) are not retried and still have no reason to show", async () => {
    for (const status of [403, 404]) {
      calls.length = 0;
      bggAnswers(() => fails(status));
      const result = await run();
      expect(result.success).toBe(false);
      expect(result.reason).toBeUndefined();
      expect(calls).toHaveLength(1);
    }
  });

  test("a 404 on the collection is not retried", async () => {
    bggAnswers(() => fails(404));
    expect((await run()).success).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test("an unexpected success status (204) fails without retrying", async () => {
    bggAnswers(() => Promise.resolve({ status: 204, data: "" }));
    expect((await run()).success).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test("a collection that answers 202 ten times and then 200 succeeds, polled every 10 s", async () => {
    bggAnswers((url, config, n) =>
      url.includes("/collection/")
        ? Promise.resolve(n <= 10 ? { status: 202, data: "" } : { status: 200, data: collectionOf(3) })
        : ok(thingAnswer(url))
    );
    const result = await run();
    expect(result.success).toBe(true); // the 200 on the very last attempt counts
    expect(collections()).toHaveLength(11);
    expect(waits.filter((ms) => ms === 10000)).toHaveLength(10);
  });

  test("a collection that never leaves 202 is given up on after 11 requests, and the reason says why", async () => {
    bggAnswers(() => Promise.resolve({ status: 202, data: "" }));
    const result = await run();
    expect(result).toEqual({ data: [], success: false, reason: "BoardGameGeek is still preparing the data" });
    expect(calls).toHaveLength(11);
  });

  test("a thing request that never leaves 202 is given up on after 6 requests, 2 s apart, with the same reason", async () => {
    bggAnswers(collectionThen(() => Promise.resolve({ status: 202, data: "" })));
    const result = await run();
    expect(result.success).toBe(false);
    expect(result.reason).toBe("BoardGameGeek is still preparing the data");
    expect(things()).toHaveLength(6);
    expect(waits.every((ms) => ms === 2000)).toBe(true);
  });

  test("an error thrown by the callback is not mistaken for a failed lookup, and does not restart it", async () => {
    bggAnswers(world(5));
    const callback = vi.fn(() => {
      throw new Error("boom");
    });
    await expect(search.search("u", "tok", callback)).rejects.toThrow("boom");
    expect(callback).toHaveBeenCalledTimes(1);
    expect(collections()).toHaveLength(1);
  });
});

// ---- progress ---------------------------------------------------------------

describe("progress", () => {
  const ids45 = Array.from({ length: 45 }, (_, i) => String(i + 1));

  test("a lookup reports (batch, total) just before it requests each batch", async () => {
    const events = [];
    bggAnswers((url) => {
      events.push("request");
      return ok(thingAnswer(url));
    });
    await search.getExpansionDetails(ids45, "tok", undefined, (batch, total) =>
      events.push(`${batch}/${total}`)
    );
    expect(events).toEqual(["1/3", "request", "2/3", "request", "3/3", "request"]);
  });

  test("a fetch reports the batches of its lookup, and nothing while the collection loads", async () => {
    const events = [];
    bggAnswers((url) => {
      events.push(url.includes("/collection/") ? "collection" : "request");
      return world(45)(url);
    });
    await new Promise((resolve) =>
      search.search("u", "tok", () => resolve(), (batch, total) => events.push(`${batch}/${total}`))
    );
    expect(events).toEqual(["collection", "1/3", "request", "2/3", "request", "3/3", "request"]);
  });

  test("a batch that needs a retry is reported once", async () => {
    const reports = [];
    bggAnswers((url, config, n) =>
      url.includes("/collection/")
        ? ok(collectionOf(25))
        : n === 2
        ? fails(503)
        : ok(thingAnswer(url))
    );
    const result = await new Promise((resolve) =>
      search.search("u", "tok", (data, success) => resolve(success), (batch, total) =>
        reports.push([batch, total])
      )
    );
    expect(result).toBe(true);
    expect(things()).toHaveLength(3); // 2 batches plus the retry
    expect(reports).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  test("nothing to look up, nothing to report", async () => {
    bggAnswers(() => ok("<items/>"));
    const onProgress = vi.fn();
    await search.getExpansionDetails([], "tok", undefined, onProgress);
    expect(onProgress).not.toHaveBeenCalled();
  });

  test("a progress callback that throws neither fails nor restarts the lookup", async () => {
    bggAnswers((url) => ok(thingAnswer(url)));
    const onProgress = vi.fn(() => {
      throw new Error("boom");
    });
    const details = await search.getExpansionDetails(ids45, "tok", undefined, onProgress);
    expect(details).toHaveLength(45);
    expect(things()).toHaveLength(3);
    expect(onProgress).toHaveBeenCalledTimes(3);
  });
});

// ---- retry notes ------------------------------------------------------------

describe("retry notes", () => {
  const collectionThen = (thingAnswerFn) => (url, config, n) =>
    url.includes("/collection/") ? ok(collectionOf(5)) : thingAnswerFn(url, config, n);
  const notes = [];
  const runWithNotes = () => {
    notes.length = 0;
    return new Promise((resolve) =>
      search.search("u", "tok", (data, success) => resolve(success), undefined, (note) =>
        notes.push(note)
      )
    );
  };

  test("a request that keeps failing is announced before each retry, with the reason and the count", async () => {
    bggAnswers(collectionThen(() => fails(503)));
    expect(await runWithNotes()).toBe(false);
    expect(notes).toEqual([
      "BoardGameGeek error 503, retrying (1 of 4)",
      "BoardGameGeek error 503, retrying (2 of 4)",
      "BoardGameGeek error 503, retrying (3 of 4)",
      "BoardGameGeek error 503, retrying (4 of 4)",
    ]); // no clearing: nothing ever answered; the failure itself is reported instead
  });

  test("the reason is told apart: no response, a 429, a server error", async () => {
    const reasons = async (failure) => {
      calls.length = 0; // the handler counts requests from 1 in each run
      bggAnswers(collectionThen((url, config, n) => (n === 2 ? failure() : ok(thingAnswer(url)))));
      await runWithNotes();
      return notes[0];
    };
    expect(await reasons(() => Promise.reject(new Error("Network Error")))).toBe(
      "no response from BoardGameGeek, retrying (1 of 4)"
    );
    expect(await reasons(() => fails(429))).toBe("BoardGameGeek is limiting requests, retrying (1 of 4)");
    expect(await reasons(() => fails(500))).toBe("BoardGameGeek error 500, retrying (1 of 4)");
  });

  test("the note is cleared (null) once, when the retried request gets an answer", async () => {
    bggAnswers(collectionThen((url, config, n) => (n <= 3 ? fails(503) : ok(thingAnswer(url)))));
    expect(await runWithNotes()).toBe(true);
    expect(notes).toEqual([
      "BoardGameGeek error 503, retrying (1 of 4)",
      "BoardGameGeek error 503, retrying (2 of 4)",
      null,
    ]);
  });

  test("a clean run says nothing", async () => {
    bggAnswers(world(45));
    expect(await runWithNotes()).toBe(true);
    expect(notes).toEqual([]);
  });

  test("the collection request's retries are announced too", async () => {
    bggAnswers((url, config, n) => (n === 1 ? fails(503) : world(5)(url)));
    expect(await runWithNotes()).toBe(true);
    expect(notes).toEqual(["BoardGameGeek error 503, retrying (1 of 4)", null]);
  });

  test("the collection's 202 waits are announced with their count out of 10, then cleared once", async () => {
    bggAnswers((url, config, n) =>
      url.includes("/collection/") && n <= 2
        ? Promise.resolve({ status: 202, data: "" })
        : world(5)(url)
    );
    expect(await runWithNotes()).toBe(true);
    expect(notes).toEqual([
      "BoardGameGeek is preparing the data, checking again (1 of 10)",
      "BoardGameGeek is preparing the data, checking again (2 of 10)",
      null,
    ]); // no clearing between two 202s: the second note simply replaces the first
  });

  test("a collection that never leaves 202 is announced ten times and never cleared", async () => {
    bggAnswers(() => Promise.resolve({ status: 202, data: "" }));
    expect(await runWithNotes()).toBe(false);
    expect(notes).toEqual(
      Array.from({ length: 10 }, (_, i) => `BoardGameGeek is preparing the data, checking again (${i + 1} of 10)`)
    );
  });

  test("a thing request's 202 waits count out of 5", async () => {
    bggAnswers(collectionThen((url, config, n) => (n <= 3 ? Promise.resolve({ status: 202, data: "" }) : ok(thingAnswer(url)))));
    expect(await runWithNotes()).toBe(true);
    expect(notes).toEqual([
      "BoardGameGeek is preparing the data, checking again (1 of 5)",
      "BoardGameGeek is preparing the data, checking again (2 of 5)",
      null,
    ]);
  });

  test("a note about a failure and a note about a 202 replace each other without a clearing in between", async () => {
    // collection: 503, then 202, then the data
    bggAnswers((url, config, n) =>
      url.includes("/collection/")
        ? n === 1
          ? fails(503)
          : n === 2
          ? Promise.resolve({ status: 202, data: "" })
          : ok(collectionOf(5))
        : ok(thingAnswer(url))
    );
    expect(await runWithNotes()).toBe(true);
    expect(notes).toEqual([
      "BoardGameGeek error 503, retrying (1 of 4)",
      "BoardGameGeek is preparing the data, checking again (1 of 10)",
      null,
    ]);
  });

  test("a failure after a 202 is announced too, and the 202's note is not cleared by it", async () => {
    // collection: 202, then 503, then the data
    bggAnswers((url, config, n) =>
      url.includes("/collection/")
        ? n === 1
          ? Promise.resolve({ status: 202, data: "" })
          : n === 2
          ? fails(503)
          : ok(collectionOf(5))
        : ok(thingAnswer(url))
    );
    expect(await runWithNotes()).toBe(true);
    expect(notes).toEqual([
      "BoardGameGeek is preparing the data, checking again (1 of 10)",
      "BoardGameGeek error 503, retrying (1 of 4)",
      null,
    ]);
  });

  test("a failure that is not retried (a 401) is not announced", async () => {
    bggAnswers(collectionThen(() => fails(401)));
    expect(await runWithNotes()).toBe(false);
    expect(notes).toEqual([]);
  });

  test("the history view's lookup announces retries as well", async () => {
    bggAnswers((url, config, n) => (n === 1 ? fails(503) : ok(thingAnswer(url))));
    const heard = [];
    await search.getExpansionDetails(["1"], "tok", undefined, undefined, (note) => heard.push(note));
    expect(heard).toEqual(["BoardGameGeek error 503, retrying (1 of 4)", null]);
  });

  test("a callback that throws neither fails nor restarts the lookup", async () => {
    bggAnswers(collectionThen((url, config, n) => (n === 2 ? fails(503) : ok(thingAnswer(url)))));
    const onRetry = vi.fn(() => {
      throw new Error("boom");
    });
    const success = await new Promise((resolve) =>
      search.search("u", "tok", (data, ok) => resolve(ok), undefined, onRetry)
    );
    expect(success).toBe(true);
    expect(onRetry).toHaveBeenCalledTimes(2); // the note, then the clearing
    expect(things()).toHaveLength(2); // the failed request and its one retry
  });
});

// ---- the cache-busting parameter ------------------------------------------

describe("the cache-busting parameter on thing requests", () => {
  test("every thing request carries a number after the ids, in batches of 20", async () => {
    bggAnswers(world(45));
    await run();
    expect(things()).toHaveLength(3);
    things().forEach((url) =>
      expect(url).toMatch(/^https:\/\/boardgamegeek\.com\/xmlapi2\/thing\?id=[\d,]+&_=\d+$/)
    );
    expect(things().map((url) => idsOf(url).length)).toEqual([20, 20, 5]);
  });

  test("the same batch asked later is a different URL, so a browser cannot answer it from its cache", async () => {
    bggAnswers(world(45));
    await run();
    const first = things();
    calls.length = 0;
    now += 5000;
    await run();
    things().forEach((url, i) => {
      expect(url).not.toBe(first[i]);
      expect(url.split("&_=")[0]).toBe(first[i].split("&_=")[0]);
    });
  });

  test("the collection request has no extra parameter, and the history view's requests have one", async () => {
    bggAnswers(world(5));
    await run();
    expect(collections()[0]).toBe("https://boardgamegeek.com/xmlapi/collection/u");
    calls.length = 0;
    await search.getExpansionDetails(["1", "2"], "tok");
    expect(things()[0]).toMatch(/&_=\d+$/);
  });
});

// ---- bodies that are not data ---------------------------------------------

describe("answers that are not a collection or a list of items", () => {
  const unknownUser =
    '<?xml version="1.0" encoding="utf-8" standalone="yes" ?> <errors> \t<error> \t\t<message>Invalid username specified</message> \t</error> </errors>';
  const failsWith = async (body) => {
    bggAnswers(() => ok(body));
    return run();
  };

  test("an unknown username (BGG answers 200 with an error body) fails with BGG's message", async () => {
    const result = await failsWith(unknownUser);
    expect(result).toEqual({ data: [], success: false, reason: "Invalid username specified" });
    expect(calls).toHaveLength(1);
  });

  test("a collection with no items fails instead of recording an empty check", async () => {
    const result = await failsWith('<items totalitems="0" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse"></items>');
    expect(result.success).toBe(false);
    expect(result.reason).toBe("No items found in this collection");
    expect(things()).toHaveLength(0);
  });

  test.each([
    ["an ill-formed HTML page", "<html><body>Please wait<br></body></html>"],
    ["a well-formed HTML page", "<html><body>Just a moment...</body></html>"],
    ["an empty body", ""],
    ["a JSON object (axios parses JSON itself)", { error: "rate limited" }],
    ["no body at all", undefined],
  ])("%s is not mistaken for data", async (label, body) => {
    const result = await failsWith(body);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("Unexpected response from BoardGameGeek");
    expect(calls).toHaveLength(1);
  });

  test("several messages are joined, a missing one gets a generic text, a very long one is cut", async () => {
    expect(
      (await failsWith("<errors><error><message>First problem</message></error><error><message> Second problem </message></error></errors>")).reason
    ).toBe("First problem; Second problem");
    expect((await failsWith("<errors><error/></errors>")).reason).toBe("BoardGameGeek returned an error");
    expect(
      (await failsWith(`<errors><error><message>${"x".repeat(500)}</message></error></errors>`)).reason
    ).toHaveLength(200);
  });

  test("an error answer with a single <error> root is understood too", async () => {
    expect((await failsWith("<error><message>Rate limit exceeded.</message></error>")).reason).toBe(
      "Rate limit exceeded."
    );
  });

  test("an error body from the thing endpoint fails the lookup with its message", async () => {
    bggAnswers((url) =>
      ok(url.includes("/collection/") ? collectionOf(1) : "<errors><error><message>Invalid ids</message></error></errors>")
    );
    const result = await run();
    expect(result.success).toBe(false);
    expect(result.reason).toBe("Invalid ids");
  });
});

// ---- what is reported -------------------------------------------------------

describe("what counts as a new expansion", () => {
  const known = (user, ...ids) =>
    window.localStorage.setItem("history:" + user, JSON.stringify({ [String(new Date())]: ids }));

  test("a game owned and pre-ordered, or listed twice, is looked up once; games that are not owned are not looked up", async () => {
    bggAnswers((url) =>
      ok(
        url.includes("/collection/")
          ? '<items><item objectid="100"><status own="1" preordered="1"/></item><item objectid="100"><status own="1"/></item><item objectid="300"><status own="0" wishlist="1"/></item></items>'
          : thingAnswer(url)
      )
    );
    await run();
    expect(things()).toHaveLength(1);
    expect(idsOf(things()[0])).toEqual(["100"]);
  });

  test("results leave out what is already in the collection or the history, repeat nothing, and come in ascending numeric order", async () => {
    known("u", "2");
    bggAnswers((url) =>
      ok(
        url.includes("/collection/")
          ? '<items><item objectid="5"><status own="1"/></item><item objectid="7"><status own="1"/></item></items>'
          : '<items><item id="5"><link type="boardgameexpansion" id="10"/><link type="boardgameexpansion" id="2"/><link type="boardgameexpansion" id="30"/></item>' +
            '<item id="7"><link type="boardgameaccessory" id="10"/><link type="boardgameexpansion" id="5"/><link type="boardgamefamily" id="77"/></item></items>'
      )
    );
    expect((await run()).data).toEqual(["10", "30"]); // 5 is owned, 2 is known, 77 is not an expansion
  });

  test("items that point back to an owned item are reported too (originals and base games are wanted)", async () => {
    bggAnswers((url) =>
      ok(
        url.includes("/collection/")
          ? '<items><item objectid="200"><status own="1"/></item></items>'
          : '<items><item id="200"><link type="boardgameexpansion" id="100" inbound="true"/><link type="boardgameimplementation" id="50" inbound="true"/></item></items>'
      )
    );
    expect((await run()).data).toEqual(["50", "100"]);
  });

  test("a newly linked item shows up on the very next fetch", async () => {
    bggAnswers(world(50));
    const first = await run();
    expect(first.data).toHaveLength(50);

    known("u", ...first.data); // what the app records after the first fetch
    bggAnswers(world(50, { 7: '<link type="boardgameaccessory" id="99001"/>' }));
    expect((await run()).data).toEqual(["99001"]);
  });

  test("a username is trimmed and URL-encoded", async () => {
    bggAnswers(world(1));
    await run("  a b?x=1#  ");
    expect(collections()[0]).toBe("https://boardgamegeek.com/xmlapi/collection/a%20b%3Fx%3D1%23");
  });

  test("looking things up writes nothing to storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    bggAnswers(world(30));
    await run();
    await search.getExpansionDetails(["1", "2"], "tok");
    expect(setItem).not.toHaveBeenCalled();
  });
});

// ---- the history view ---------------------------------------------------------

describe("details for the history view", () => {
  const withThumbnails = (xml) => (url) =>
    ok(`<items>${idsOf(url).map((id) => `<item id="${id}"><name type="primary" value="X${id}"/>${xml(id)}</item>`).join("")}</items>`);

  test("come back in the order asked for, once each, and an id BGG does not return is left out", async () => {
    bggAnswers((url) =>
      ok(`<items>${idsOf(url).filter((id) => id !== "2").map((id) => `<item id="${id}"><name type="primary" value="X${id}"/></item>`).join("")}</items>`)
    );
    const details = await search.getExpansionDetails(["3", "1", "2", "1"], "tok");
    expect(details.map((d) => d.id)).toEqual(["3", "1"]);
    expect(idsOf(things()[0])).toEqual(["3", "1", "2"]); // asked once each
  });

  test.each([
    ["no <thumbnail> element", "", DEFAULT_COVER],
    ["an empty <thumbnail/>", "<thumbnail/>", DEFAULT_COVER],
    ["a blank thumbnail", "<thumbnail>   \n  </thumbnail>", DEFAULT_COVER],
    ["a padded url", "<thumbnail>\n  https://img/4.jpg \n</thumbnail>", "https://img/4.jpg"],
    ["a clean url", "<thumbnail>https://img/5.jpg</thumbnail>", "https://img/5.jpg"],
    ["a real url followed by an empty element", "<thumbnail>https://img/6.jpg</thumbnail><thumbnail/>", "https://img/6.jpg"],
    ["an empty element followed by a real url", "<thumbnail/><thumbnail>https://img/7.jpg</thumbnail>", "https://img/7.jpg"],
  ])("the cover for %s", async (label, thumbnail, expected) => {
    bggAnswers(withThumbnails(() => thumbnail));
    const [details] = await search.getExpansionDetails(["1"], "tok");
    expect(details.thumbnail).toBe(expected);
  });

  test("an item without a primary name is called Unknown, not given the previous item's name", async () => {
    bggAnswers(() =>
      ok('<items><item id="1"><name type="primary" value="First"/></item><item id="2"><name type="alternate" value="Alt"/></item></items>')
    );
    const details = await search.getExpansionDetails(["1", "2"], "tok");
    expect(details.map((d) => d.name)).toEqual(["First", "Unknown (2)"]);
  });

  test("each batch is handed over as it arrives, before the next one is requested", async () => {
    const events = [];
    bggAnswers((url) => {
      events.push("request");
      return withThumbnails(() => "")(url);
    });
    const ids = Array.from({ length: 45 }, (_, i) => String(i + 1));
    await search.getExpansionDetails(ids, "tok", (batch) => events.push("batch of " + batch.length));
    expect(events).toEqual(["request", "batch of 20", "request", "batch of 20", "request", "batch of 5"]);
  });

  test("an empty list asks for nothing", async () => {
    bggAnswers(() => ok("<items/>"));
    expect(await search.getExpansionDetails([], "tok")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test("nothing is remembered between calls: the same ids are asked for again", async () => {
    bggAnswers(withThumbnails(() => "<thumbnail>https://img/1.jpg</thumbnail>"));
    await search.getExpansionDetails(["1"], "tok");
    await search.getExpansionDetails(["1"], "tok");
    expect(things()).toHaveLength(2);
  });
});
