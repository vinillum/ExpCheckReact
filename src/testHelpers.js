// Helpers shared by the UI tests (src/app.*.test.js). Only tests import this file,
// so it never reaches the production bundle.
//
// The tests drive the real app (src/index.js) in jsdom, with axios mocked, so they
// exercise the actual components, storage and request code together.

// tells React that updates in these tests are wrapped in act(); in jsdom the
// window is the global object
window.IS_REACT_ACT_ENVIRONMENT = true;

export const EXPANSIONS_KEY = "expcheck:expansions:v1";
export const DEFAULT_COVER =
  "https://cf.geekdo-images.com/zxVVmggfpHJpmnJY9j-k1w__small/img/Tse35rOD2Z8Pv9EOUj4TfeMuNew=/fit-in/200x150/filters:strip_icc()/pic1657689.jpg";

// Dates in the format the app uses as history keys (Date.toString()).
export const NEWEST = "Thu Nov 05 2026 07:00:00 GMT+0000 (Greenwich Mean Time)";
export const MIDDLE = "Wed Nov 04 2026 07:00:00 GMT+0000 (Greenwich Mean Time)";
export const OLDEST = "Tue Nov 03 2026 07:00:00 GMT+0000 (Greenwich Mean Time)";

// The ids a thing URL asks for: ".../thing?id=1,2,3&_=123" -> ["1", "2", "3"]
export const idsOf = (url) => url.split("id=")[1].split("&")[0].split(",");

// Stored details for the given ids, in the shape the app keeps them.
export const detailsFor = (...ids) =>
  Object.fromEntries(
    ids.map((id) => [id, { id, name: "N" + id, thumbnail: "http://i/" + id }])
  );

export function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// The page's requests all go through this mock (see bootApp); makes every one of
// them fail the way a browser reports an unreachable server: with no response.
export async function makeBggUnreachable() {
  const axios = (await import("axios")).default;
  axios.get.mockImplementation(() => Promise.reject(new Error("Network Error")));
}

// Sets an input's value the way a user typing would (React listens for "input").
export function setValue(input, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
    input,
    value
  );
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function leave(input) {
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

// Starts the app from scratch: fresh modules, storage seeded as given, BGG
// mocked. Returns the handles a test needs.
//
//   username, token   what is already saved in localStorage ("" = nothing)
//   histories         { user: { "<date key>": [ids] } }
//   details           the stored names/covers (an object, or a raw string to
//                     simulate a corrupt store)
//   keepStorage       true = do not touch localStorage: a page reload
//
// Fake BGG, adjustable while a test runs:
//   app.failIds       a thing request containing one of these ids gets a 401
//   app.noCover       these ids come back without a <thumbnail> element
//   app.emptyCover    these ids come back with an empty <thumbnail/>
//   app.holdThing     a deferred(): thing responses wait until it is resolved
//   app.collection    the pending collection request (a deferred), if any
export async function bootApp({
  username = "alice",
  token = "",
  histories = {},
  details = {},
  keepStorage = false,
} = {}) {
  vi.resetModules();
  // act must come from the same React instance as the app, which is loaded
  // fresh after the reset; one from before it would not see the app's updates.
  const { act } = await import("react");
  const store = window.localStorage;
  if (!keepStorage) {
    store.clear();
    if (username) store.setItem("USERNAME", username);
    if (token) store.setItem("API_TOKEN", token);
    Object.entries(histories).forEach(([user, history]) =>
      store.setItem("history:" + user, JSON.stringify(history))
    );
    store.setItem(
      EXPANSIONS_KEY,
      typeof details === "string" ? details : JSON.stringify(details)
    );
  }
  document.body.innerHTML = '<div id="root"></div>';

  const app = {
    act,
    calls: [], // every request: { url, auth }
    failIds: new Set(),
    noCover: new Set(),
    emptyCover: new Set(),
    holdThing: null,
    collection: null,
  };
  const axios = (await import("axios")).default;
  axios.get.mockImplementation((url, config) => {
    app.calls.push({ url, auth: config.headers.Authorization });
    if (url.includes("/collection/")) {
      app.collection = deferred();
      return app.collection.promise;
    }
    const ids = idsOf(url);
    if (ids.some((id) => app.failIds.has(id))) {
      return Promise.reject(
        Object.assign(new Error("401"), { response: { status: 401 } })
      );
    }
    const cover = (id) =>
      app.noCover.has(id)
        ? ""
        : app.emptyCover.has(id)
        ? "<thumbnail/>"
        : `<thumbnail>http://i/${id}</thumbnail>`;
    const respond = () => ({
      status: 200,
      data: `<items>${ids
        .map(
          (id) =>
            `<item id="${id}"><name type="primary" value="N${id}"/>${cover(id)}</item>`
        )
        .join("")}</items>`,
    });
    return app.holdThing
      ? app.holdThing.promise.then(respond)
      : Promise.resolve(respond());
  });

  const flush = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  await act(async () => {
    await import("./index");
  });
  await flush();

  const all = (selector) => [...document.querySelectorAll(selector)];
  return Object.assign(app, {
    flush,
    // what is on the page
    inputs: () => all("input"),
    heads: () => all("h3.header").map((h) => h.textContent),
    button: () => document.querySelector("h3.header"),
    entry: (startsWith) =>
      all("h3.header").find((h) => h.textContent.startsWith(startsWith)),
    body: () => document.body.textContent,
    names: () => all(".ui.medium.header").map((e) => e.textContent),
    // what the app has done
    things: () => app.calls.filter((c) => c.url.includes("/thing")),
    storedIds: () =>
      Object.keys(JSON.parse(store.getItem(EXPANSIONS_KEY) || "{}")).sort(),
    savedToken: () => store.getItem("API_TOKEN"),
    // what a user does
    click: async (element) => {
      await act(async () => {
        element.click();
      });
      await flush();
    },
    typeWithoutLeaving: (input, value) =>
      act(async () => {
        setValue(input, value);
      }),
    type: async (input, value) => {
      await act(async () => {
        setValue(input, value);
      });
      await act(async () => {
        leave(input);
      });
    },
    switchUser: async (name) => {
      const input = document.querySelectorAll("input")[0];
      await act(async () => {
        setValue(input, name);
      });
      await act(async () => {
        leave(input);
      });
    },
  });
}
