## What does VRBO Property Scraper do?

VRBO Property Scraper collects vacation rental listings from VRBO search URLs and destination searches. Provide one or more public VRBO search URLs, or use a location and travel dates, and receive a structured dataset with property titles, listing links, prices, reviews, cancellation information, images, and search metadata.

The dataset is useful for vacation rental market research, travel planning, competitor monitoring, pricing analysis, and property inventory tracking. Results are deduplicated and can be downloaded as JSON, CSV, Excel, or XML, or connected to other Apify workflows.

## Why use VRBO Property Scraper?

- **Market coverage** - Collect listings from multiple destinations and search URLs in one run.
- **Pricing signals** - Capture nightly prices, total stay prices when displayed, currency, pricing qualifiers, and fee-inclusion messaging.
- **Property comparison** - Compare property types, guest capacity, review scores, review counts, badges, and location labels.
- **Travel date context** - Use the check-in, check-out, and guest settings already present in a VRBO URL, or provide them as separate inputs.
- **Clean datasets** - Duplicate properties, placeholder cards, and records with no meaningful listing information are removed before results are saved.
- **Repeatable monitoring** - Schedule runs in Apify to compare inventory, prices, ratings, and listing visibility over time.

## What data can you extract from VRBO?

| Field | Type | Description |
|-------|------|-------------|
| `property_id` | String | Unique VRBO property identifier. |
| `title` | String | Listing title shown in the search results. |
| `listing_url` | String | Direct URL to the property details page. |
| `property_type` | String | Property category such as hotel, house, or apartment. |
| `sleeps` | Number | Guest capacity when shown in the listing summary. |
| `location_text` | String | Area, neighborhood, or location label displayed on the listing card. |
| `review_score` | Number | Numeric review score when available. |
| `review_label` | String | Review quality label such as Excellent or Wonderful. |
| `review_count` | Number | Number of reviews shown for the property. |
| `price_per_night` | Number | Displayed nightly price for the selected stay. |
| `price_total` | Number | Total stay price when shown in the search result. |
| `price_qualifier` | String | Pricing context such as average per night or stay-period messaging. |
| `all_fees_included` | Boolean | Whether the listing states that all fees are included. |
| `cancellation_policy` | String | Cancellation terms shown in the search result. |
| `free_cancellation` | Boolean | Whether free cancellation is advertised. |
| `image_url` | String | Primary listing image URL. |
| `image_count` | Number | Number of gallery images available for the listing. |
| `badge_text` | String | Listing badge such as Premier Host when present. |
| `currency` | String | Currency code used for pricing fields. |
| `search_url` | String | Search URL that produced the record. |
| `input_type` | String | Whether the target came from a URL or a keyword/location search. |
| `page_number` | Number | Search results page where the listing was found. |
| `scraped_at` | String | ISO timestamp for the collection time. |

Optional fields are omitted when VRBO does not display the corresponding information for a listing.

## How to scrape VRBO data

1. Open VRBO Property Scraper in Apify.
2. Add a public VRBO search URL, several URLs, or a destination with optional dates and guest count.
3. Set `results_wanted` and `max_pages` to control the collection size.
4. Run the Actor and review the dataset preview.
5. Download the results or connect the dataset to an API, webhook, spreadsheet, or automation.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `property_listings_urls` | Array or String | No | `[]` | One or more VRBO search or listing URLs. This is the recommended input for repeatable searches. |
| `search_urls` | Array or String | No | `[]` | Alternative field for one or more VRBO search URLs. |
| `url` | String | No | - | Alternative field for a single VRBO URL. |
| `location` | String | No | - | Destination or area to search when no URL is provided. |
| `keyword` | String | No | - | Destination or search phrase used when no URL is provided. |
| `check_in` | String | No | 30 days from run date | Check-in date in `YYYY-MM-DD` format. |
| `check_out` | String | No | 33 days from run date | Check-out date in `YYYY-MM-DD` format. |
| `adults` | Integer | No | `2` | Number of adults for a destination-based search. |
| `results_wanted` | Integer | No | `30` | Maximum number of unique listings to save. |
| `max_pages` | Integer | No | `5` | Maximum number of result pages to collect for each target. |
| `results_size` | Integer | No | `50` | Number of results considered per page, capped at 50. |
| `max_retries` | Integer | No | `5` | Retry limit for temporary collection failures. |
| `proxyConfiguration` | Object | No | Apify Proxy | Proxy settings for larger or repeated runs. Residential proxy groups can improve reliability. |

Use at least one of `property_listings_urls`, `search_urls`, `url`, `location`, or `keyword`. A URL can contain its own destination, dates, and adult count. Separate input values can be used to override those search details.

## Output Data

Each dataset item represents one unique VRBO search result. Fields with no source value are left out of that item.

| Field | Type | Description |
|-------|------|-------------|
| `property_id` | String | Stable property identifier used for deduplication. |
| `title` | String | Property listing title. |
| `listing_url` | String | Full property details URL. |
| `listing_path` | String | Relative listing path when available. |
| `property_type` | String | Property type label. |
| `sleeps` | Number | Maximum guest capacity shown in the card. |
| `location_text` | String | Displayed location or area text. |
| `review_score` | Number | Numeric review score. |
| `review_label` | String | Textual review label. |
| `review_count` | Number | Review count. |
| `price_per_night` | Number | Numeric nightly price. |
| `price_total` | Number | Numeric total stay price when displayed. |
| `price_qualifier` | String | Text explaining the displayed price. |
| `all_fees_included` | Boolean | Whether all fees are included according to the card. |
| `cancellation_policy` | String | Cancellation message. |
| `free_cancellation` | Boolean | Free-cancellation indicator when advertised. |
| `image_url` | String | Primary image URL. |
| `image_count` | Number | Available gallery image count. |
| `badge_text` | String | Badge or host-status text. |
| `currency` | String | Price currency code. |
| `search_url` | String | Search target for the record. |
| `input_type` | String | Input mode used for the target. |
| `page_number` | Number | Result page number. |
| `scraped_at` | String | ISO collection timestamp. |

## Usage Examples

### Basic Search by URL

Collect up to 30 unique listings from a Las Vegas search with dates and two adults:

```json
{
  "property_listings_urls": [
    "https://www.vrbo.com/search?destination=Las+Vegas%2C+Nevada%2C+United+States+of+America&startDate=2026-09-02&endDate=2026-09-05&adults=2"
  ],
  "results_wanted": 30
}
```

### Destination Search Without a URL

Let the Actor build a search from a destination, dates, and guest count:

```json
{
  "location": "Miami, Florida, United States",
  "check_in": "2026-10-10",
  "check_out": "2026-10-15",
  "adults": 4,
  "results_wanted": 50
}
```

### Multiple URLs with Pagination

Compare several destinations and collect a larger dataset across up to five pages per target:

```json
{
  "property_listings_urls": [
    "https://www.vrbo.com/search?destination=Orlando%2C+Florida%2C+United+States&startDate=2026-11-01&endDate=2026-11-05&adults=2",
    "https://www.vrbo.com/search?destination=San+Diego%2C+California%2C+United+States&startDate=2026-11-01&endDate=2026-11-05&adults=2"
  ],
  "results_wanted": 100,
  "max_pages": 5,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## Sample Output

```json
{
  "property_id": "100518043",
  "title": "In the Heart of Vegas Attractions! Casino, Pool, Game Room, Near Mob Museum!",
  "listing_url": "https://www.vrbo.com/3721404?dateless=true&adults=2&regionId=2008",
  "listing_path": "/3721404",
  "property_type": "Hotel",
  "sleeps": 4,
  "location_text": "Within Las Vegas Strip",
  "review_score": 8.8,
  "review_label": "Excellent",
  "review_count": 27,
  "price_per_night": 83,
  "price_qualifier": "avg per night",
  "all_fees_included": true,
  "cancellation_policy": "Free cancellation",
  "free_cancellation": true,
  "image_url": "https://media.vrbo.com/lodging/101000000/100520000/100518100/100518043/09eaa55d.jpg",
  "image_count": 32,
  "badge_text": "Premier Host",
  "currency": "USD",
  "search_url": "https://www.vrbo.com/search?destination=Las+Vegas%2C+Nevada%2C+United+States+of+America&startDate=2026-09-02&endDate=2026-09-05&adults=2",
  "input_type": "url",
  "page_number": 1,
  "scraped_at": "2026-08-11T13:45:47.000Z"
}
```

## Tips for Best Results

- **Use complete search URLs** - Include the destination, check-in date, check-out date, and adult count when those details matter to your analysis.
- **Start with a small run** - Test with 20 to 30 results and a low page limit before collecting a larger destination dataset.
- **Keep date ranges consistent** - Use the same stay dates when comparing prices across destinations or scheduled runs.
- **Use residential proxies for scale** - Residential proxy groups are recommended for larger or repeated runs.
- **Review optional fields across several records** - New properties may not have reviews, and some search cards may not show total pricing or cancellation text.
- **Check the dataset preview** - Confirm that the destination and dates are correct before scheduling recurring collection.

## Integrations and Export Formats

- **Google Sheets** - Compare prices, review scores, and property types in a spreadsheet.
- **Airtable** - Create a searchable property inventory with views and filters.
- **Webhooks** - Send completed dataset notifications or results to downstream systems.
- **Make and Zapier** - Trigger alerts, enrichment, reporting, or database updates.
- **API access** - Read datasets programmatically from your own applications.

Apify datasets can be downloaded as JSON, CSV, Excel, XML, and other supported formats.

## Frequently Asked Questions

### How many VRBO listings can I collect?

The Actor collects up to the `results_wanted` limit, subject to the number of listings available for each target and the `max_pages` setting. Multiple URLs share the same overall result limit.

### Can I search by destination instead of providing a URL?

Yes. Provide `location` or `keyword`, and optionally set `check_in`, `check_out`, and `adults`. For the most predictable search context, use a complete VRBO search URL.

### Can I process multiple VRBO searches in one run?

Yes. Add multiple values to `property_listings_urls` or `search_urls`. The Actor removes duplicate properties across targets before saving the final dataset.

### Why are some fields missing?

Some VRBO cards do not publish every field. New listings may have no review data, and total prices or cancellation messages may not appear for every search. Missing source values are omitted from the affected record.

### Can I export the results to CSV or Excel?

Yes. Apify datasets support CSV, Excel, JSON, XML, and other export formats from the dataset view.

### Can I schedule recurring VRBO collection?

Yes. Create an Apify schedule to run the Actor hourly, daily, weekly, or at another interval. Consistent destinations and stay dates make changes easier to compare.

### Is it legal to collect VRBO data?

Public data collection may be subject to laws, privacy obligations, and VRBO terms. You are responsible for using the Actor lawfully, respecting applicable restrictions, and handling collected data responsibly.

## Related Actors

- [Hometogo.de Scraper](https://apify.com/shahidirfan/hometogo-de-scraper) - Collect vacation rental listings, prices, availability, reviews, and host information from HomeToGo.de.
- [Airbnb Property Scraper](https://apify.com/shahidirfan/airbnb-property-scraper) - Extract Airbnb listing prices, reviews, availability, host profiles, and location data for vacation rental analysis.
- [Furnished Finder Scraper](https://apify.com/shahidirfan/furnished-finder-scraper) - Collect furnished apartment rental prices, availability, property details, amenities, and listing links.

## Support

For issues or feature requests, use the Issues tab on the Actor page or contact the developer through Apify.

## Legal Notice

This Actor is intended for legitimate collection and analysis of publicly available VRBO listing information. Users are responsible for complying with applicable laws, VRBO terms, privacy requirements, and any restrictions on using or redistributing collected data.
