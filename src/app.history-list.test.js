// The history list: opening and closing entries, covers, switching between
// accounts, and what the status line says while a fetch runs (its progress, and
// why it failed).
import {
  bootApp,
  deferred,
  detailsFor,
  makeBggUnreachable,
  DEFAULT_COVER,
  NEWEST,
  MIDDLE,
} from "./testHelpers";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

const BOBS = "Thu Nov 05 2026 06:00:00 GMT+0000 (Greenwich Mean Time)";

// alice has two entries, bob one; token present; nothing stored yet
const twoAccounts = (extra = {}) =>
  bootApp({
    token: "tok",
    histories: {
      alice: { [NEWEST]: ["1", "2", "3"], [MIDDLE]: ["4"] },
      bob: { [BOBS]: ["5"] },
    },
    ...extra,
  });

test("covers: a missing or empty thumbnail shows the default image, a real one is kept", async () => {
  const app = await twoAccounts();
  app.noCover.add("1"); // no <thumbnail> element at all
  app.emptyCover.add("2"); // an empty <thumbnail/>
  await app.click(app.entry(NEWEST));

  const covers = Object.fromEntries(
    [...document.querySelectorAll("img.image")].map((i) => [
      i.alt,
      i.getAttribute("src"),
    ])
  );
  expect(covers).toEqual({
    N1: DEFAULT_COVER,
    N2: DEFAULT_COVER,
    N3: "http://i/3",
  });
});

test("clicking the open entry closes it, and another entry replaces it", async () => {
  const app = await twoAccounts({ details: detailsFor("1", "2", "3", "4") });
  await app.click(app.entry(NEWEST));
  expect(app.body()).toContain("N1");

  await app.click(app.entry(NEWEST)); // close
  expect(app.body()).not.toContain("N1");
  await app.click(app.entry(NEWEST)); // open again
  expect(app.body()).toContain("N1");

  await app.click(app.entry(MIDDLE)); // only one entry is open at a time
  expect(app.body()).toContain("N4");
  expect(app.body()).not.toContain("N1");
});

describe("switching accounts", () => {
  test("gives the new account a clean list, and returning does not bring the old open entry back", async () => {
    const app = await twoAccounts({ details: detailsFor("1", "2", "3", "5") });
    await app.click(app.entry(NEWEST));
    expect(app.body()).toContain("N1");

    await app.switchUser("bob");
    expect(app.heads()).toEqual(["Fetch updates...", BOBS]);
    expect(app.body()).not.toContain("N1");

    await app.switchUser("alice");
    expect(app.heads()).toEqual(["Fetch updates...", NEWEST, MIDDLE]);
    expect(app.body()).not.toContain("N1"); // closed, not stale
  });

  test("the same account in another letter case is the same list: an open entry stays open", async () => {
    const app = await twoAccounts({ details: detailsFor("1", "2", "3") });
    await app.switchUser("Alice");
    await app.click(app.entry(NEWEST));
    expect(app.body()).toContain("N1");

    await app.switchUser("alice");
    expect(app.body()).toContain("N1");
  });

  test("a lookup still running when the account changes does not leak into the new account or lock it", async () => {
    const app = await twoAccounts({ details: detailsFor("5") });
    app.holdThing = deferred();
    await app.act(async () => {
      app.entry(MIDDLE).click(); // alice's entry starts loading, held
    });
    expect(app.entry("Fetching")).toBeTruthy();

    await app.switchUser("bob");
    await app.act(async () => {
      app.holdThing.resolve(); // alice's lookup finishes while bob is shown
    });
    app.holdThing = null;
    await app.flush();
    expect(app.body()).not.toContain("N4"); // not under bob

    await app.click(app.entry(BOBS)); // and bob's list is not locked
    expect(app.body()).toContain("N5");
  });
});

test("the status line names the account being fetched, also after switching away, then resets", async () => {
  const app = await twoAccounts();
  await app.click(app.button());
  expect(app.heads()[0]).toBe("Fetching new data for alice");

  await app.switchUser("bob");
  expect(app.heads()[0]).toBe("Fetching new data for alice"); // bob is on screen

  await app.act(async () => {
    app.collection.resolve({
      status: 200,
      data: "<errors><error><message>Invalid username specified</message></error></errors>",
    });
  });
  await app.flush();
  expect(app.heads()[0]).toBe("Fetch updates..."); // finished while bob is shown
});

// ---- progress ---------------------------------------------------------------

// n owned games, so a fetch looks them up in ceil(n / 20) batches
const collectionOf = (n) => ({
  status: 200,
  data: `<items>${Array.from(
    { length: n },
    (_, i) => `<item objectid="${i + 1}"><status own="1"/></item>`
  ).join("")}</items>`,
});

describe("progress", () => {
  test("a fetch shows which batch it is on, then the result", async () => {
    const app = await bootApp({ token: "tok" });
    app.holdThing = deferred();
    await app.click(app.button());
    expect(app.button().textContent).toBe("Fetching new data for alice"); // collection still loading

    await app.act(async () => {
      app.collection.resolve(collectionOf(45));
    });
    await app.flush();
    expect(app.button().textContent).toBe("Fetching new data for alice (batch 1 of 3)");

    const first = app.holdThing;
    app.holdThing = deferred();
    await app.act(async () => first.resolve());
    await app.flush();
    expect(app.button().textContent).toBe("Fetching new data for alice (batch 2 of 3)");

    const second = app.holdThing;
    app.holdThing = deferred();
    await app.act(async () => second.resolve());
    await app.flush();
    expect(app.button().textContent).toBe("Fetching new data for alice (batch 3 of 3)");

    await app.act(async () => app.holdThing.resolve());
    await app.flush();
    expect(app.button().textContent).toBe("Expansions updated. Fetch again...");
    expect(app.things()).toHaveLength(3);
  });

  test("it keeps naming the account being fetched, with progress, after switching away", async () => {
    const app = await twoAccounts();
    app.holdThing = deferred();
    await app.click(app.button());
    await app.act(async () => {
      app.collection.resolve(collectionOf(25));
    });
    await app.flush();
    await app.switchUser("bob");
    expect(app.heads()[0]).toBe("Fetching new data for alice (batch 1 of 2)");

    await app.act(async () => app.holdThing.resolve());
    await app.flush();
    expect(app.heads()[0]).toBe("Fetch updates..."); // finished while bob is shown
  });

  test("opening an entry shows which batch it is on, and the date again when done", async () => {
    const ids = Array.from({ length: 45 }, (_, i) => String(101 + i));
    const app = await bootApp({
      token: "tok",
      histories: { alice: { [NEWEST]: ids } },
    });
    app.holdThing = deferred();
    await app.act(async () => {
      app.entry(NEWEST).click();
    });
    await app.flush();
    expect(app.heads()[1]).toBe("Fetching (batch 1 of 3)");

    for (const expected of ["Fetching (batch 2 of 3)", "Fetching (batch 3 of 3)"]) {
      const held = app.holdThing;
      app.holdThing = deferred();
      await app.act(async () => held.resolve());
      await app.flush();
      expect(app.heads()[1]).toBe(expected);
    }

    await app.act(async () => app.holdThing.resolve());
    await app.flush();
    expect(app.heads()[1]).toBe(NEWEST);
    expect(app.names()).toHaveLength(45);
  });

  test("a failed load does not leave the progress on the entry, and a retry starts from batch 1", async () => {
    const ids = Array.from({ length: 45 }, (_, i) => String(101 + i));
    const app = await bootApp({
      token: "tok",
      histories: { alice: { [NEWEST]: ids } },
    });
    app.failIds.add("141"); // the third batch fails with a 401
    await app.click(app.entry(NEWEST));
    expect(app.heads()[1]).toBe(
      `${NEWEST} - failed to load (BoardGameGeek did not accept the API token), click to retry`
    );

    app.failIds.clear();
    app.holdThing = deferred();
    await app.act(async () => {
      app.entry(NEWEST).click();
    });
    await app.flush();
    expect(app.heads()[1]).toBe("Fetching (batch 1 of 1)"); // only the 5 missing items
  });
});

// ---- the spinner --------------------------------------------------------------

describe("the spinner", () => {
  const ring = (header) => header.querySelector(".loader");

  test("the fetch button spins from the click to the result, including the waits that show no new text", async () => {
    const app = await bootApp({ token: "tok" });
    expect(ring(app.button())).toBeNull(); // idle

    app.holdThing = deferred();
    await app.click(app.button());
    // waiting for the collection: nothing new to say, but the ring is turning
    expect(app.button().textContent).toBe("Fetching new data for alice");
    expect(ring(app.button()).className).toContain("active");
    expect(ring(app.button()).className).toContain("inverted"); // white on the green button
    expect(ring(app.button()).getAttribute("aria-hidden")).toBe("true");
    // Semantic sizes only the ring's parts, not this element; without a size of
    // its own the ring would sit on top of the text
    expect(ring(app.button()).style.width).toBe("1.71rem");
    expect(ring(app.button()).style.height).toBe("1.71rem");

    await app.act(async () => {
      app.collection.resolve(collectionOf(25));
    });
    await app.flush();
    expect(app.button().textContent).toBe("Fetching new data for alice (batch 1 of 2)");
    expect(ring(app.button())).not.toBeNull();

    await app.act(async () => app.holdThing.resolve());
    await app.flush();
    expect(app.button().textContent).toBe("Expansions updated. Fetch again...");
    expect(ring(app.button())).toBeNull();
  });

  test("it also spins while a failed request waits to be retried, and stops when the fetch fails", async () => {
    const app = await bootApp({ token: "tok" });
    await makeBggUnreachable();
    const realSetTimeout = global.setTimeout;
    let release; // lets the retry waits (2 s and longer) end when the test says so
    const held = new Promise((resolve) => (release = resolve));
    vi.spyOn(global, "setTimeout").mockImplementation((fn, ms, ...args) =>
      ms >= 1000 ? realSetTimeout(() => held.then(fn), 0, ...args) : realSetTimeout(fn, ms, ...args)
    );

    await app.click(app.button());
    await app.flush();
    // the first request failed and the app is waiting to ask again
    expect(app.button().textContent).toBe(
      "Fetching new data for alice - no response from BoardGameGeek, retrying (1 of 4)"
    );
    expect(ring(app.button())).not.toBeNull();

    await app.act(async () => release());
    await app.flush();
    expect(app.button().textContent).toBe(
      "Failed to fetch updates: Could not reach BoardGameGeek. Try again..."
    );
    expect(ring(app.button())).toBeNull();
  });

  test("it keeps spinning after switching to another account, since the fetch goes on", async () => {
    const app = await twoAccounts();
    await app.click(app.button());
    await app.switchUser("bob");
    expect(app.heads()[0]).toBe("Fetching new data for alice");
    expect(ring(app.button())).not.toBeNull();

    await app.act(async () => {
      app.collection.resolve({
        status: 200,
        data: "<errors><error><message>Invalid username specified</message></error></errors>",
      });
    });
    await app.flush();
    expect(ring(app.button())).toBeNull();
  });

  test("on the grey button (token cleared during the fetch) the ring is the dark one", async () => {
    const app = await bootApp({ token: "tok" });
    await app.click(app.button());
    expect(ring(app.button()).className).toContain("inverted");

    await app.type(app.inputs()[1], ""); // the button turns grey
    expect(app.button().className).toContain("disabled");
    expect(ring(app.button())).not.toBeNull();
    expect(ring(app.button()).className).not.toContain("inverted"); // white would vanish
  });

  test("an entry spins while it loads, with the dark ring, and no other entry does", async () => {
    const app = await twoAccounts();
    app.holdThing = deferred();
    await app.act(async () => {
      app.entry(NEWEST).click();
    });
    await app.flush();

    expect(ring(app.entry("Fetching"))).not.toBeNull();
    expect(ring(app.entry("Fetching")).className).not.toContain("inverted");
    expect(ring(app.entry(MIDDLE))).toBeNull();
    expect(document.querySelectorAll(".loader")).toHaveLength(1);

    await app.act(async () => app.holdThing.resolve());
    await app.flush();
    expect(document.querySelectorAll(".loader")).toHaveLength(0);
    expect(app.entry(NEWEST).textContent).toBe(NEWEST);
  });

  test("a failed load stops the entry's ring", async () => {
    const app = await twoAccounts();
    app.failIds.add("1");
    await app.click(app.entry(NEWEST));
    expect(app.entry(NEWEST).textContent).toMatch(/failed to load/);
    expect(document.querySelectorAll(".loader")).toHaveLength(0);
  });
});

// ---- the retry note -------------------------------------------------------------

describe("the retry note", () => {
  // Makes the retry waits (2 s and longer) last until `release()` is called.
  const holdRetryWaits = () => {
    const realSetTimeout = global.setTimeout;
    let release;
    const held = new Promise((resolve) => (release = resolve));
    vi.spyOn(global, "setTimeout").mockImplementation((fn, ms, ...args) =>
      ms >= 1000 ? realSetTimeout(() => held.then(fn), 0, ...args) : realSetTimeout(fn, ms, ...args)
    );
    return () => release();
  };

  // Wraps the fake BGG: the first `count` requests whose url contains `part` fail
  // with `error`; everything else is answered as before.
  const failFirst = async (count, part, error) => {
    const axios = (await import("axios")).default;
    const answer = axios.get.getMockImplementation();
    let failed = 0;
    axios.get.mockImplementation((url, config) => {
      if (url.includes(part) && failed < count) {
        failed++;
        return Promise.reject(error);
      }
      return answer(url, config);
    });
  };
  const noResponse = () => new Error("Network Error");
  const serverError = (status) =>
    Object.assign(new Error("failed"), { response: { status } });

  test("the fetch button says why it is waiting while the collection is asked for again, then the note goes", async () => {
    const app = await bootApp({ token: "tok" });
    await failFirst(1, "/collection/", noResponse());
    const release = holdRetryWaits();

    await app.click(app.button());
    expect(app.button().textContent).toBe(
      "Fetching new data for alice - no response from BoardGameGeek, retrying (1 of 4)"
    );

    release();
    await app.flush();
    // asked again; that request has not been answered yet, so the note stays
    // (the failed first request never reached the fake, so only the retry is recorded)
    expect(app.calls.filter((c) => c.url.includes("/collection/"))).toHaveLength(1);
    expect(app.button().textContent).toBe(
      "Fetching new data for alice - no response from BoardGameGeek, retrying (1 of 4)"
    );

    app.holdThing = deferred();
    await app.act(async () => {
      app.collection.resolve(collectionOf(5)); // now it is answered
    });
    await app.flush();
    expect(app.button().textContent).toBe("Fetching new data for alice (batch 1 of 1)");
  });

  test("while BGG prepares the collection (202) the button says so and counts the checks, then the note goes", async () => {
    const app = await bootApp({ token: "tok" });
    const release = holdRetryWaits(); // the real wait is 10 s

    await app.click(app.button());
    await app.act(async () => {
      app.collection.resolve({ status: 202, data: "" });
    });
    await app.flush();
    expect(app.button().textContent).toBe(
      "Fetching new data for alice - BoardGameGeek is preparing the data, checking again (1 of 10)"
    );
    expect(app.button().querySelector(".loader")).not.toBeNull(); // and the ring turns

    release();
    await app.flush();
    // asked again; not answered yet, so the note stays
    expect(app.calls.filter((c) => c.url.includes("/collection/"))).toHaveLength(2);
    expect(app.button().textContent).toContain("checking again (1 of 10)");

    await app.act(async () => {
      app.collection.resolve({ status: 202, data: "" }); // still preparing
    });
    await app.flush();
    release();
    await app.flush();
    expect(app.button().textContent).toContain("checking again (2 of 10)");

    app.holdThing = deferred();
    await app.act(async () => {
      app.collection.resolve(collectionOf(5)); // ready
    });
    await app.flush();
    expect(app.button().textContent).toBe("Fetching new data for alice (batch 1 of 1)");
  });

  test("during a batch it keeps the batch counter, names a server error or the rate limit, and counts the retries", async () => {
    const app = await bootApp({ token: "tok" });
    await app.click(app.button());
    await failFirst(2, "/thing", serverError(503)); // the first two batch requests fail
    const release = holdRetryWaits();

    await app.act(async () => {
      app.collection.resolve(collectionOf(25));
    });
    await app.flush();
    expect(app.button().textContent).toBe(
      "Fetching new data for alice (batch 1 of 2) - BoardGameGeek error 503, retrying (1 of 4)"
    );

    release();
    await app.flush();
    // the second try failed as well, then the third got through
    expect(app.button().textContent).not.toContain("retrying");
    expect(app.button().textContent).toBe("Expansions updated. Fetch again...");
    expect(app.things()).toHaveLength(2); // (the failed requests never reached the fake)
  });

  test("a 429 is described as BGG limiting requests", async () => {
    const app = await bootApp({ token: "tok" });
    await app.click(app.button());
    await failFirst(1, "/thing", serverError(429));
    holdRetryWaits();
    await app.act(async () => {
      app.collection.resolve(collectionOf(5));
    });
    await app.flush();
    expect(app.button().textContent).toBe(
      "Fetching new data for alice (batch 1 of 1) - BoardGameGeek is limiting requests, retrying (1 of 4)"
    );
  });

  test("an entry says why it is waiting, with its batch counter, and the note goes when the entry opens", async () => {
    const app = await bootApp({
      token: "tok",
      histories: { alice: { [NEWEST]: ["1", "2", "3"] } },
    });
    await failFirst(1, "/thing", noResponse());
    const release = holdRetryWaits();

    await app.click(app.entry(NEWEST));
    expect(app.heads()[1]).toBe(
      "Fetching (batch 1 of 1) - no response from BoardGameGeek, retrying (1 of 4)"
    );

    release();
    await app.flush();
    expect(app.heads()[1]).toBe(NEWEST);
    expect(app.names()).toEqual(["N1", "N2", "N3"]);
  });

  test("when the retries run out the note is replaced by the failure, and the next fetch does not start with the old note", async () => {
    const app = await bootApp({ token: "tok" });
    const axios = (await import("axios")).default;
    const answer = axios.get.getMockImplementation();
    await makeBggUnreachable();
    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation((fn, ms, ...args) =>
      realSetTimeout(fn, ms >= 1000 ? 0 : ms, ...args)
    );

    await app.click(app.button());
    await app.flush();
    expect(app.button().textContent).toBe(
      "Failed to fetch updates: Could not reach BoardGameGeek. Try again..."
    );

    axios.get.mockImplementation(answer); // BGG is back
    await app.click(app.button());
    expect(app.button().textContent).toBe("Fetching new data for alice");
  });

  test("retrying an entry whose load failed does not start with the old note", async () => {
    const app = await bootApp({
      token: "tok",
      histories: { alice: { [NEWEST]: ["1", "2", "3"] } },
    });
    const axios = (await import("axios")).default;
    const answer = axios.get.getMockImplementation();
    await makeBggUnreachable();
    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation((fn, ms, ...args) =>
      realSetTimeout(fn, ms >= 1000 ? 0 : ms, ...args)
    );
    await app.click(app.entry(NEWEST));
    await app.flush();
    expect(app.heads()[1]).toBe(
      `${NEWEST} - failed to load (Could not reach BoardGameGeek), click to retry`
    );

    axios.get.mockImplementation(answer); // BGG is back
    app.holdThing = deferred();
    await app.act(async () => {
      app.entry(NEWEST).click();
    });
    await app.flush();
    expect(app.heads()[1]).toBe("Fetching (batch 1 of 1)");
  });

  test("when BGG never finishes preparing the data, the failure says so, on the button and on an entry", async () => {
    const app = await bootApp({
      token: "tok",
      histories: { alice: { [NEWEST]: ["1", "2", "3"] } },
    });
    const axios = (await import("axios")).default;
    axios.get.mockImplementation(() => Promise.resolve({ status: 202, data: "" })); // never ready
    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation((fn, ms, ...args) =>
      realSetTimeout(fn, ms >= 1000 ? 0 : ms, ...args)
    );

    await app.click(app.entry(NEWEST));
    await app.flush();
    expect(app.heads()[1]).toBe(
      `${NEWEST} - failed to load (BoardGameGeek is still preparing the data), click to retry`
    );

    await app.click(app.button());
    await app.flush();
    expect(app.button().textContent).toBe(
      "Failed to fetch updates: BoardGameGeek is still preparing the data. Try again..."
    );
    expect(app.button().style.backgroundColor).toBe("red");
  });

  test("a token BGG does not accept is named on the button and on an entry, with no retries", async () => {
    const app = await bootApp({
      token: "wrong",
      histories: { alice: { [NEWEST]: ["1", "2", "3"] } },
    });
    app.failIds.add("1");
    await app.click(app.entry(NEWEST));
    expect(app.heads()[1]).toBe(
      `${NEWEST} - failed to load (BoardGameGeek did not accept the API token), click to retry`
    );
    expect(app.things()).toHaveLength(1); // not retried

    const axios = (await import("axios")).default;
    axios.get.mockImplementation(() =>
      Promise.reject(Object.assign(new Error("401"), { response: { status: 401 } }))
    );
    await app.click(app.button());
    expect(app.button().textContent).toBe(
      "Failed to fetch updates: BoardGameGeek did not accept the API token. Try again..."
    );
    expect(app.button().style.backgroundColor).toBe("red");
    // nothing was recorded: alice still has only the entry she started with
    expect(Object.keys(JSON.parse(window.localStorage.getItem("history:alice")))).toEqual([NEWEST]);
  });

  // BGG answers, with this status, to every request; the retry waits are skipped
  const bggAlwaysAnswers = async (status) => {
    const axios = (await import("axios")).default;
    axios.get.mockImplementation(() =>
      Promise.reject(Object.assign(new Error("failed"), { response: { status } }))
    );
    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation((fn, ms, ...args) =>
      realSetTimeout(fn, ms >= 1000 ? 0 : ms, ...args)
    );
  };

  test.each([
    [503, "BoardGameGeek is still returning error 503"],
    [429, "BoardGameGeek is still limiting requests"],
  ])("a server that keeps answering %i is named on the button and on an entry", async (status, reason) => {
    const app = await bootApp({
      token: "tok",
      histories: { alice: { [NEWEST]: ["1", "2", "3"] } },
    });
    await bggAlwaysAnswers(status);

    await app.click(app.entry(NEWEST));
    await app.flush();
    expect(app.heads()[1]).toBe(`${NEWEST} - failed to load (${reason}), click to retry`);

    await app.click(app.button());
    await app.flush();
    expect(app.button().textContent).toBe(`Failed to fetch updates: ${reason}. Try again...`);
    expect(app.button().style.backgroundColor).toBe("red");
  });

  test("a failure with no reason of its own still gets the generic text (a 403 here)", async () => {
    const app = await bootApp({
      token: "tok",
      histories: { alice: { [NEWEST]: ["1", "2", "3"] } },
    });
    await bggAlwaysAnswers(403);

    await app.click(app.entry(NEWEST));
    await app.flush();
    expect(app.heads()[1]).toBe(`${NEWEST} - failed to load, click to retry`);

    await app.click(app.button());
    await app.flush();
    expect(app.button().textContent).toBe("Failed to fetch updates. Try again...");
  });

  test("a note that arrives after an account switch still shows on the button, which still belongs to the running fetch", async () => {
    const app = await twoAccounts();
    await failFirst(1, "/collection/", noResponse());
    holdRetryWaits();
    await app.click(app.button());
    await app.switchUser("bob");
    expect(app.heads()[0]).toBe(
      "Fetching new data for alice - no response from BoardGameGeek, retrying (1 of 4)"
    );
  });
});

// ---- BGG cannot be reached ----------------------------------------------------

describe("BGG cannot be reached", () => {
  // The retries wait 2 + 4 + 8 + 16 s; here they do not.
  const skipLongWaits = () => {
    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation((fn, ms, ...args) =>
      realSetTimeout(fn, ms >= 1000 ? 0 : ms, ...args)
    );
  };

  test("a fetch says so instead of the generic failure", async () => {
    const app = await bootApp({ token: "tok" });
    await makeBggUnreachable();
    skipLongWaits();
    await app.click(app.button());
    await app.flush();
    expect(app.button().textContent).toBe(
      "Failed to fetch updates: Could not reach BoardGameGeek. Try again..."
    );
    expect(app.button().style.backgroundColor).toBe("red");
    expect(window.localStorage.getItem("history:alice")).toBeNull();
  });

  test("opening an entry says so too, and the entry can be retried", async () => {
    const app = await bootApp({
      token: "tok",
      histories: { alice: { [NEWEST]: ["1", "2"] } },
    });
    await makeBggUnreachable();
    skipLongWaits();
    await app.click(app.entry(NEWEST));
    await app.flush();
    expect(app.heads()[1]).toBe(
      `${NEWEST} - failed to load (Could not reach BoardGameGeek), click to retry`
    );
    expect(app.storedIds()).toEqual([]);
  });
});

test("a fetch that BGG rejects shows BGG's own reason and records nothing", async () => {
  const app = await bootApp({ username: "typo_user", token: "tok" });
  await app.click(app.button());
  await app.act(async () => {
    app.collection.resolve({
      status: 200,
      data: "<errors><error><message>Invalid username specified</message></error></errors>",
    });
  });
  await app.flush();

  expect(app.button().textContent).toBe(
    "Failed to fetch updates: Invalid username specified. Try again..."
  );
  expect(app.button().style.backgroundColor).toBe("red");
  expect(window.localStorage.getItem("history:typo_user")).toBeNull();
  expect(app.heads()).toHaveLength(1); // no empty entry was added
});
