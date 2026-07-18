# API Discovery Report — VRBO Property Listings Scraper

## Selected API

- **Endpoint:** `https://www.vrbo.com/graphql`
- **Method:** `POST`
- **Auth:** None (cookies from warmup HTTP GET + required headers)
- **Pagination:** `variables.criteria.secondary.counts` with `resultsStartingIndex` offset. Page 0 returns 50 results, subsequent pages increment offset by 50.
- **Primary operation:** `DeferredSearchResults`
- **Persisted query hash:** `79d7f75261d4b71439afdd482c474ae0274c2ae9cc0e575cc1fccb54374cb7f6`
- **Fields available:** property id, title, listing URL, room/property summary, featured location text, review score, review label, review count, cancellation text, nightly price, total stay price, gallery images, badges, search metadata
- **Fields currently missing in prior actor output:** image URL, image count, property type, sleeps, price qualifier, total price, cancellation details, review label, richer listing URL data
- **Field count:** 15+ useful listing fields after cleanup

## Header Profile

### Warmup (GET vrbo.com/search)
```
user-agent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1
accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
accept-language: en-US,en;q=0.9
sec-fetch-site: none
sec-fetch-mode: navigate
sec-fetch-user: ?1
sec-fetch-dest: document
accept-encoding: gzip, deflate, br
```

### GraphQL (POST vrbo.com/graphql)
```
accept: multipart/mixed;deferSpec=20220824,application/json
content-type: application/json
origin: https://www.vrbo.com
referer: <search-page-url>
accept-language: en-US,en;q=0.9
user-agent: Mozilla/5.0 (iPhone; ...) Safari/604.1
client-info: shopping-pwa,<hash>,us-east-1
x-page-id: page.Hotel-Search,H,20
x-parent-brand-id: vrbo (or expedia)
x-product-line: lodging
ctx-view-id: <random-uuid>
cookie: <from-warmup>
```

## Why This API Was Selected

- VRBO search page loads data from `vrbo.com/graphql` via `DeferredSearchResults` persisted query.
- iOS Safari User-Agent passes Akamai checks; desktop Chrome gets 429/Akamai blocked.
- Warmup via HTTP GET (no Playwright needed) establishes Akamai cookies (bm_sz, tpid, etc.).
- GraphQL POST with same cookies + iOS Safari headers returns multipart JSON with full listing cards.
- Pagination via offset in `resultsStartingIndex` count field.
- The actor can stay fully HTTP-based (impit) — no Playwright needed.

## Rejected Candidates

| Candidate | Header Profile | Status/Body | Fields | Pagination | Decision |
|-----------|---------------|-------------|--------|------------|----------|
| VRBO GraphQL (Desktop Chrome) | Desktop Chrome UA | 429/Akamai | — | — | Rejected |
| Expedia GraphQL (iOS Safari) | iOS Safari headers | 429 rate-limited | — | — | Rejected |
| HTML/JSON-LD parsing | — | Only 2 JSON-LD blocks | 0 review fields | None | Rejected |
| Playwright full browser | Firefox | Works but heavy | 15 fields | Offset | Fallback only |

## Implementation Notes

- **Warmup:** Fetch property page with iOS Safari headers to get Akamai cookies before GraphQL calls.
- **Device type:** Always use `DESKTOP` in GraphQL context — `MOBILE` causes validation error.
- **User-Agent:** iOS Safari UA passes Akamai checks; desktop Chrome gets blocked.
- **Session:** Reuse same proxy session for warmup + GraphQL to maintain cookie consistency.
- **Rate limiting:** VRBO GraphQL tolerates requests at 2-5s intervals.
- **Pagination:** Page 0 returns 50 listings. Increment `resultsStartingIndex` by 50 for subsequent pages.
- **Cookies:** Extracted from `Set-Cookie` response headers after warmup GET.
- **HTTP client:** `impit` with `browser: 'chrome'` for TLS fingerprint matching + custom iOS Safari headers.
- **No Playwright needed:** Fully HTTP-based with impit. Browser-free.
