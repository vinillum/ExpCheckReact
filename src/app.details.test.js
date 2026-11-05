// Kept history details and the optional API token: the history can be browsed
// without a token, an entry is loaded from BGG at most once (also across page
// reloads), and the fetch button is only usable once a username and a token exist.
import {
  bootApp,
  detailsFor,
  idsOf,
  EXPANSIONS_KEY,
  DEFAULT_COVER,
  NEWEST,
  MIDDLE,
  OLDEST,
} from "./testHelpers";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

test("without a token the history is browsable from storage and the fetch button is visible but inert", async () => {
  const app = await bootApp({
    histories: {
      alice: { [NEWEST]: ["1", "2", "3"], [MIDDLE]: ["4"], [OLDEST]: [] },
    },
    details: detailsFor("1", "2", "3"),
  });
  expect(app.heads()).toEqual([
    "Enter an API token to fetch updates",
    NEWEST,
    MIDDLE,
    OLDEST,
  ]);

  const button = app.button();
  expect(button.className).toContain("disabled");
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(button.getAttribute("role")).toBe("button");
  expect(button.style.cursor).toBe("not-allowed");
  await app.click(button);
  expect(app.calls).toHaveLength(0); // inert
  expect(app.button().textContent).toBe("Enter an API token to fetch updates");

  await app.click(app.entry(NEWEST)); // fully stored: opens with no request
  expect(app.body()).toContain("N1");
  expect(app.body()).toContain("N3");

  await app.click(app.entry(MIDDLE)); // not stored and no token: a note instead
  expect(app.body()).toContain(
    "1 item is not loaded yet. Enter an API token to load it."
  );
  expect(app.body()).not.toContain("N1");

  await app.click(app.entry(OLDEST)); // an entry with nothing in it
  expect(app.body()).toContain("No new expansions found");
  expect(app.calls).toHaveLength(0);
});

test("entering the token enables the button and loads the open entry that was missing items", async () => {
  const app = await bootApp({
    histories: { alice: { [NEWEST]: ["1"], [MIDDLE]: ["4"] } },
    details: detailsFor("1"),
  });
  await app.click(app.entry(MIDDLE));
  expect(app.body()).toContain("not loaded yet");
  expect(app.calls).toHaveLength(0);

  await app.type(app.inputs()[1], "tok");
  expect(app.button().textContent).toBe("Fetch updates...");
  expect(app.button().className).not.toContain("disabled");
  expect(app.button().getAttribute("aria-disabled")).toBe("false");
  expect(app.things()).toHaveLength(1); // the open entry loaded by itself
  expect(app.things()[0].auth).toBe("Bearer tok");
  expect(idsOf(app.things()[0].url)).toEqual(["4"]);
  await app.flush();
  expect(app.body()).toContain("N4");
  expect(app.body()).not.toContain("not loaded yet");
  expect(app.storedIds()).toEqual(["1", "4"]); // and kept

  await app.click(app.button()); // the enabled button starts a fetch
  expect(
    app.calls.filter((c) => c.url.includes("/collection/alice"))
  ).toHaveLength(1);
  expect(app.button().textContent).toBe("Fetching new data for alice");
  await app.act(async () => {
    app.collection.resolve({
      status: 200,
      data: "<errors><error><message>Invalid username specified</message></error></errors>",
    });
  });
  await app.flush();

  await app.type(app.inputs()[1], ""); // clearing the token disables it again
  expect(app.button().textContent).toBe("Enter an API token to fetch updates");
  expect(app.button().getAttribute("aria-disabled")).toBe("true");
  expect(app.heads().slice(1)).toEqual([NEWEST, MIDDLE]); // history stays
});

test("an entry loaded once is never requested again: closing, reopening, and a page reload", async () => {
  let app = await bootApp({
    token: "tok",
    histories: { alice: { [NEWEST]: ["1", "2", "3"] } },
  });
  await app.click(app.entry(NEWEST));
  expect(app.things()).toHaveLength(1);
  expect(idsOf(app.things()[0].url)).toEqual(["1", "2", "3"]);
  expect(app.body()).toContain("N2");

  await app.click(app.entry(NEWEST)); // close
  await app.click(app.entry(NEWEST)); // reopen
  expect(app.things()).toHaveLength(1);

  app = await bootApp({ keepStorage: true }); // reload, token still saved
  await app.click(app.entry(NEWEST));
  expect(app.body()).toContain("N1");
  expect(app.body()).toContain("N3");
  expect(app.calls).toHaveLength(0);

  window.localStorage.removeItem("API_TOKEN");
  app = await bootApp({ keepStorage: true }); // reload without a token
  await app.click(app.entry(NEWEST));
  expect(app.body()).toContain("N2");
  expect(app.calls).toHaveLength(0);
});

test("only the missing items are requested, and the entry's order is kept", async () => {
  const app = await bootApp({
    token: "tok",
    histories: { alice: { [NEWEST]: ["3", "2", "1"] } },
    details: detailsFor("2"),
  });
  await app.click(app.entry(NEWEST));
  expect(app.things()).toHaveLength(1);
  expect(idsOf(app.things()[0].url)).toEqual(["3", "1"]); // 2 is stored
  expect(app.names()).toEqual(["N3", "N2", "N1"]);
});

test("a failure part way keeps what arrived, and the retry only asks for the rest", async () => {
  const ids = Array.from({ length: 45 }, (_, i) => String(101 + i));
  const app = await bootApp({
    token: "tok",
    histories: { alice: { [NEWEST]: ids } },
  });
  app.failIds.add("141"); // the third batch (141-145) fails
  await app.click(app.entry(NEWEST));
  expect(app.entry(NEWEST).textContent).toMatch(/failed to load \(.*\), click to retry/);
  expect(app.storedIds()).toHaveLength(40); // batches 1 and 2 were kept

  app.failIds.clear();
  const before = app.things().length;
  await app.click(app.entry(NEWEST));
  expect(app.things()).toHaveLength(before + 1);
  expect(idsOf(app.things()[app.things().length - 1].url)).toEqual([
    "141",
    "142",
    "143",
    "144",
    "145",
  ]);
  expect(app.names()).toHaveLength(45);
  expect(app.storedIds()).toHaveLength(45);
});

test("when storage is full the entry still opens, it just is not kept", async () => {
  const app = await bootApp({
    token: "tok",
    histories: { alice: { [NEWEST]: ["1", "2"] } },
  });
  const setItem = Storage.prototype.setItem;
  vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (key, value) {
      if (key === EXPANSIONS_KEY) throw new Error("QuotaExceededError");
      return setItem.call(this, key, value);
    });
  await app.click(app.entry(NEWEST));
  expect(app.body()).toContain("N1");
  expect(app.body()).toContain("N2");
  expect(window.localStorage.getItem(EXPANSIONS_KEY)).toBe("{}");
});

describe("a damaged store of details", () => {
  test("is treated as empty when it is not JSON", async () => {
    const app = await bootApp({
      token: "tok",
      histories: { alice: { [NEWEST]: ["1", "2"] } },
      details: "{{{ not json",
    });
    await app.click(app.entry(NEWEST));
    expect(app.things()).toHaveLength(1);
    expect(app.body()).toContain("N1");
  });

  test("ignores entries of the wrong shape, including names that exist on every object", async () => {
    const app = await bootApp({
      token: "tok",
      histories: { alice: { [NEWEST]: ["1", "2"] } },
      details: {
        1: "garbage",
        2: { id: "2", name: 5, thumbnail: "x" },
        constructor: { id: "constructor", name: "x", thumbnail: "x" },
      },
    });
    await app.click(app.entry(NEWEST));
    expect(idsOf(app.things()[0].url)).toEqual(["1", "2"]);
  });
});

test("an item without a cover is kept like any other, and the placeholder stays", async () => {
  const app = await bootApp({
    token: "tok",
    histories: { alice: { [NEWEST]: ["7"] } },
  });
  app.noCover.add("7");
  await app.click(app.entry(NEWEST));
  expect(document.querySelector("img.image").getAttribute("src")).toBe(
    DEFAULT_COVER
  );

  app.noCover.clear(); // BGG has a cover now, but the item is already kept
  await app.click(app.entry(NEWEST));
  await app.click(app.entry(NEWEST));
  expect(app.things()).toHaveLength(1);
  expect(document.querySelector("img.image").getAttribute("src")).toBe(
    DEFAULT_COVER
  );
});

test("the note counts the items that are not loaded, singular and plural", async () => {
  const app = await bootApp({
    histories: { alice: { [NEWEST]: ["1", "2", "3"], [MIDDLE]: ["4"] } },
  });
  await app.click(app.entry(NEWEST));
  expect(app.body()).toContain(
    "3 items are not loaded yet. Enter an API token to load them."
  );
  await app.click(app.entry(MIDDLE));
  expect(app.body()).toContain(
    "1 item is not loaded yet. Enter an API token to load it."
  );
});

test("without a username the button is inert and says what is missing", async () => {
  const app = await bootApp({ username: "", token: "tok" });
  expect(app.heads()).toEqual(["Enter a username to fetch updates"]);
  expect(app.button().getAttribute("aria-disabled")).toBe("true");
  await app.click(app.button());
  expect(app.calls).toHaveLength(0);
});

test("a normal fetch works end to end and shows its result", async () => {
  const app = await bootApp({ token: "tok" });
  await app.click(app.button());
  expect(app.button().getAttribute("aria-disabled")).toBe("true"); // busy
  await app.click(app.button()); // a second click does nothing
  expect(
    app.calls.filter((c) => c.url.includes("/collection/"))
  ).toHaveLength(1);

  await app.act(async () => {
    app.collection.resolve({
      status: 200,
      data: '<items><item objectid="100"><status own="1"/></item></items>',
    });
  });
  await app.flush();
  expect(app.button().textContent).toBe("Expansions updated. Fetch again...");
  expect(app.heads()).toHaveLength(2); // the button and the new entry
});

test("a fetch whose result cannot be saved (storage full) is reported as failed, not as updated", async () => {
  const app = await bootApp({ token: "tok" });
  const setItem = Storage.prototype.setItem;
  vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (key, value) {
      if (key.startsWith("history:")) throw new Error("QuotaExceededError");
      return setItem.call(this, key, value);
    });
  await app.click(app.button());
  await app.act(async () => {
    app.collection.resolve({
      status: 200,
      data: '<items><item objectid="100"><status own="1"/></item></items>',
    });
  });
  await app.flush();

  expect(app.button().textContent).toBe("Failed to fetch updates. Try again...");
  expect(app.button().style.backgroundColor).toBe("red");
  expect(app.button().getAttribute("aria-disabled")).toBe("false"); // usable again
});
