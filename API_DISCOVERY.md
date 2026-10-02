# API Discovery Report — VRBO Property Listings Scraper

## Selected API

- **Endpoint:** `https://www.vrbo.com/graphql`
- **Method:** `POST`
- **Auth:** None. A random UUID `duaid` is sufficient; cookies are not required.
- **Pagination:** `variables.criteria.secondary.counts` with `resultsStartingIndex` offset. Page 0 returns 50 results, subsequent pages increment offset by 50.
- **Primary operation:** `DeferredSearchResults`
- **Persisted query hash:** `79d7f75261d4b71439afdd482c474ae0274c2ae9cc0e575cc1fccb54374cb7f6`
- **Fields available:** property id, title, listing URL, room/property summary, featured location text, review score, review label, review count, cancellation text, nightly price, total stay price, gallery images, badges, search metadata
- **Fields currently missing in prior actor output:** image URL, image count, property type, sleeps, price qualifier, total price, cancellation details, review label, richer listing URL data
- **Field count:** 15+ useful listing fields after cleanup

## Header Profile

### Warmup (GET vrbo.com/search) — no longer required
```
accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
accept-language: en-US,en;q=0.9
sec-fetch-site: none
sec-fetch-mode: navigate
sec-fetch-user: ?1
sec-fetch-dest: document
```
No manual `user-agent`. Impit generates a browser-consistent User-Agent and
fingerprint headers from `browser: 'chrome'`.

### GraphQL (POST vrbo.com/graphql)
```
accept: multipart/mixed;deferSpec=20220824,application/json
content-type: application/json
origin: https://www.vrbo.com
referer: <search-page-url>
accept-language: en-US,en;q=0.9
client-info: shopping-pwa,<hash>,us-east-1
x-page-id: page.Hotel-Search,H,20
x-parent-brand-id: vrbo (or expedia)
x-product-line: lodging
ctx-view-id: <random-uuid>
cookie: <from-warmup>
```
No manual `user-agent`. The `duaid` sent in `identity.duaid` must be a valid
UUID; an invalid or empty value makes the downstream search service fail with
`UUID string too large` / `Invalid UUID string`.

## Impit Browser Profile Matrix (measured)

Every profile below was tested against the same London search: warmup GET, then
`DeferredSearchResults` GraphQL, then a property page GET.

| Impit `browser` | Warmup GET | GraphQL | Property page | Decision |
|-----------------|-----------|---------|---------------|----------|
| `chrome` | 200 + Akamai cookies | 200, **listings returned** | 200 + Apollo state | **Selected** |
| `chrome131` | 200 + Akamai cookies | 200, `PersistedQueryNotFound` | 200 + Apollo state | Rejected |
| `chrome136` | 200 + Akamai cookies | 200, `PersistedQueryNotFound` | 200 + Apollo state | Rejected |
| `chrome142` | 200 + Akamai cookies | 200, `PersistedQueryNotFound` | 200 + Apollo state | Rejected |
| `chrome151` | 200 + Akamai cookies | 200, `PersistedQueryNotFound` | 200 + Apollo state | Rejected |
| `chrome116` | 429 `Bot or Not?` | — | 200 + Apollo state | Rejected |
| `chrome124` | 429 `Bot or Not?` | — | 200 + Apollo state | Rejected |
| `firefox` | 429 `Bot or Not?` | — | 200 + Apollo state | Rejected |
| `firefox128` | 429 `Bot or Not?` | — | 200 + Apollo state | Rejected |
| `firefox135` | 200 + Akamai cookies | 200, `PersistedQueryNotFound` | 200 + Apollo state | Rejected |
| `firefox144` | 200 + Akamai cookies | 429 | 200 + Apollo state | Rejected |
| `okhttp3` | 429 `Bot or Not?` | — | 200 + Apollo state | Rejected |
| `okhttp5` | 429 `Bot or Not?` | — | 200 + Apollo state | Rejected |
| `ios18` | 200 + Akamai cookies | 200, `PersistedQueryNotFound` | 200 + Apollo state | Rejected |

**Conclusion:** the generic `chrome` profile is the only one whose fingerprint the
`DeferredSearchResults` persisted-query gateway accepts. Versioned Chrome
profiles pass Akamai but get `PersistedQueryNotFound`; Firefox/OkHttp are blocked
at warmup. The property page is fingerprint-independent and works on every
profile. Keep `browser: 'chrome'` and never override its generated fingerprint
headers.

## Root Cause Of The Empty Runs

The previous implementation forced an iOS Safari `user-agent` header onto an
impit client whose TLS/HTTP fingerprint was Chrome (`browser: 'chrome'`). The
mismatch routed the GraphQL request to a gateway that responds
`{"errors":[{"message":"PersistedQueryNotFound"}]}` with HTTP 200. That body
parses to zero listing cards, so the actor finished "Succeeded" with 0 rows and
no error log.

Fix: do not override `user-agent`; let impit's `chrome` impersonation keep the
User-Agent, `sec-ch-ua*`, and TLS fingerprint consistent for both the warmup and
the GraphQL call. Verified locally: 30 listings from 35 cards, with review and
price fields populated, and offset pagination working at 0/50/100.

## Why This API Was Selected

- VRBO search page loads data from `vrbo.com/graphql` via `DeferredSearchResults` persisted query.
- Impit `chrome` impersonation passes Akamai checks; Firefox and OkHttp fingerprints get 429 `Bot or Not?`.
- Warmup via HTTP GET (no Playwright needed) establishes Akamai cookies (`_abck`, `bm_s`, `bm_sz`, `tpid`, `DUAID`).
- GraphQL POST with the same cookies and impit's Chrome fingerprint returns multipart JSON with full listing cards.
- Pagination via offset in `resultsStartingIndex` count field.
- The actor can stay fully HTTP-based (impit) — no Playwright needed.

## Secondary Source: Property Detail (listing) Page

- **Endpoint:** `GET https://www.vrbo.com/<property-slug>` (e.g. `/2595126`)
- **Method:** `GET`, impit `browser: 'chrome'`, no cookies required for the tested page
- **Data:** the HTML embeds `window.__APOLLO_STATE__ = JSON.parse("<escaped JSON>")`
- **Rich fields available:** title, property type, SEO description, full address (city/state/country), latitude/longitude, aggregate review score/label/count, nightly price, `amenities` (grouped lists), `highlights`, and the full gallery (100+ image URLs)
- **Parsing:** locate `window.__APOLLO_STATE__`, read the `JSON.parse("...")` string literal, unescape it, then JSON.parse the inner string
- **Key nodes:** `ROOT_QUERY.productHeadline`, `productRatingSummary`, `productHighlights`, `productGallery`, `propertyOffers`, and `PropertyInfo:<id>.summary.amenities(...)`
- **Cleaner subset:** `productHeadline.seoStructuredData` is a JSON string with schema.org `VacationRental` (name, address, aggregateRating, latitude, longitude, image, identifier)
- **Detection:** a URL path containing a numeric property slug (`/\\d{4,}`) is treated as a property page; everything else is a search target
- **Decision:** adopted as an additive mode. Search URLs keep returning result cards; property listing URLs return a rich detail record. No Playwright needed.

## Rejected Candidates

| Candidate | Client Profile | Status/Body | Fields | Pagination | Decision |
|-----------|---------------|-------------|--------|------------|----------|
| VRBO GraphQL | impit `chrome` | 200, multipart listings | 15+ | Offset | Selected |
| VRBO GraphQL | impit `ios18` | 200, `PersistedQueryNotFound` | — | — | Rejected |
| VRBO GraphQL | impit `firefox` / `okhttp5` | 429 `Bot or Not?` | — | — | Rejected |
| HTML/JSON-LD parsing | — | Page state has empty `propertySearchListings`; data fetched client-side | 0 | None | Rejected |
| Playwright full browser | Firefox | Works but heavy | 15 fields | Offset | Fallback only |

## Implementation Notes

- **Warmup:** Removed. The search page GET frequently timed out through the proxy (~40s wasted) and was not required — the GraphQL call succeeds with a random `duaid`. Dropping it makes runs finish in seconds instead of minutes.
- **Device type:** Always use `DESKTOP` in GraphQL context — `MOBILE` causes validation error.
- **User-Agent:** Leave it to impit's `browser: 'chrome'` impersonation. Do not override it; a mismatched UA causes `PersistedQueryNotFound`.
- **Session rotation:** Each GraphQL (and property) retry creates a fresh client with a new proxy session ID (internal budget `MAX_RETRIES = 8`). This escapes blocked/throttled exit IPs; observed 429/502 responses clear after one or two rotations. No user input is needed — page size (`RESULTS_SIZE = 50`) and retry budget are fixed internally.
- **Duaid:** Send a valid UUID in `identity.duaid`; invalid values fail downstream.
- **Rate limiting:** VRBO GraphQL tolerates requests at 2-5s intervals.
- **Pagination:** Page 0 returns up to 50 listings. Increment `resultsStartingIndex` by 50 for subsequent pages.
- **Streaming output:** each page's deduplicated rows (and each property-detail row) are pushed to the dataset as soon as they are mapped, not buffered until the end.
- **Quiet retries:** per-attempt retry/rotation messages are emitted at `debug` level only, so normal logs stay clean. A page that still fails after its attempts is retried at the page level (up to 3 times) before the actor moves on, so transient throttling does not truncate results.
- **Cookies:** Not required for the GraphQL search; the request is sent without a cookie header.
- **HTTP client:** `impit` with `browser: 'chrome'` for consistent TLS + browser fingerprint.
- **Proxy:** Use the Apify `UNBLOCKER` proxy group. During testing the shared `RESIDENTIAL` pool returned repeated 429/403 on the search page, while `UNBLOCKER` stayed stable. The property detail page also works without cookies.
- **No Playwright needed:** Fully HTTP-based with impit. Browser-free.

## Maximized Search-Card Extraction (no detail visits)

The `DeferredSearchResults` card contains far more than the original mapper used. The
actor now mines, per card, without any detail-page request:

- full gallery from `mediaSection.gallery.media[].media.url` (deduped)
- `bedrooms`, `beds`, `bed_type`, `bathrooms`, `sleeps` parsed from `headingSection.messages[0].text`
- `price_original` from `priceSummary.options[0].strikeOut.formatted` / `STRIKEOUT` line item
- `nights` parsed from the `"for N nights"` line item
- `badges` from `mediaSection.badges` (primary/secondary/tertiary) and `priceSection.badge`
- `free_cancellation`, `sponsored`, `search_position`, `guest_rating_source` from the embedded
  `analyticsEvents[].attribute.content` (`product_list`) JSON payload
- `review_theme` from `reviewSummary.graphic.badgeTheme`

Search totals: the summary lives under
`incremental[0].data.deferredListingSearchResults.summary`, not `data.propertySearch.summary`;
the actor searches the whole multipart payload for it and logs the total property count.

## Prior Art — How Other Projects Fetch VRBO Data

Reviewed the strongest public implementations. All converge on the same two
unauthenticated surfaces this actor already uses.

| Project | Method | Notable detail |
|---------|--------|----------------|
| `memo23/vrbo-scraper` (Apify) | impit + Apify Residential, Chrome TLS fingerprint, **per-session rotation ×3 before fallback**; `window.__APOLLO_STATE__` for property rows; `productReviewDetails` GraphQL for full paginated reviews; date-selector GraphQL for the availability calendar | Closest match to this actor's design. Confirms session rotation as the reliability fix. |
| `moving_beacon-owner1/vrbo-listing-scraper` (Apify) | `/graphql` search + `/api/v4/typeahead/` for regions | Documents the Akamai + Expedia edge quota that 429s datacenter IPs; recommends residential proxy and ~0.8s pacing. |
| `borski/travel-hacking-toolkit` | Patchright (undetected Playwright) headed via Xvfb, homepage warm-up + retry; 3-layer extraction (embedded state → `data-stid` cards → anchor) | Browser route; handles hard 429 and soft interstitials. Heavier than HTTP. |
| `Edioff/vrbo-scraper` | undetected-chromedriver, two-phase discovery + detail | Extracts `__PLUGIN_STATE__` and coordinates from meta tags. |
| `W3-Anjan/python-scrapy-vrbo`, `shulil-261/vrbo-extractor-4-0` | Scrapy / requests + embedded JSON | Older; search JSON response parsed directly. |

**Takeaways adopted:** impit Chrome fingerprint (not iOS), no manual UA override,
proxy rotation on failure, `window.__APOLLO_STATE__` for property detail, and the
search-card fields mined from `DeferredSearchResults`.

**Best option not yet implemented:** full review history via VRBO's
`productReviewDetails` GraphQL operation (iOS-app-style headers, 25 reviews/page).
The current actor returns review score/label/count from the search and property
pages, but not the individual review texts.
