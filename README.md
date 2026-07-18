# VRBO Property Scraper

Extract vacation rental search results from VRBO into clean, structured datasets for market analysis, travel planning, and competitive research. Collect property listings with pricing, review signals, gallery images, and direct booking links without the clutter of duplicates or empty fields.

## Features

- **Search result collection** - Collect listings from VRBO search URLs or destination-based queries with date and guest filters.
- **Structured pricing data** - Capture nightly rates, total stay prices, and pricing qualifiers in consistent numeric fields.
- **Review and trust indicators** - Gather review scores, labels, counts, badges, and cancellation messaging from each listing card.
- **Media and location details** - Save direct listing URLs, preview images, image counts, and area labels for every result.
- **Automatic deduplication** - Placeholder cards, repeated properties, and null-heavy records are filtered before saving output.
- **Pagination support** - Collect results across multiple search result pages with configurable limits.

## Use Cases

### Vacation Rental Market Research
Track pricing trends, review quality, and property type distribution across destinations. Compare neighborhoods, seasonal demand patterns, and listing positioning with structured data that manual browsing cannot provide at scale.

### Travel Planning and Curation
Build searchable shortlists of properties for concierge services, travel agency workflows, or destination research. Use structured prices, cancellation notes, and review signals to rank and filter options faster than browsing the website.

### Competitive Monitoring
Monitor how specific listings appear in destination search results over time. Track changes in nightly rates, visibility, badge status, and presentation across repeated collection runs.

### Rental Portfolio Analysis
Study the property mix for any target market and stay window. Use property types, image counts, pricing data, and review distributions to benchmark similar rentals and identify gaps in the market.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `property_listings_urls` | Array | No | - | One or more VRBO search or listing URLs to use as starting points |
| `results_wanted` | Integer | No | `30` | Maximum number of unique listings to collect |
| `max_pages` | Integer | No | `5` | Maximum pagination depth per search target |
| `proxyConfiguration` | Object | No | `{"useApifyProxy": true}` | Proxy settings; residential proxies recommended for reliability |

---

## Output Data

Each item in the dataset contains:

| Field | Type | Description |
|-------|------|-------------|
| `property_id` | String | Unique property identifier from VRBO search results |
| `title` | String | Listing title displayed on the search card |
| `listing_url` | String | Direct URL to the property details page |
| `listing_path` | String | Relative path component of the listing URL |
| `property_type` | String | Property category such as Hotel, House, or Apartment |
| `sleeps` | Number | Guest capacity when available in the listing summary |
| `location_text` | String | Area or neighborhood label shown on the card |
| `review_score` | Number | Numeric review rating (may be absent for new listings) |
| `review_label` | String | Quality label such as Excellent or Wonderful |
| `review_count` | Number | Total number of reviews for the listing |
| `price_per_night` | Number | Nightly rate for the selected stay dates |
| `price_total` | Number | Total stay price when displayed on the search card |
| `price_qualifier` | String | Pricing context such as avg per night or stay dates |
| `all_fees_included` | Boolean | Whether the card states that all fees are included |
| `cancellation_policy` | String | Cancellation terms when shown in the search results |
| `free_cancellation` | Boolean | Whether the listing advertises free cancellation |
| `image_url` | String | Primary listing image URL from the card gallery |
| `image_count` | Number | Total gallery images available in the search response |
| `badge_text` | String | Listing badge such as Premier Host when present |
| `currency` | String | Currency code for pricing fields |
| `search_url` | String | Search URL that produced this result |
| `page_number` | Number | Search results page where the listing was found |
| `scraped_at` | String | ISO timestamp when the record was collected |

---

## Usage Examples

### Basic Search by URL

Collect the first 30 results from a Las Vegas search:

```json
{
    "property_listings_urls": [
        "https://www.vrbo.com/search?destination=Las+Vegas%2C+Nevada%2C+United+States+of+America&startDate=2026-06-02&endDate=2026-06-05&adults=2"
    ],
    "results_wanted": 30
}
```

### Larger Collection with Pagination

Gather up to 100 results across multiple search pages:

```json
{
    "property_listings_urls": [
        "https://www.vrbo.com/search?destination=Miami%2C+Florida%2C+United+States+of+America&startDate=2026-07-10&endDate=2026-07-15&adults=4"
    ],
    "results_wanted": 100,
    "max_pages": 5
}
```

### Proxy-Enabled Run for Reliability

Use residential proxies for consistent results across repeated runs:

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
    "listing_url": "https://www.vrbo.com/3721404?dateless=true&adults=2&regionId=2008",
    "property_type": "Hotel",
    "location_text": "Within Las Vegas Strip",
    "review_score": 8.8,
    "review_label": "Excellent",
    "review_count": 27,
    "price_per_night": 83,
    "price_qualifier": "avg per night",
    "all_fees_included": true,
    "image_url": "https://media.vrbo.com/lodging/101000000/100520000/100518100/100518043/09eaa55d.jpg",
    "image_count": 32,
    "badge_text": "Premier Host",
    "currency": "USD",
    "page_number": 1,
    "scraped_at": "2026-07-18T13:45:47.000Z"
}
```

---

## Tips for Best Results

### Use Real Search URLs
Start with working VRBO search URLs for actual destinations and stay windows. Include check-in and check-out dates for the most relevant results.

### Keep Test Runs Small
Begin with `results_wanted` between 20 and 30 while validating new search targets. Increase limits once you confirm the data looks correct.

### Use Residential Proxies
Residential proxies provide the most consistent results for repeated or large-scale runs. Direct connections may work for occasional local testing but are less reliable at scale.

### Understand Data Availability
Not every listing card includes all fields. New properties may lack reviews, and some cards omit total pricing. Fields that are not provided are simply omitted from the output.

---

## Integrations

Connect your dataset with:

- **Google Sheets** - Review pricing and trends in a familiar spreadsheet interface
- **Airtable** - Build searchable property research tables with filters and views
- **Slack** - Send alerts when fresh listings match your criteria
- **Webhooks** - Deliver cleaned result data to internal systems and databases
- **Make** - Automate downstream enrichment, notifications, and reporting workflows
- **Zapier** - Trigger actions from newly collected property listings

### Export Formats

- **JSON** - Best for APIs, databases, and custom applications
- **CSV** - Best for spreadsheet analysis and quick filtering
- **Excel** - Best for business reporting and sharing with stakeholders
- **XML** - Useful for legacy system integrations and data exchange

---

## Frequently Asked Questions

### How many listings can I collect?
You can collect all available listings from a search. The practical limit depends on the destination and stay window. Use `results_wanted` and `max_pages` together to control collection depth.

### Does the actor remove duplicates?
Yes. Repeated properties, placeholder cards, and null-heavy records are automatically filtered before data is written to the dataset.

### Why are some fields missing from certain results?
Not every property card displays the same level of detail. New listings may lack review data, and some cards do not show total pricing. Fields that are absent from the source are omitted rather than saved as empty values.

### Can I scrape more than one search at a time?
Yes. You can provide multiple search URLs in the `property_listings_urls` field. The actor processes each target and collects results up to your overall limit.

### Can I use dates and guest counts in my search?
Yes. VRBO search URLs that include check-in dates, check-out dates, and adult counts are supported directly. The actor preserves these parameters when building the extraction request.

### Do I need a browser or any special setup?
No. The actor runs without a browser and does not require any special configuration beyond standard Apify setup. It works with or without proxies, though residential proxies are recommended for larger runs.

### What kind of pricing data is collected?
The dataset includes the per-night rate when available, the total stay price when displayed on the card, and any pricing qualifier text such as avg per night or total for stay.

---

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/platform/schedules)
- [Apify Proxy Configuration](https://docs.apify.com/platform/proxies)

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with applicable terms of service, policies, and laws when collecting or using data from any website.
