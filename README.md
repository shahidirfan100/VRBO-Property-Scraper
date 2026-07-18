# VRBO Property Scraper

Extract VRBO vacation rental search results into a clean dataset built for analysis, monitoring, and research. Collect listing titles, prices, review signals, cancellation details, gallery images, and direct listing links without the duplicate and empty rows that make raw search data hard to use.

## Features

- **Search result collection** — Extract listings from VRBO search URLs or destination-based searches.
- **Clean pricing data** — Capture nightly price, total stay price, and price qualifiers in a structured format.
- **Review and trust signals** — Collect review score, review label, review count, badges, and cancellation messaging.
- **Media-ready output** — Save direct listing URLs, preview images, and image counts for each result.
- **Deduplicated dataset** — Filters placeholder cards, repeated properties, and null-heavy records before saving output.
- **Stealth extraction** — Uses iOS Safari headers and TLS fingerprint matching to bypass Akamai protection without a browser.
- **No browser dependency** — Fully HTTP-based; no Chrome or Firefox overhead. Faster cold starts and lower memory usage.

## Use Cases

### Market Research
Track pricing, review quality, and property mix across destinations. Compare neighborhoods, demand windows, and listing positioning with cleaner data than manual browsing can provide.

### Travel Planning Data
Build searchable shortlists of rentals for internal tools, concierge workflows, or destination research. Use structured prices, cancellation notes, and review signals to rank options faster.

### Competitive Monitoring
Monitor how listings appear in destination searches over time. Review changes in nightly rates, visibility, and listing presentation across repeated runs.

### Rental Portfolio Analysis
Study what kinds of properties appear for a target market and stay window. Use sleeps, property type, image coverage, and pricing data to benchmark similar rentals.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `property_listings_urls` | Array | No | — | One or more VRBO search or listing URLs to use as starting points. |
| `results_wanted` | Integer | No | `30` | Maximum number of unique listings to save. |
| `max_pages` | Integer | No | `5` | Maximum number of paginated result pages to request per search. |
| `proxyConfiguration` | Object | No | `{"useApifyProxy": true}` | Proxy settings for higher reliability. Residential proxies are recommended. |

---

## Output Data

Each dataset item contains:

| Field | Type | Description |
|-------|------|-------------|
| `property_id` | String | Unique property identifier from the search results. |
| `title` | String | Listing title shown in VRBO results. |
| `listing_url` | String | Direct URL to the listing details page. |
| `listing_path` | String | Relative listing path returned by the source. |
| `property_type` | String | Property category shown in the card summary. |
| `sleeps` | Number | Guest capacity when available in the listing summary. |
| `location_text` | String | Area or location label shown in the card. |
| `review_score` | Number | Numeric review score (may be absent for new listings). |
| `review_label` | String | Review quality label such as `Wonderful` or `Exceptional`. |
| `review_count` | Number | Number of reviews shown for the listing. |
| `price_per_night` | Number | Nightly price for the selected stay. |
| `price_total` | Number | Total displayed price for the stay when shown in card. |
| `price_qualifier` | String | Pricing context such as stay dates or per-night wording. |
| `all_fees_included` | Boolean | Whether the card states that all fees are included. |
| `cancellation_policy` | String | Cancellation message when shown in the search card. |
| `free_cancellation` | Boolean | Whether the listing advertises free cancellation. |
| `image_url` | String | Primary listing image URL. |
| `image_count` | Number | Number of gallery images available in the card response. |
| `badge_text` | String | Listing badge text when present. |
| `currency` | String | Currency used in the result set. |
| `search_url` | String | Search URL associated with the extracted record. |
| `page_number` | Number | Search page number where the listing was collected. |
| `scraped_at` | String | ISO timestamp for when the record was extracted. |

---

## Usage Examples

### Basic Search Extraction

```json
{
    "property_listings_urls": [
        "https://www.vrbo.com/search?destination=Las+Vegas%2C+Nevada%2C+United+States+of+America&startDate=2026-06-02&endDate=2026-06-05&adults=2"
    ],
    "results_wanted": 30
}
```

### Larger Result Set

```json
{
    "property_listings_urls": [
        "https://www.vrbo.com/search?destination=Miami%2C+Florida%2C+United+States+of+America&startDate=2026-07-10&endDate=2026-07-15&adults=4"
    ],
    "results_wanted": 100,
    "max_pages": 3
}
```

### Proxy-Hardened Run

```json
{
    "property_listings_urls": [
        "https://www.vrbo.com/search?destination=London%2C+England%2C+United+Kingdom&startDate=2026-08-01&endDate=2026-08-05&adults=2"
    ],
    "results_wanted": 50,
    "proxyConfiguration": {
        "useApifyProxy": true,
        "apifyProxyGroups": ["RESIDENTIAL"]
    }
}
```

---

## Sample Output

```json
{
    "property_id": "100518043",
    "title": "In the Heart of Vegas Attractions! Casino, Pool, Game Room, Near Mob Museum!",
    "listing_url": "https://www.vrbo.com/3721404?chkin=2026-06-02&chkout=2026-06-05&adults=2",
    "property_type": "Hotel",
    "sleeps": 2,
    "location_text": "Within Las Vegas Strip",
    "review_score": 9.0,
    "review_label": "Wonderful",
    "review_count": 20,
    "price_per_night": 70,
    "price_total": 209,
    "price_qualifier": "per night | Jun 2 - Jun 5",
    "all_fees_included": true,
    "cancellation_policy": "Free cancellation until May 19",
    "free_cancellation": true,
    "image_url": "https://media.vrbo.com/lodging/101000000/100520000/100518100/100518043/09eaa55d.jpg?impolicy=resizecrop&ra=fit&rw=455&rh=455",
    "image_count": 15,
    "currency": "USD",
    "page_number": 1,
    "search_url": "https://www.vrbo.com/search?destination=Las+Vegas%2C+Nevada%2C+United+States+of+America&startDate=2026-06-02&endDate=2026-06-05&adults=2",
    "scraped_at": "2026-04-24T09:00:00.000Z"
}
```

---

## Tips for Best Results

### Use Real Search URLs

- Start with working VRBO search URLs for the destination and stay window you care about.
- Keep dates realistic and available enough to return active search results.

### Keep Test Runs Small

- Start with `results_wanted` between `20` and `30` while validating new searches.
- Increase page count only when you need broader coverage.

### Use Residential Proxies

- Residential proxies are the best option for repeatable large runs.
- Direct connections may still work locally, but reliability is lower.

---

## Integrations

Connect your dataset with:

- **Google Sheets** — Review pricing and review trends in a spreadsheet.
- **Airtable** — Build searchable property research tables.
- **Slack** — Send alerts when fresh listings match your criteria.
- **Webhooks** — Deliver cleaned result data to internal systems.
- **Make** — Automate downstream enrichment and reporting.
- **Zapier** — Trigger actions from newly collected listings.

### Export Formats

- **JSON** — Best for APIs and custom applications.
- **CSV** — Best for spreadsheet analysis.
- **Excel** — Best for reporting and sharing.
- **XML** — Useful for legacy integrations.

---

## Frequently Asked Questions

### Does the actor remove duplicates?

Yes. Repeated properties and placeholder cards are filtered before data is written to the dataset.

### Why are some fields missing on certain listings?

Not every listing shows the same card details in search results. Fields that are not provided are omitted instead of saved as empty values. For example, new listings may lack review data, and total stay pricing is only shown when the card includes it.

### Does the actor require a browser?

No. The actor uses direct HTTP requests with stealth headers and TLS fingerprint matching. No browser is launched, resulting in faster cold starts and lower memory usage compared to Playwright-based scrapers.

### Can I scrape more than one page?

Yes. Use `max_pages` and `results_wanted` together to control deeper collection.

### Can I use direct listing URLs?

Yes. The actor accepts search and listing URLs, then collects the matching result data available for that stay window.

### What kind of prices are returned?

The dataset includes the nightly price when shown, the total stay price when shown, and any pricing qualifier present on the card.

---

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/platform/schedules)

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with applicable terms, policies, and laws when collecting or using data.
