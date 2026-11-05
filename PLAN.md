# Plan: unresolved issues and open questions

Output of a review of this repo (logic, security, performance). This file lists
what is **still open**. Everything not listed here was fixed or decided; see
"Status" and "Decided, deliberately left as-is" at the end.

Legend: **[confirmed live]** = checked against the real BoardGameGeek (BGG) API on
2026-11-03, using `curl`/Python with a real token and a real account (about
3,500 collection items, 274 owned or pre-ordered). CORS headers were inspected.
The built app was also driven in a visible Chrome window against the live API on
2026-11-05 (see 2.5).
**[verified]** = reproduced in code or a test. **[unverified]** = not checked.

Sections 0 to 2 have nothing left to do: every item there is fixed or decided, and
what remains are the caveats noted inside them (unverified browsers, known
limitations). The open work: section 5 (tests), then 4 and 6. Section 3 is done; only an
optional Vite migration is left (3.7).

---

## 0. Results of the live checks

| Assumption | Result |
|---|---|
| An expansion's `thing` record links back to its base game with `inbound="true"` | **Confirmed.** Also true for accessories and for reimplementations (they link back to the original). Integration links carry no `inbound` flag in either direction. These back-links are **wanted** (originals and base games should be listed), so nothing is filtered; see "Decided". |
| The v1 collection endpoint includes expansions (so owned expansions land in `seen`) | **Holds, although every item says `subtype="boardgame"`.** The default response contains all 779 expansion-collection items (145 owned); `thing` reports 150 of the 274 owned ids as type `boardgameexpansion`. The `subtype` attribute cannot be used to tell expansions apart. |
| An unknown username fails clearly | **No.** HTTP 200 with `<errors><error><message>Invalid username specified</message></error></errors>`, for both `/xmlapi/collection` and `/xmlapi2/collection`. The app used to report success; fixed (see 2.1). |
| A bad token looks like a network error (slow to fail) | **No, better than assumed.** A wrong token gives a real 401 with `access-control-allow-origin: *`, so the browser sees the status and the app fails at once without retrying. A request with no `Authorization` header at all gets a 401 without CORS headers, but the app always sends the header and the UI needs a non-empty token. |
| `Retry-After` is readable by the browser | **It does not exist.** BGG's 429 response has no `Retry-After` (and no other rate-limit header), and 200 responses expose no extra headers to browsers either. The unused `Retry-After` handling has been removed (see 1.5). |
| Missing ids return an error | **No.** `thing?id=999999999` gives 200 with an empty `<items>`. |
| `Authorization` header passes CORS | **Yes, but every request costs a preflight.** The preflight allows `Authorization` and `GET` and answers 204 for any origin. It is cacheable for 300 s, but Chrome keys that cache by URL, and every `thing` request has its own URL (different ids, plus the `&_=` parameter), so in a real browser each request is preceded by its own preflight (15 preflights for 15 requests were seen). That adds a round trip per request. No 429 occurred in the browser run (about 85 GETs plus as many preflights), but the rate limit in 1.5 was measured with GETs only. (An earlier version of this row said the preflight is cached for five minutes, which is true only for repeated identical URLs.) |
| Duplicate ids in a collection / own+preordered both set | **Duplicates confirmed** (2 `objectid`s listed twice on the test account), so the dedupe is warranted. Own and pre-ordered together was not observed (0 items). |
| How fast can requests go | **Measured on 2026-11-05, see 1.5:** a burst of about 37-39 back-to-back requests, then HTTP 429; recovery within about 2 s; 56 requests at a 1 s pause were all accepted. The app now bursts then paces (1.5); confirmed live with no 429 on its two heaviest jobs. |
| How many ids per `thing` request | **20, hard limit.** 21 ids give `HTTP 400 "Cannot load more than 20 items"`. `BATCH_SIZE = 20` is the maximum. |
| Responses are always fresh | **No.** `thing` responses carry `Cache-Control: s-maxage=0, max-age=3600` and Chrome reuses them for an hour; the collection response has no cache headers. Fixed with a cache-busting parameter (see 2.5). |

Size of the test account: 3,540 collection items (779 expansions, 145 of them
owned; 267 owned and 7 pre-ordered games). Looking up the 274 owned items took
14 `thing` requests and 2.5 MB of uncompressed XML. The first run found 1,101
associated items: 595 linked only as accessories, 427 as expansions, 59 as
reimplementations, 19 as integrations, 1 as both of the last two.

To repeat the checks, with `$BGG_TOKEN` set in the environment:
`curl -H "Authorization: Bearer $BGG_TOKEN" "https://boardgamegeek.com/xmlapi2/thing?id=205666"`
(an expansion; look for `<link ... inbound="true">`) and
`curl -H "Authorization: Bearer $BGG_TOKEN" "https://boardgamegeek.com/xmlapi/collection/no_such_user_123"`.

---

## 1. Questions (all answered)

No open questions remain here; the answers are kept for reference. Numbers are
kept stable because other sections refer to them.

### 1.1 Which link types count? Decided: all four.
Accessories, expansions, reimplementations and integrations are all wanted, in both
directions (see "Decided"). No setting to filter by type is planned.

### 1.2 First run lists everything. Decided: intended.
The first fetch acts as a baseline and as a check for items the user missed, so a
very large first entry (1,101 items on the test account) is expected. Only the
cost of opening such an entry *the first time* remains (54-56 `thing` requests,
about 105 s on the test account); later opens are instant (1.3a); see section 4.

### 1.3 Caching of lookups. Decided: none for discovery, permanent for history details.
A short-lived cache was tried and removed: new items must appear on the very next
fetch, with no waiting period. Every fetch asks BGG for every owned game, and a
failure partway through starts over.
**Exception, decided later:** the names and covers of the items listed in the
history are kept for good once loaded (`expcheck:expansions:v1` in localStorage,
shared by all accounts). An entry is never requested from BGG twice, not even
after a page reload, and can be browsed without a token. This does not affect
discovery, which always asks BGG; see "History details" below for the caveats.

### 1.3a History details. Kept for good
`getDetails` / `saveDetails` in `src/storage.js`; `loadEntry` in
`src/SearchHeaders.js`. Opening an entry reads what is stored and asks BGG only
for the items that are missing, and only if there is a token. Each batch is stored
as it arrives, so a failure part way loses nothing and the retry asks only for
the rest. Items not stored and not loadable (no token, or the request failed) show
as a note ("N items are not loaded yet. Enter an API token to load them."), and
entering the token loads the open entry by itself. Consequences to know about:
- **Items without a cover are kept like any other. Decided: yes.** An expansion that
  had no cover when first loaded keeps the default image for good, even if BGG adds
  a cover later. In live data about 12% of the newest items had none (24 of 200).
  If this is ever reversed, it is a three-line change: do not store items that fall
  back to the default image, so opening the entry with a token retries just those.
- **An id BGG does not return** (deleted or merged item) is never stored, so it is
  requested again each time the entry is opened with a token, and shows as "not
  loaded" without one. Not seen in practice: all 1,079 requested ids came back.
- **Size:** roughly 200 KB per thousand items (estimate from typical name and
  cover URL lengths), against about 5 MB of localStorage. If storage is full or
  unreadable the entry still opens; it is just not kept. Two tabs saving at the
  same moment can overwrite each other's batch (last writer wins); the next open
  loads what is missing.
- There is no way to refresh a stored item short of deleting
  `expcheck:expansions:v1` in DevTools.

### 1.4 Base-game-only lookups. Decided: no.
Lookups stay for every owned item, including expansions. Skipping owned expansions
would halve a cold run (7 requests instead of 14) but would lose the 35 first-run
items that are only reachable through an owned expansion (promo cards,
accessories, "Keyflower: Pig Shelter", ...), and those are wanted.

### 1.5 BGG rate limits. Measured and handled
Measured on 2026-11-05 with the test account (one IP, one token), using the app's
real request shape (20 ids per request):
- **BGG does not report its limits.** No `X-RateLimit-*` or `Retry-After` headers on
  200 or 429 responses. The official API page could not be read (HTTP 403 for
  automated fetches), so any documented numbers are unknown.
- **A limited request** gets HTTP 429 with `<error><message>Rate limit exceeded.</message></error>`.
  It carries `access-control-allow-origin: *`, so the browser can read the status
  and the existing 429 retry applies. Because there is no `Retry-After`, the
  `Retry-After` handling that used to be in `src/search.js` was removed.
- **Back-to-back, no pause** (about 2 requests/s): 28 requests in a row (two passes
  of this account's 14 batches) were fine; in two longer runs the 40th and the 38th
  request were rejected (39 and 37 had succeeded, in 24 s and 17 s).
- **Recovery is fast:** a probe 2 s after a 429 succeeded (an earlier run only
  showed "under 43 s").
- **Paced, 1 s pause** (about 0.7 requests/s, 40 per minute on average): 56 requests
  in 84 s, no 429; the busiest 60 s held 41 requests. So it is not a plain "40 per
  minute" rule. It behaves like a burst allowance of roughly 35-40 requests plus a
  sustained rate of at least 40 per minute. The exact rule is unknown, and runs
  longer than about 90 s were not tried.
- **Largest `thing` request: 20 ids** (21 gives `HTTP 400 "Cannot load more than 20
  items"`), so `BATCH_SIZE = 20` is already the maximum.

**Implemented: burst, then pace.** Requests go out back to back while fewer than 20
were made in the last 60 s (`BURST_REQUESTS`, `BURST_WINDOW_MS` in
`src/search.js`); beyond that each request first waits 1 s (`PACED_DELAY_MS`). The
allowance is shared by every lookup on the page (a fetch and a history view count
together), and retries and 202 polls count too. The old fixed 1 s pause between
batches and the `Retry-After` code are gone; the 2/4/8/16 s backoff stays, since it
matches the observed ~2 s recovery.
**Confirmed live (2026-11-05, the real `search.js` with real axios):** a normal
fetch (collection plus 14 batches, 15 requests) ran with no waiting in 23 s, all
200. Opening the first-run entry (1,079 items; it was 1,101 on 2026-11-03, so the
account's data changed in between, not investigated) took 54 requests in 105 s,
all 200, with zero 429s; the busiest 24 s window held 21 requests (the limit
tripped around 37-39) and the busiest 60 s window 34. BGG accepts the `&_=`
parameter from 2.5. Still unknown: behaviour under much longer sustained loads.

### 1.6 Local history without a token. Decided: shown; the token is optional.
First decided the other way (history only with a token), then reversed: the token
is optional. With a username and no token the history list is shown and entries
open from storage. The fetch button is always visible, but greyed out
(`disabled` class, grey background, `cursor: not-allowed`, `role="button"`,
`aria-disabled`) and inert until both a username and a token are set; its text says
what is missing ("Enter an API token to fetch updates", or "Enter a username to
fetch updates"). It becomes active when the token is entered (the field is read on
blur or Enter), and goes back to disabled if the token is cleared. A token of only
spaces is no token (the token is trimmed, 2.4). The API Token label says it is
optional. Verified in the real components, including that clicking the disabled
button sends nothing. Also verified in headless Chrome (real mouse click, real
typing): the button was greyed out (class `disabled`, background rgb(224, 225, 226),
opacity 0.45, cursor not-allowed), a click sent no request, and it turned green once
the token was typed and Enter pressed (screenshots checked).

---

## 2. Unresolved logic bugs

### 2.1 An unknown username counted as success. Fixed.
BGG answers an unknown user with HTTP 200 and an `<errors>` body, which the app
used to treat as an empty but successful collection ("Expansions updated" plus an
empty history entry). `parseXml` in `src/search.js` now rejects an `<errors>`/`<error>`
root (using BGG's own message), a `<parsererror>`, and any root other than `<items>`;
`search()` rejects a collection with no items. The status line shows the reason,
for example "Failed to fetch updates: Invalid username specified. Try again...", and
nothing is recorded. Other failures (401, network, ...) keep the generic text.
Remaining caveat: a valid user with a genuinely empty collection also gets the
"No items found in this collection" failure.

### 2.2 Back-links from owned items to their originals/base games: not a bug
Originally flagged as false positives (12 of 1,101 first-run items on the test
account were reachable only via `inbound="true"` links). Decided to keep them: the
originals of owned reimplementations and the base games of owned expansions are
associated items the user wants listed. A comment on `readExpansionLinks` says so.

### 2.3 Sort of the history list relied on engine behaviour. Fixed, still newest first. [verified in V8 and JavaScriptCore]
`getHistory` in `src/storage.js` called `Date(a)` without `new`, so its comparator
always returned -1. That does not sort by date: it reverses the insertion order,
which looked right only because entries are always added chronologically. Tested
with a shuffled input, the old code returned the shuffled order in both V8 and
JavaScriptCore (and got only 1 of 120 insertion orders right); a merge-sort engine
such as Firefox's would have kept the insertion order (oldest first).
**Fixed:** entries are now sorted by `Date.parse(key)`, newest first. The key format
is unchanged, so existing histories need no migration and users see the same order
as before. The language guarantees that `Date.parse` reads back the output of
`Date.prototype.toString()` in every engine, and the comparator ignores the time
zone name, so keys written in different time zones and across a year boundary are
ordered by real time. A key that cannot be read counts as the oldest; ties keep the
latest-added entry first.
Tested in V8 (Jest, real lowdb, and the rendered list) and JavaScriptCore; Firefox
is not installed here, so it rests on that language guarantee only. Note that V8
and JavaScriptCore read some junk such as `"junk-1"` as a year-2001 date; real keys
are never junk, and such a key would simply sort as very old.

### 2.4 Smaller leftovers. All fixed or decided
- The token was not trimmed. **Fixed:** `setToken` in `src/index.js` now trims it,
  as `setUser` does for the username. A padded token (a pasted stray space) used to
  make requests fail, and one made only of spaces counted as a token (the history
  and the fetch button appeared, against 1.6). Verified in the real components:
  a spaces-only token shows nothing; a padded token is sent trimmed
  (`Bearer tok-123`) on the collection, `thing` and history-view requests; a padded
  token saved raw by an earlier session works after a reload. The input box still
  shows what was typed and localStorage keeps the raw text; it is trimmed when read.
- Thumbnails. **Fixed:** `readDetails` in `src/search.js` trims the thumbnail text and
  treats a missing, empty or blank `<thumbnail>` as "no cover yet" (default image).
  Live data (2026-11-05): of the 200 newest of the first-run items, 174 had a clean
  URL, 24 had no `<thumbnail>` element and 2 had an empty `<thumbnail/>` (which used
  to become an empty, broken image source). None was padded with whitespace, so
  trimming is only defensive. All 274 owned items had clean URLs. The fallback image
  URL still returns a JPEG (HTTP 200).
- Stale open entry. **Fixed:** `SearchHeaders` is keyed by the lower-cased username in
  `src/index.js`, so a different account gets a fresh list: no open entry, no late
  result from the previous account's lookup, and no stuck "Fetching" lock. It was
  more visible than first described: opening an entry, switching account and
  switching back showed the old entry open again (verified; the test fails without
  the key). "Foo" and "foo" are the same account, so changing the letter case keeps
  the entry open.
- History keys are `new Date().toString()`: one-second resolution, locale and
  timezone dependent. Two entries in the same second used to overwrite each other,
  losing the first entry's ids (and, since `seen` is rebuilt from the history,
  reporting them as new again). **Fixed:** `updateHistory` in `src/storage.js` now
  merges into an existing entry for that second (de-duplicated, ascending numeric
  order). The key format itself is unchanged. Changing it (ISO strings, say) is
  optional now that the sort reads the dates properly (2.3), but it would change
  the header text users see, and the same-second merge relies on whole-second keys.
  **Decided:** keep the format. The header shows the raw `Date.toString()` text; a
  friendlier display (for example `toLocaleString()` in the header only, keeping the
  key) is possible polish, not done.
- Which account is fetching. **Fixed:** the status line says "Fetching new data for
  <username>" and keeps saying so if you switch to another account while it runs
  (the fetch button stays disabled until it finishes, as before).
- Collapsing. **Fixed:** clicking the open entry closes it. Since the loaded details
  are now kept (1.3a), opening it again needs no request.
- Empty fetch results still create a history entry. **Decided:** keep (see "Decided").

### 2.5 Browsers reuse `thing` responses for an hour. Fixed. [confirmed live, headless Chrome]
BGG sends `Cache-Control: s-maxage=0, max-age=3600` (plus an `ETag`) on `thing`
responses, and Chrome honours it for script-made requests that carry an
`Authorization` header. In a test with a local proxy that counted the requests
reaching BGG, the second identical `thing` XHR never left the browser, while the
same URL with an extra `&_=<timestamp>` parameter, and a `fetch` with
`cache: "no-store"`, did reach BGG. Every fetch asks for the same batch URLs (same
ids in the same order), so for up to an hour the app can show the old list of links
for a game and a newly linked item will not appear. That contradicts decision 1.3
even though the app itself caches nothing. The collection response has no cache
headers and is not affected. Other browsers were not tested; the same header is
expected to apply. The history view's `thing` calls have the same problem (stale
names and covers for up to an hour).
- **Fixed:** `lookupItems` appends `&_=<Date.now()>` to every `thing` request. BGG
  ignores the parameter (the live runs show it accepted), and the URL now differs on
  every fetch, so the browser cannot answer from its own cache. Alternatives: axios'
  fetch adapter with `cache: "no-store"` (not verified here); a `Cache-Control:
  no-cache` request header is impossible because BGG's CORS preflight only allows
  `Authorization`. If BGG ever rejects unknown parameters this fails loudly (a 400)
  instead of silently showing stale data.
- **Side effect:** the browser stores every response under a one-off URL (about
  2.5 MB per fetch on the test account) that is never reused; it evicts old entries
  on its own.
- **Browser check of the built app: done** (2026-11-05, a visible Chrome 156 window
  driven through the DevTools protocol with real mouse and keyboard input, against the
  live API, with the browser's own, unmodified user agent). 32 checks, all passed:
  the disabled and enabled button (1.6); a real fetch (1 collection and 14 `thing`
  requests, all 200, every `thing` URL with the `&_=` parameter, 1,079 items saved);
  a second fetch straight away, whose 14 requests all reached BGG with new URLs and
  none was served from Chrome's cache (this is the cache-buster working, 2.5); opening
  the first-run entry (54 requests, all 200, 1,079 items shown and stored, no broken or
  empty image, 110 items showing the default cover); a page reload followed by opening,
  closing and reopening that entry with **zero** requests to BGG, with the token
  present; no-token browsing, where a fully stored entry opens with no request and an
  entry with never-loaded items shows the "3 items are not loaded yet" note and sends
  nothing; then entering the token, which loaded the open entry by itself with exactly
  one request (ids 1,2,3), after which it opened from storage with none. No HTTP 429
  and no network failure in about 85 requests, and no JavaScript error or console
  error in the whole session. Screenshots were checked (the token field was masked
  before every capture).
- **Why an earlier attempt failed (headless Chrome).** Chrome announces itself as
  `HeadlessChrome`, and Cloudflare answers the CORS preflight of such a browser with a
  403 HTML page (Chrome reports `PreflightMissingAllowOriginHeader`). With a normal
  user agent the same page got 204 on the preflight, 200 on `thing` and 200 on the
  3.8 MB collection. BGG's preflight echoes any origin (checked for two localhost
  ports, 127.0.0.1, example.com and a github.io origin). Real users' browsers are not
  affected. A user-agent override for the headless run was not permitted, so the final
  run used a visible window instead.
- **Not covered:** Firefox and Safari (only Chrome was driven), and a deployed origin
  other than localhost.

---

## 3. Security. Done (3.7 leaves an optional Vite migration)

The app has no XSS surface (React escapes everything, no `dangerouslySetInnerHTML`,
`DOMParser` does not run scripts), the token only goes to `boardgamegeek.com` over
HTTPS, and no secrets are in the working tree or git history (scanned). The hardening
below was done on 2026-11-05 and tested in a real browser, not just in jsdom.

### 3.1 Stylesheet integrity (SRI). Fixed.
`public/index.html`: the Semantic UI stylesheet (pinned to 2.4.1 on cdnjs) now has
`integrity="sha512-8bHTC73g..."` and `crossorigin="anonymous"`. The hash was computed
from the file as served and equals the one cdnjs itself publishes for it
(`api.cdnjs.com/libraries/semantic-ui/2.4.1?fields=sri`); cdnjs sends
`access-control-allow-origin: *`, which SRI needs. Checked in Chrome: with one
character of the hash changed the browser refuses the stylesheet ("Failed to find a
valid digest"), so it is enforced, not decorative.
Not covered, because a hash cannot be: that stylesheet `@import`s the Lato font CSS
from Google Fonts, and the font files come from `fonts.gstatic.com` and cdnjs.
**Decided:** keep the CDN with SRI. Self-hosting (vendoring about 600 KB of CSS and
the font files, and editing out the Google import) would remove the dependence on
three third-party hosts; it is possible later.

### 3.2 Content Security Policy. Fixed.
A `<meta http-equiv="Content-Security-Policy">` in `public/index.html` (a static page
has no server to send a header): `default-src 'self'; script-src 'self'; style-src
'self' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src
https://cdnjs.cloudflare.com https://fonts.gstatic.com data:; img-src 'self'
https://cf.geekdo-images.com data:; connect-src 'self' https://boardgamegeek.com;
object-src 'none'; base-uri 'self'; form-action 'self'`. There is no
`'unsafe-inline'`: React sets styles through the CSSOM, which a CSP allows.
- **The suggested policy in the old plan was too tight.** It lacked Google Fonts, and
  Semantic UI embeds icon fonts as `data:` URIs. This showed up as console violations
  in the first test run, which my own check missed at first: I had truncated each
  message before matching, and the long base64 swallowed the words I was looking for.
- **Production build and dev server, both under the policy** (headless Chrome, 18
  checks each): the page renders, the SRI stylesheet and the Lato font load, no
  request is blocked, no violation, a clean console, and the page contacts only the
  allowed hosts. The dev server's hot-reload WebSocket connects and receives data.
- **Negative controls, so the policy is known to bite:** a script from another host,
  a request to another host, an image from another host and `eval` are all blocked;
  a style attribute written in HTML is blocked while styles set by script (how React
  does it) work.
- **Live, with the real covers:** a full run opened the 54-request entry and all 1,079
  cover images loaded under the policy (none broken), so `cf.geekdo-images.com`
  covers everything seen.
- **Limits:** `frame-ancestors` and `report-uri` cannot be set from a meta tag
  (clickjacking protection would need a header from the hosting). If BGG ever moves its
  cover images to another host, covers will stop showing until that host is added
  here. Anything inline added to the page later will be blocked.

### 3.3 Referrer policy. Fixed.
`<meta name="referrer" content="no-referrer">`. Verified in Chrome: requests to
BGG (the 15 requests of a live fetch were checked), cdnjs and Google carry no `Referer`; the one exception
is that the font files get Google's own stylesheet origin (`fonts.googleapis.com`) as
their referrer, which says nothing about this page. The cover images load fine
without a referrer (no hotlink protection in the way).

### 3.4 Token field. Fixed.
`src/ApiBox.js`: `type="password"`, `autoComplete="off"`, spell-check off. The token
is used and saved only when the field is left or Enter is pressed (not on every
keystroke), and only the trimmed value is stored; an empty one removes the saved
value. Verified in the real components and in Chrome (typing alone saves nothing and
leaves the button disabled; Enter saves and enables it; the browser masks the text).
Remaining, accepted: the token is still kept in plaintext in localStorage, so any
script on the page could read it (the CSP is what limits that); a password manager may
offer to save it (cannot be observed from the automation, unverified); closing the
tab before leaving the field loses what was typed, by design.

### 3.5 Result links. Fixed.
`src/SearchResults.js`: each result is a real `<a href target="_blank"
rel="noopener noreferrer">` instead of a `div` that called `window.open`. It can be
reached with the keyboard (Tab), opened with the middle button, and the new page
cannot reach back into this one. Only a plain numeric id from BGG's response becomes a
link (ids such as `12/../x` or `javascript:...` are shown but not clickable). Verified
with a real click in Chrome: it opened `boardgamegeek.com/boardgame/294` in a new tab
that reports `canAccessOpener: false`.

### 3.6 axios. Fixed (a new finding from `npm audit`).
`npm audit` works now (it did not at the start of the review). The one advisory that
is in the shipped browser bundle was axios 1.12.2, with about thirty advisories (many
rated high): mostly Node-only proxy code, plus prototype-pollution gadgets that can
hijack requests or leak credentials if anything ever pollutes `Object.prototype`. The
app sends the token through axios, so it was updated to 1.21.0 (inside the existing
`^1.x` range; every advisory is fixed at or below 1.20). The shipped bundle (react,
react-dom, scheduler, axios, lowdb, @babel/runtime, read from the source map) now has
no flagged package, the bundle grew from 78.5 to 85.9 kB, and the real-browser runs
above used the new axios. The lockfile also shows unrelated churn: npm re-resolved
the optional `typescript` peer dependency (5.9.3 to 4.9.5) and dropped a nested
`yaml`; the project has no TypeScript, so it is harmless.

### 3.7 Toolchain (`react-scripts@5.0.1`, deprecated). Done: moved to `devDependencies`. A Vite migration stays optional.
After the axios update `npm audit` reported 67 advisories (18 low, 13 moderate, 33 high,
3 critical). All are in build tooling (the `react-scripts` dev-server stack:
`proxy-addr`, `shell-quote`, `websocket-driver` and others); none ships to users. It
only looked alarming because `react-scripts` was listed under `dependencies`, so
`npm audit` counted it as production.
**Done:** `react-scripts` is now under `devDependencies` in `package.json`, and the
lockfile was synced with `npm install --package-lock-only`. No package version
changed; 1,296 of its 1,328 packages are now marked dev-only; the five that ship
(axios, lowdb, react, react-dom and their dependencies) are not.
- `npm audit --omit=dev` (what ships): **0 vulnerabilities**, 33 production packages.
  `npm audit` with everything still reports the same 67, now correctly all in dev
  tooling.
- The build compiles, and its output is identical to before (same file hash). A clean
  `npm ci` in a scratch copy installs and builds with that same output, which also
  shows the lockfile and `package.json` agree.
**Caveat: a host that installs without dev dependencies.** If the deploy build sets
`NODE_ENV=production` before `npm ci` or `npm install`, npm skips `devDependencies`
(reproduced: 32 packages installed, no `react-scripts`) and the build step fails.
Fix, verified: install with `npm ci --include=dev`, after which the build compiles.
Many CI and hosting services install dev dependencies by default, but nothing in the
repo says how this project is deployed, so this is unverified for your host. (In my
shell the failure showed as an ESLint config error instead of "react-scripts: not
found", because my `PATH` includes this project's own `node_modules/.bin`; the result
is the same, a failed build.)
**Still optional, not planned now: migrate to Vite.** It would remove the
unmaintained toolchain and the 67 dev-tooling advisories. Work: rename `.js` files that
contain JSX to `.jsx`, move `index.html` to the project root and replace
`%PUBLIC_URL%`, replace `react-scripts test` with Vitest, check the `lowdb/browser`
import and the `REACT_APP_` env prefix (unused). The CSP, SRI and referrer tags carry
over unchanged. Moderate effort, moderate risk.

---

## 4. Performance (remaining)

- **Every fetch is a full run (no caching, 1.3):** the 274 owned items take 14
  requests and 2.5 MB; measured live, a whole fetch (collection plus 14 batches)
  takes about 23 s with no waiting. Larger collections scale linearly (pacing starts
  after about 20 requests in a minute), and a failure partway means starting over.
  Consider showing progress ("batch 3 of 14") so it does not look stuck.
- **Opening a very large history entry, the first time:** the 1,079-item first run
  costs 54 `thing` requests, about 105 s live when it starts after a quiet minute
  (the first 20 back to back, then 1 s pauses), before anything is shown, because the
  whole entry is shown at once. In the browser test it took 151 s: it started right
  after two fetches, so the burst allowance was already used and all 54 requests were
  paced, and each request also carried its own CORS preflight (section 0). That
  now happens once per item (1.3a); later opens, also after a reload, are instant,
  and a failure part way keeps the batches that arrived. Still possible to cut the
  first wait: render names as each batch arrives, or page the entry (for example
  100 at a time).
- **Multiple tabs:** history is last-writer-wins; harmless but real.
- **Micro:** `getDb` in `src/storage.js` calls `db.read()` although
  `LocalStoragePreset` already reads (confirmed in lowdb 7.0.1; `package.json` allows
  `^7.0.0`), so JSON is parsed twice per call. Left alone because removing it relies
  on the preset's behaviour in every 7.x version.

---

## 5. Tests (none in the repo)

All verification so far was done with throwaway scripts and a temporary Jest file
that were deleted afterwards. Worth turning into a real suite:

- `search.js` with mocked axios: a 202 sequence ending in 200 on the last attempt;
  401/404 are not retried; 429/5xx back off 2/4/8/16 s and stop; network error is
  bounded; a throwing callback does not restart the search; duplicate/own+preordered
  ids are looked up once; username is trimmed and encoded.
- No caching (1.3): a newly linked item is reported by the very next fetch; every
  fetch and every history view re-requests everything; nothing but the history
  is written to localStorage; batches are 20 ids; every `thing` URL carries a
  different `&_=` value and the collection URL has none; details come back in
  request order and an item without a thumbnail gets the default image.
- Pacing (1.5), with a fake clock and a fixed simulated latency: a 15-request fetch
  never waits; a 56-request lookup waits 1 s before each request after the 20th;
  two fetches back to back wait for the 10 requests beyond the allowance; a minute
  of quiet restores it; retries and 202 polls count; a `Retry-After` header is
  ignored (first retry waits 2 s); two simultaneous lookups both finish.
- `storage.js`: legacy-key migration (case-insensitive, original left in place);
  users named `USERNAME` / `API_TOKEN` do not collide or crash; non-JSON values are ignored;
  two `updateHistory` calls in the same second merge (use Jest modern fake timers
  to freeze the clock), an empty update does not wipe an entry, entries from
  different seconds stay separate and `getHistory` stays newest-first. For 2.3:
  entries stored out of order (a seeded shuffle) still come back by date; keys in
  different time zones and across a year boundary; an unreadable key sorts last;
  and the rendered list in the UI is newest first. Run the sort source in
  JavaScriptCore too (`jsc`), and in Firefox if it is ever available.
- 2.4: thumbnails (missing, empty, blank, padded, clean, several elements) and the
  `<img>` sources in the UI; opening an entry, closing it (no request) and reopening
  it (a new request); switching account clears the open entry and switching back
  does not restore it; a lookup that finishes after the account changed does not
  appear under the new account or leave it locked; "Alice" to "alice" keeps the
  entry open; the status line names the account, also after switching away; the
  token is trimmed.
- Kept details and the optional token (1.3a, 1.6): with no token the history is
  listed and a fully stored entry opens with no request; an entry with missing items
  shows the "not loaded" note and sends nothing; clicking the disabled fetch button
  sends nothing (check `disabled` class, `aria-disabled`, `cursor`, the text); adding
  the token enables the button and loads the open entry by itself with
  `Bearer <token>`; a loaded entry is not requested again after closing and
  reopening or after a full reload (fresh module registry, same storage), also with a
  token; only missing items are requested and the entry's order is kept; a failure on
  the third batch keeps the first two and the retry asks only for the rest; full
  storage (`setItem` throwing) and a corrupt or malformed store do not break opening;
  an item without a cover is kept; no username disables the button too; a fetch still
  runs end to end. Remove the persistence hook (`storage.saveDetails` in
  `loadEntry`) and the tests for reload, partial and resume must fail.
- Browser end to end (scenario S1 to S6, results in 2.5), driven through the Chrome
  DevTools protocol with Node's built-in WebSocket (no extra packages): serve the
  build, launch Chrome with remote debugging, real mouse and keyboard input, count
  requests to boardgamegeek.com from `Network.requestWillBeSent`, mask the token
  field before any screenshot. It ran once (about 4 minutes, 85 requests to BGG) and
  its script was throwaway; keeping it would need a token. Use a visible Chrome
  window: headless Chrome's `HeadlessChrome` user agent gets a 403 from Cloudflare on
  the CORS preflight, and a user-agent override was not permitted.
  The script has since gained checks for section 3 (password field and when it saves,
  no Referer to BGG, result links, a real click opening a no-opener tab, no CSP or
  integrity violation). A quick mode (45 real ids instead of the 1,079-item entry)
  runs in about 45 s and 19 requests. Two lessons for whoever rebuilds it: close any
  tab the test opens and re-activate the app's own tab, because a hidden tab does
  not process clicks; and validate every expression sent into the page, because a
  regex inside a template string silently lost its backslashes.
- Security (section 3): the CSP, SRI and referrer checks run on the production build
  and on the dev server in Chrome, with negative controls (foreign script, fetch,
  image, `eval`, an HTML style attribute, and a wrong integrity hash must all be
  refused). In Jest: the token field's type and attributes, nothing saved while
  typing, saved trimmed on blur and on submit, removed when emptied, storage that
  refuses writes, and the result links (attributes, keyboard focus, non-numeric ids
  never linked, `window.open` never called).
- `index.js`: results are saved under the account the fetch started for even if
  the username changes mid-fetch; the status message is not reset mid-fetch; a
  failed history load releases the lock and can be retried.
- A guard for the decision in 2.2: an owned expansion's `inbound="true"` link to a
  base game that is *not* in the collection **is** reported, and so is the original
  of an owned reimplementation. Use fixtures taken from real responses (an
  expansion with `inbound="true"`, a reimplementation, an item with no thumbnail).
- 2.1: the real `Invalid username specified` body, an empty `<items>`, an
  ill-formed and a well-formed HTML page, a JSON/empty/undefined body, an `<errors>`
  body from the `thing` endpoint, the 200-character cap on
  messages, and the UI text (message shown; no history entry; generic text for 401).

Setup notes: `lowdb` 7 is ESM-only and Jest 27 (via react-scripts) cannot resolve
its `exports`, so the temporary run used
`--transformIgnorePatterns "node_modules/(?!lowdb)"` and
`--moduleNameMapper '{"^lowdb/browser$":"<rootDir>/node_modules/lowdb/lib/browser.js"}'`.
Mock `axios` with a factory (`jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn() } }))`)
because axios 1.x is also ESM. If the project moves to Vite, use Vitest instead.

---

## 6. Housekeeping

- **All fixes are uncommitted**: `src/ApiBox.js`, `src/index.js`, `src/search.js`,
  `src/SearchHeaders.js`, `src/SearchResults.js`, `src/storage.js`,
  `public/index.html`, `package.json` and `package-lock.json` (axios) are modified;
  this file is new. Review the diff and commit. The lockfile diff includes the
  unrelated `typescript` and `yaml` churn described in 3.6.
- If the app was run locally while a lookup cache existed, the browser may still
  hold two leftover localStorage keys, `expcheck:links:v1` and
  `expcheck:details:v1` (nothing reads them any more). Delete them in DevTools.
- `.idea/.gitignore` is staged for commit (an IDE file). Decide whether to keep it
  or add `.idea/` to `.gitignore`.
- When the browser cannot reach BGG at all (a blocked CORS preflight as seen in 2.5,
  or no network) the request fails without a response, is retried 4 times (2+4+8+16
  s) and the user sees only the generic "Failed to fetch updates. Try again..."
  after about 30 s. A clearer message ("could not reach BoardGameGeek") would
  help; not done.
- `README.md` is still Create React App boilerplate. It should say how the app
  works: the API token (a BGG application token, entered in the "API Token" box,
  kept in localStorage) is optional and only needed to fetch updates and to load
  history items that are not stored yet; what is kept in localStorage (`USERNAME`,
  `API_TOKEN`, `history:<user>` and `expcheck:expansions:v1`); and that nothing is
  sent anywhere except to boardgamegeek.com. It should also say that `react-scripts`
  is a dev dependency, so a deploy build has to install dev dependencies (use
  `npm ci --include=dev` if the host sets `NODE_ENV=production`; see 3.7).

---

## Status: done since the review (for reference)

Retry loop bounded with backoff and no retry of 4xx; results saved under the account
that started the fetch; last attempt's valid response no longer discarded; callback
errors no longer restart the search; duplicate ids, stale name, username
trim/encode, namespaced case-insensitive localStorage keys with migration,
status-message and lock fixes in the UI; burst-then-pace request pacing, a
cache-busting parameter on `thing` requests (2.5), `Set`-based filtering; an unknown username, an empty
collection and non-BGG responses now fail with a clear message instead of a false
success (2.1); two history updates within the same second are merged instead of
the second overwriting the first (2.4); the history list is sorted by the real dates
(newest first) instead of by accident of the engine (2.3); the token is trimmed, so
a padded or spaces-only token behaves correctly; empty thumbnails fall back to the
default image; an account switch gives a clean history list; the status line names
the account being fetched; an open history entry can be closed (all 2.4); history
details are kept once loaded and the token is optional, with a disabled fetch
button until it is given (1.3a, 1.6); security hardening: SRI, CSP, referrer policy,
password token field saved on leave, real result links, axios 1.21.0, `react-scripts`
moved to `devDependencies` so the production audit is clean (section 3).

## Decided, deliberately left as-is

- **Scope of "associated items":** everything BGG links to the owned games as an
  expansion, accessory, reimplementation or integration, in both directions, so
  originals and base games are included. No `inbound` filtering, no per-type filter.
- **First run:** lists everything. It is both the baseline and a check for items
  the user missed.
- **Lookups for every owned item**, including owned expansions (no base-game-only
  shortcut).
- **No caching of discovery:** new items must show up on the very next fetch (see
  1.3). This also depends on 2.5, because the browser itself caches `thing`
  responses; the cache-busting parameter is what makes it hold.
- **History details are kept for good** once loaded, also across reloads, including
  items that had no cover yet (see 1.3a for the caveats).
- **Pacing:** burst then pace (20 requests free per minute, then 1 s apart), no
  `Retry-After` handling because BGG does not send it (see 1.5).
- **History order:** newest first (see 2.3, which now sorts by the real dates).
- **Security:** CDN plus SRI rather than self-hosting; the CSP is a meta tag without
  `'unsafe-inline'`; the token stays in localStorage in plaintext (see 3.4);
  `react-scripts` moved to `devDependencies`, a Vite migration is optional and not
  planned (3.7).
- **The token is optional:** the local history is shown and browsable with a
  username alone; the fetch button is visible but disabled until a token is set
  (see 1.6). This replaces the earlier decision that history needs a token.
- **Empty history entries:** a fetch that finds nothing still records an entry.
  It acts as a "last checked" marker; change it only if it clutters the list.
