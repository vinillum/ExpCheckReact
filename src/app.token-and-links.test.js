// The API token field (a readable text field that saves when left, not while
// typing) and the result links (real <a> elements that cannot reach back into
// the page).
import {
  bootApp,
  detailsFor,
  idsOf,
  leave,
  NEWEST,
  MIDDLE,
} from "./testHelpers";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

describe("the token field", () => {
  test("is a readable text field (not masked) with autofill and spell-check off", async () => {
    const app = await bootApp();
    const token = app.inputs()[1];
    expect(token.getAttribute("type")).toBe("text");
    expect(token.getAttribute("autocomplete")).toBe("off");
    expect(token.getAttribute("spellcheck")).toBe("false");
  });

  test("typing alone neither saves nor uses the token; leaving the field does, trimmed", async () => {
    const app = await bootApp();
    const token = app.inputs()[1];
    await app.typeWithoutLeaving(token, "  abc-123  ");
    expect(app.savedToken()).toBeNull();
    expect(app.button().textContent).toBe("Enter an API token to fetch updates");

    await app.act(async () => {
      leave(token);
    });
    expect(app.savedToken()).toBe("abc-123");
    expect(app.button().textContent).toBe("Fetch updates...");
  });

  test("pressing Enter (submitting the form) saves it too", async () => {
    const app = await bootApp();
    const token = app.inputs()[1];
    await app.typeWithoutLeaving(token, "from-enter");
    expect(app.savedToken()).toBeNull();
    await app.act(async () => {
      token.form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });
    expect(app.savedToken()).toBe("from-enter");
    expect(app.button().textContent).toBe("Fetch updates...");
  });

  test("clearing it removes the saved value and disables the button; spaces only count as empty", async () => {
    const app = await bootApp({ token: "old-token" });
    expect(app.button().textContent).toBe("Fetch updates...");
    const token = app.inputs()[1];
    expect(token.value).toBe("old-token");

    await app.type(token, "");
    expect(app.savedToken()).toBeNull();
    expect(app.button().textContent).toBe("Enter an API token to fetch updates");

    await app.type(token, "   ");
    expect(app.savedToken()).toBeNull();
  });

  test("a token saved with stray spaces by an older version still works", async () => {
    const app = await bootApp({ token: "  legacy  " });
    expect(app.button().textContent).toBe("Fetch updates...");
  });

  test("storage that refuses writes does not break it: the token works for this page view", async () => {
    const app = await bootApp();
    const setItem = Storage.prototype.setItem;
    vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (key, value) {
        if (key === "API_TOKEN") throw new Error("QuotaExceededError");
        return setItem.call(this, key, value);
      });
    await app.type(app.inputs()[1], "tok");
    expect(app.button().textContent).toBe("Fetch updates...");
  });

  test("the trimmed token is what is sent, for the open entry and for a fetch", async () => {
    const app = await bootApp({
      histories: { alice: { [NEWEST]: ["1"], [MIDDLE]: ["4"] } },
      details: detailsFor("1"),
    });
    await app.click(app.entry(MIDDLE));
    await app.type(app.inputs()[1], " tok ");
    await app.flush();
    expect(app.calls).toHaveLength(1);
    expect(app.calls[0].auth).toBe("Bearer tok");
    expect(idsOf(app.calls[0].url)).toEqual(["4"]);

    await app.click(app.button());
    const fetch = app.calls.find((c) => c.url.includes("/collection/alice"));
    expect(fetch.auth).toBe("Bearer tok");
    expect(app.button().textContent).toBe("Fetching new data for alice");
  });
});

describe("the result links", () => {
  test("each item with a numeric id is a real link that opens in a new tab without an opener", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const app = await bootApp({
      token: "tok",
      histories: { alice: { [NEWEST]: ["123", "456"] } },
      details: detailsFor("123", "456"),
    });
    await app.click(app.entry(NEWEST));

    const links = [...document.querySelectorAll("a.item")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://www.boardgamegeek.com/boardgame/123",
      "https://www.boardgamegeek.com/boardgame/456",
    ]);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel").split(" ").sort()).toEqual([
        "noopener",
        "noreferrer",
      ]);
      expect(link.tabIndex).toBe(0); // reachable with the keyboard
      expect(link.querySelector("img.image")).toBeTruthy();
      expect(link.querySelector(".ui.medium.header").textContent).toMatch(
        /^N(123|456)$/
      );
    }

    // jsdom cannot navigate: stop the click from trying, then check that the
    // page did not open a window by script (it used to call window.open)
    links[0].addEventListener("click", (event) => event.preventDefault());
    await app.act(async () => {
      links[0].click();
    });
    expect(open).not.toHaveBeenCalled();
  });

  test("an id that is not a plain number never becomes a link", async () => {
    // eslint-disable-next-line no-script-url -- deliberate: a hostile id must not become a link
    const odd = ["12/../x", "javascript:alert(1)", "1 2", "", "abc"];
    const app = await bootApp({
      token: "tok",
      histories: { alice: { [NEWEST]: ["7", ...odd] } },
      details: detailsFor("7", ...odd),
    });
    await app.click(app.entry(NEWEST));

    expect(
      [...document.querySelectorAll("a.item")].map((a) => a.getAttribute("href"))
    ).toEqual(["https://www.boardgamegeek.com/boardgame/7"]);
    expect(document.querySelectorAll(".item")).toHaveLength(1 + odd.length); // listed, not clickable
    expect(document.querySelectorAll("a[href^='javascript']")).toHaveLength(0);
  });
});
