# Expansion checker

Checks for new expansions for a given BoardGameGeek (BGG) user.

## How it works

1. Enter a BGG **username**. The history of earlier checks for that user appears.
2. Enter a BGG **API token** (an application token for the BGG API) and press Enter or leave the field. It is optional: it is only needed to fetch updates, and to load items of a history entry that are not stored yet.
3. Click **Fetch updates...**. The app reads the user's collection, looks up every game they own or have pre-ordered, and collects everything BGG links to those games as an expansion, accessory, reimplementation or integration (in both directions, so base games and originals are included). Whatever was not seen before is recorded as a new, dated history entry. While it runs, the button shows a spinning ring and how far it is ("batch 3 of 14"). When a request has to be asked again, the button says why and how many tries are used: "no response from BoardGameGeek, retrying (2 of 4)" after a failure, or "BoardGameGeek is preparing the data, checking again (3 of 10)" while BGG builds a large collection export (this can take a minute or more; if it is still not ready after the last check, the app says so and you can try again later). The same goes for an entry that is loading. The first fetch for a user lists everything, as a baseline; later fetches list only what is new.
4. Click a history entry to see the names and covers of its items (click it again to close it). Names and covers are loaded from BGG once and then kept, so an entry opens instantly the next time, also after a reload and without a token. Opening a very large entry for the first time can take a couple of minutes (about 20 items per request, paced to stay within BGG's rate limit); the entry shows its progress, and a spinning ring, meanwhile.

If BGG cannot be reached (no network, or the browser blocks the request) the app retries for about 30 seconds and then says "Could not reach BoardGameGeek". If BGG refuses the token it says so at once ("BoardGameGeek did not accept the API token") and does not retry. If BGG keeps limiting requests or answering with a server error, the app retries the same way and then says so ("BoardGameGeek is still limiting requests", "BoardGameGeek is still returning error 503"); try again a little later.

## Data and privacy

Everything is kept in the browser's localStorage; the app has no server.

| Key | What it holds |
|---|---|
| `USERNAME` | the username last entered |
| `API_TOKEN` | the API token, in plain text |
| `history:<username>` | that user's history (lower case); every id seen so far, grouped by fetch |
| `expcheck:expansions:v1` | names and covers of the items opened in the history, shared by all users |

The username and the token are sent only to `boardgamegeek.com`, over HTTPS. The page also loads its stylesheet and fonts from cdnjs and Google Fonts and the cover images from `cf.geekdo-images.com`; none of those requests carries the username or the token, and the page sends no referrer to any host. A Content-Security-Policy in `index.html` limits the page to those hosts.

To reload the stored names and covers, delete `expcheck:expansions:v1` in the browser's developer tools. To start a user's history over, delete their `history:<username>` key.

The token field shows what you type (it is not masked) and the token is kept in plain text in localStorage, so any script running on the page could read it; the Content-Security-Policy below is what limits that. The token is saved only when you leave the field or press Enter, never while typing, and only the trimmed value is stored. Entries from an older version may leave `expcheck:links:v1` and `expcheck:details:v1` behind; nothing reads them and they can be deleted.

## What counts as a new item

- **Everything BGG links to your games:** expansions, accessories, reimplementations and integrations, in both directions. Originals of owned reimplementations and base games of owned expansions are listed too. There is no per-type filter.
- **Owned and pre-ordered games** are looked up, including owned expansions. Skipping the expansions would halve a run but lose items that are reachable only through an owned expansion (promos, accessories).
- **The first fetch lists everything** (1,000+ items for a big collection). It is the baseline, and a check for things you missed.
- **Nothing is cached for discovery.** Every fetch asks BGG about every owned game, so a newly linked item shows up on the very next fetch. A fetch that fails partway starts over.
- **A fetch that finds nothing still records an entry**, as a "last checked" marker.
- **Cover images are kept as they were.** An item that had no cover when first loaded keeps the default image, even if BGG adds one later.
- **Entry titles** are the raw `Date.toString()` of the fetch. Entries are sorted newest first by their real date.

## Notes on the BoardGameGeek API

Measured against the live API on 2026-11-05.

- **Authorization:** every request sends the token as a `Bearer` header. A wrong token gets a real 401 with CORS headers, so the app sees it at once and does not retry. Each request costs a CORS preflight, because Chrome does not share its preflight cache between different URLs.
- **Rate limit:** BGG does not report its limits (no `Retry-After`, no `X-RateLimit-*`). A limited request gets HTTP 429. Measured: a burst of about 37 to 39 back-to-back requests, then 429, with recovery within about 2 seconds; 56 requests one second apart were all accepted. The app therefore sends up to 20 requests a minute back to back and waits 1 second before each one after that (`BURST_REQUESTS`, `BURST_WINDOW_MS`, `PACED_DELAY_MS` in `src/search.js`). All lookups on the page share that allowance. A failed request is retried after 2, 4, 8 and 16 seconds. Behaviour under sustained loads longer than about 90 seconds was not tried.
- **Batch size:** a `thing` request takes at most 20 ids (21 gives HTTP 400), so `BATCH_SIZE` is 20. A collection of 270 owned items takes 14 requests and about 23 seconds; opening a 1,000-item history entry for the first time takes about 54 requests.
- **Errors can look like success.** An unknown username gets HTTP 200 with an `<errors>` body, and an unknown id gets HTTP 200 with empty `<items>`. The app rejects an `<errors>` body, a parse error, any root other than `<items>` and a collection with no items, so a typo in the username is reported instead of recorded as an empty fetch. (A real user with a genuinely empty collection gets the same "No items found" failure.)
- **The collection export** may answer 202 while BGG prepares it; the app polls up to 10 times, 10 seconds apart. `thing` requests poll up to 5 times, 2 seconds apart.
- **Expansions:** the collection endpoint includes expansions, but every item says `subtype="boardgame"`, so the attribute cannot tell them apart.
- **Browsers cache `thing` responses for an hour** (`Cache-Control: max-age=3600`), which would hide new links. Every `thing` request therefore carries an extra `&_=<timestamp>` parameter, which BGG ignores. If BGG ever rejects unknown parameters this fails loudly with a 400. The side effect is that the browser stores about 2.5 MB of never-reused responses per fetch and evicts them on its own.
- **Headless Chrome is refused.** Cloudflare answers the CORS preflight of a browser that announces itself as `HeadlessChrome` with a 403, so the app cannot be driven live by a headless browser with its default user agent. Real browsers are not affected.

## Security

- No XSS surface: React escapes everything, there is no `dangerouslySetInnerHTML`, and the XML is parsed with `DOMParser`, which does not run scripts.
- `index.html` pins Semantic UI 2.4.1 from cdnjs with a Subresource Integrity hash (the one cdnjs publishes), sets a strict Content-Security-Policy as a meta tag (no `'unsafe-inline'`; React sets styles through the CSSOM, which a CSP allows) and a `no-referrer` policy. The stylesheet imports a Lato font CSS from Google Fonts, which a hash cannot cover. Self-hosting the CSS and fonts would remove the dependence on three third-party hosts; it was left out.
- A `<meta>` policy cannot set `frame-ancestors`, so protection against framing would need a header from the host. If BGG moves its covers to another host, covers stop showing until that host is added to `img-src`, and anything inline added to the page is blocked.
- Result links are real `<a target="_blank" rel="noopener noreferrer">` elements, and only a plain numeric id from BGG becomes a link.
- `npm audit` reports 0 vulnerabilities.

## Known limitations

- Two tabs saving at the same moment can overwrite each other's batch of loaded details or history; the next open loads what is missing. There is no way to refresh a stored item other than deleting `expcheck:expansions:v1`.
- An id that BGG does not return (a deleted or merged item) is never stored, so it is requested again each time its entry is opened with a token.
- The stored details take roughly 200 KB per thousand items, against about 5 MB of localStorage. If storage is full or unreadable, entries still open; they are just not kept.
- Only Chrome was driven against the live API. Firefox and Safari, and a deployed origin other than localhost, were not tried.

## Requirements

Node.js `^22.13`, `^24` or `>=26` (see `engines` in `package.json`; Vitest and jsdom set the lower bound).

Vite, Vitest and ESLint are dev dependencies, so a deploy build has to install dev dependencies (use `npm ci --include=dev` if the host sets `NODE_ENV=production`).

## Scripts

### `npm start`

Runs the app in development mode.\
Open [http://localhost:5173](http://localhost:5173) to view it in the browser.

The page reloads when you edit a file.

The dev server serves a slightly relaxed copy of the Content-Security-Policy in `index.html` (inline scripts and a websocket, which hot reload needs). The production build keeps the strict one. See `vite.config.js`.

### `npm test`

Runs the test suite ([Vitest](https://vitest.dev)) in watch mode. Use `CI=true npm test` or `npx vitest run` for a single run.\
It covers the requests to BoardGameGeek (pacing, retries, error handling), the local storage, and the whole page driven through its real components. BoardGameGeek is always faked, so the tests need no network and no API token.

For coverage, run `npx vitest run --coverage`; it offers to install `@vitest/coverage-v8` the first time.

### `npm run lint`

Checks the code with [ESLint](https://eslint.org) (see `eslint.config.js`) and fails on any warning. The dev server does not show lint errors in the browser, so run this before committing.

### `npm run build`

Builds the app for production with [Vite](https://vite.dev) to the `build` folder.\
The build is minified and the filenames include hashes.

### `npm run preview`

Serves the production build from the `build` folder at [http://localhost:4173](http://localhost:4173), to check it before deploying.
