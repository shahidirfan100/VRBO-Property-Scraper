## Selected API

- Endpoint: `https://www.vrbo.com/graphql`
- Method: `POST`
- Auth: No login required, but the search payload needs browser-established cookies and headers
- Pagination: `variables.criteria.secondary.counts[{ "id": "resultsStartingIndex" }]`
- Primary operation: `DeferredSearchResults`
- Persisted query hash: `79d7f75261d4b71439afdd482c474ae0274c2ae9cc0e575cc1fccb54374cb7f6`
- Fields available: property id, title, listing URL, room/property summary, featured location text, review score, review label, review count, cancellation text, nightly price, total stay price, gallery images, badges, search metadata
- Fields currently missing in prior actor output: image URL, image count, property type, sleeps, price qualifier, total price, cancellation details, review label, richer listing URL data
- Field count: 15+ useful listing fields after cleanup

## Why This API Was Selected

- The live VRBO search page loads data from `vrbo.com/graphql` instead of the older Expedia GraphQL endpoint currently used by the actor.
- The `DeferredSearchResults` response includes full listing cards and supports pagination by offset.
- The response is stable once a browser session has established the required cookies and request context.
- The actor can stay mostly HTTP-based after capturing one browser request template.

## Rejected Candidates

- `https://www.expedia.com/graphql`
  - Rejected because it no longer matches the live VRBO search flow for this actor and was producing empty local results.
- `https://www.uciservice.com/ds/api/v1/toolkit/page.Hotels.Search/...`
  - Rejected because it is page config and UI metadata, not the main property listing feed.
- DOM-only extraction
  - Rejected because the GraphQL payload is richer, cleaner, and easier to deduplicate than scraping rendered cards.

## URLScan / Live Discovery Notes

- URLScan searches for broad `vrbo.com` / `expedia.com` scans were noisy and often showed bot-challenge pages.
- A live browser session on the exact search URL confirmed the real listing request:
  - `POST https://www.vrbo.com/graphql`
  - Operation `DeferredSearchResults`
  - Page-load query plus offset-based pagination on next page

## Implementation Notes

- Direct plain HTTP without browser context is unreliable because cookies and request identity are established in the live page session.
- The working approach is:
  1. Open the target search page once in Firefox
  2. Capture the `DeferredSearchResults` request template
  3. Reuse its cookies, headers, and payload with `gotScraping`
  4. Page through results by incrementing `resultsStartingIndex`
