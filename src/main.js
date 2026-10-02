import { randomUUID } from 'node:crypto';

import { Actor, log } from 'apify';
import { Impit } from 'impit';

const VRBO_GRAPHQL_URL = 'https://www.vrbo.com/graphql';
const DEFERRED_SEARCH_RESULTS_HASH = '79d7f75261d4b71439afdd482c474ae0274c2ae9cc0e575cc1fccb54374cb7f6';

const DEFAULT_RESULTS_WANTED = 30;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_BATCH_SIZE = 100;

// Internal tuning: fixed page size and a generous retry budget, since each retry
// rotates to a fresh proxy session instead of retrying the same blocked IP.
const RESULTS_SIZE = 50;
const MAX_RETRIES = 8;

function cleanString(value) {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.replace(/\s+/g, ' ').trim();
    return trimmed.length ? trimmed : undefined;
}

function toPositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return undefined;

    const parsed = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : undefined;
}

function addDays(date, days) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
}

function toIsoDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toISOString().slice(0, 10);
}

function deepClean(value) {
    if (Array.isArray(value)) {
        const cleaned = value.map((item) => deepClean(item)).filter((item) => item !== undefined);
        return cleaned.length ? cleaned : undefined;
    }

    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, val] of Object.entries(value)) {
            const cleaned = deepClean(val);
            if (cleaned !== undefined) out[key] = cleaned;
        }

        return Object.keys(out).length ? out : undefined;
    }

    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') return cleanString(value);
    return value;
}

function normalizeUrl(value) {
    const cleaned = cleanString(value)?.replace(/[\u200B-\u200D\uFEFF]/g, '');
    if (!cleaned) return undefined;

    const candidate = /^[a-z][a-z\d+\-.]*:\/\//i.test(cleaned)
        ? cleaned
        : `https://${cleaned.replace(/^\/+/, '')}`;

    try {
        return new URL(candidate);
    } catch {
        return undefined;
    }
}

function splitIntoList(value) {
    if (Array.isArray(value)) {
        return value.map((item) => cleanString(String(item))).filter(Boolean);
    }

    const single = cleanString(String(value ?? ''));
    if (!single) return [];

    return single
        .split(/[\n,]/)
        .map((part) => cleanString(part))
        .filter(Boolean);
}

function sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function uniqueBy(items, getKey) {
    const seen = new Set();
    const out = [];

    for (const item of items) {
        const key = getKey(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }

    return out;
}

function isPropertyUrl(url) {
    return /\/\d{4,}(?:[/?]|$)/.test(url.pathname);
}

function findEntryByPrefix(container, prefix) {
    if (!container || typeof container !== 'object') return undefined;
    const entry = Object.entries(container).find(([key]) => key.startsWith(prefix));
    return entry ? entry[1] : undefined;
}

function extractApolloState(html) {
    const markerIndex = html.indexOf('window.__APOLLO_STATE__');
    if (markerIndex === -1) return undefined;

    const equalsIndex = html.indexOf('=', markerIndex);
    const parseIndex = html.indexOf('JSON.parse(', equalsIndex);
    if (parseIndex === -1) return undefined;

    let start = parseIndex + 'JSON.parse('.length;
    while (start < html.length && html[start] !== '"' && html[start] !== "'") start++;
    const quote = html[start];
    if (quote !== '"' && quote !== "'") return undefined;

    let end = start + 1;
    let escaped = false;
    for (; end < html.length; end++) {
        const char = html[end];
        if (escaped) { escaped = false; continue; }
        if (char === '\\') { escaped = true; continue; }
        if (char === quote) break;
    }

    try {
        const inner = JSON.parse(html.slice(start, end + 1));
        return typeof inner === 'string' ? JSON.parse(inner) : inner;
    } catch {
        return undefined;
    }
}

function extractMetaDescription(html) {
    const match = html.match(/<meta[^>]+name="description"[^>]*content="([^"]*)"/i)
        ?? html.match(/<meta[^>]+content="([^"]*)"[^>]*name="description"/i);
    return match ? cleanString(match[1]) : undefined;
}

function mapPropertyDetail(html, meta) {
    const state = extractApolloState(html);
    if (!state) return undefined;

    const root = state.ROOT_QUERY ?? {};
    const headline = findEntryByPrefix(root, 'productHeadline');
    const rating = findEntryByPrefix(root, 'productRatingSummary');
    const gallery = findEntryByPrefix(root, 'productGallery');
    const highlights = findEntryByPrefix(root, 'productHighlights');
    const offers = findEntryByPrefix(root, 'propertyOffers');
    const propertyInfoKey = Object.keys(state).find((key) => key.startsWith('PropertyInfo:'));
    const propertyInfo = propertyInfoKey ? state[propertyInfoKey] : undefined;

    let seo = {};
    if (typeof headline?.seoStructuredData === 'string') {
        try { seo = JSON.parse(headline.seoStructuredData); } catch { seo = {}; }
    }

    const address = seo.address ?? {};
    const aggregate = seo.aggregateRating ?? {};

    const seoData = rating?.metadata?.seoData ?? [];
    const reviewCountText = cleanString(rating?.summary?.supportingMessages?.[0]?.link?.text);
    const reviewCount = toPositiveInt(
        seoData.find((entry) => entry?.itemprop === 'reviewCount')?.content
        ?? reviewCountText?.match(/\d+/)?.[0],
        0,
    ) || undefined;

    const amenitiesNode = findEntryByPrefix(propertyInfo?.summary, 'amenities(');
    const amenities = [];
    for (const section of amenitiesNode?.amenities ?? []) {
        for (const content of section?.contents ?? []) {
            for (const item of content?.infoItems ?? []) {
                const text = cleanString(item?.text);
                if (text) amenities.push(text);
            }
        }
    }

    const categories = gallery?.categorizedImages ?? [];
    const imageCategory = categories.find((category) => category?.categoryId === 'all') ?? categories[0];
    const images = uniqueBy(
        (imageCategory?.images ?? [])
            .map((entry) => cleanString(entry?.image?.url))
            .filter(Boolean),
        (url) => url,
    );

    const highlightTexts = (highlights?.content?.items ?? [])
        .map((item) => {
            const text = cleanString(item?.text);
            const subText = cleanString(item?.subText);
            return [text, subText].filter(Boolean).join(' - ') || undefined;
        })
        .filter(Boolean);

    const locationText = [address.addressLocality, address.addressRegion, address.addressCountry]
        .filter(Boolean)
        .join(', ') || undefined;

    return deepClean({
        property_id: cleanString(String(seo.identifier ?? propertyInfo?.id ?? '')),
        title: cleanString(headline?.primary),
        listing_url: meta.sourceUrl,
        description: extractMetaDescription(html),
        property_type: cleanString(headline?.featuredMessages?.[0]?.text),
        location_text: locationText,
        city: cleanString(address.addressLocality),
        state: cleanString(address.addressRegion),
        country: cleanString(address.addressCountry),
        latitude: typeof seo.latitude === 'number' ? seo.latitude : undefined,
        longitude: typeof seo.longitude === 'number' ? seo.longitude : undefined,
        review_score: toNumber(rating?.summary?.primary) ?? toNumber(aggregate.ratingValue),
        review_label: cleanString(rating?.summary?.secondary),
        review_count: reviewCount,
        price_per_night: toNumber(offers?.stickyBar?.price?.formattedDisplayPrice),
        amenities: uniqueBy(amenities, (item) => item),
        highlights: uniqueBy(highlightTexts, (item) => item),
        image_url: cleanString(seo.image) ?? images[0],
        image_count: images.length || undefined,
        images,
        source_type: 'vrbo_property_details',
        source_url: meta.sourceUrl,
        search_url: meta.sourceUrl,
        input_type: 'property',
        page_number: 1,
        currency: 'USD',
        scraped_at: new Date().toISOString(),
    });
}

function buildVrboSearchUrl({ destination, checkIn, checkOut, adults, regionId, latLong }) {
    const url = new URL('https://www.vrbo.com/search');
    url.searchParams.set('destination', destination);
    if (regionId) url.searchParams.set('regionId', regionId);
    if (latLong) url.searchParams.set('latLong', latLong);
    url.searchParams.set('startDate', checkIn);
    url.searchParams.set('endDate', checkOut);
    url.searchParams.set('adults', String(adults));
    url.searchParams.set('d1', checkIn);
    url.searchParams.set('d2', checkOut);
    return url;
}

function normalizeLatLong(value) {
    const raw = cleanString(value);
    if (!raw) return undefined;

    const [latitude, longitude] = raw.split(',').map((part) => Number(part));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;

    return `${latitude},${longitude}`;
}

function buildTargetFromInputUrl(url, input) {
    const now = new Date();
    const defaultCheckIn = toIsoDate(addDays(now, 30));
    const defaultCheckOut = toIsoDate(addDays(now, 33));

    const destination =
        cleanString(url.searchParams.get('destination')) ??
        cleanString(url.searchParams.get('q')) ??
        cleanString(input.location);

    const checkIn =
        cleanString(input.check_in) ??
        cleanString(url.searchParams.get('startDate')) ??
        cleanString(url.searchParams.get('d1')) ??
        defaultCheckIn;

    const checkOut =
        cleanString(input.check_out) ??
        cleanString(url.searchParams.get('endDate')) ??
        cleanString(url.searchParams.get('d2')) ??
        defaultCheckOut;

    const adults = toPositiveInt(
        input.adults ?? cleanString(url.searchParams.get('adults')),
        2,
    );
    const regionId = cleanString(url.searchParams.get('regionId'));
    const latLong = normalizeLatLong(url.searchParams.get('latLong'));

    const sourceUrl = url.toString();
    const searchUrl = buildVrboSearchUrl({
        destination,
        checkIn,
        checkOut,
        adults,
        regionId,
        latLong,
    }).toString();

    return {
        inputType: 'url',
        sourceUrl,
        searchUrl,
    };
}

function getTargets(input) {
    const urls = splitIntoList(input.property_listings_urls)
        .map((item) => normalizeUrl(item))
        .filter(Boolean);

    if (urls.length) {
        return urls.map((url) => (isPropertyUrl(url)
            ? { inputType: 'property', sourceUrl: url.toString(), searchUrl: url.toString() }
            : buildTargetFromInputUrl(url, input)));
    }

    const destination = cleanString(input.location);
    if (!destination) return [];

    const now = new Date();
    const checkIn = cleanString(input.check_in) ?? toIsoDate(addDays(now, 30));
    const checkOut = cleanString(input.check_out) ?? toIsoDate(addDays(now, 33));
    const adults = toPositiveInt(input.adults, 2);
    const searchUrl = buildVrboSearchUrl({ destination, checkIn, checkOut, adults }).toString();

    return [{
        inputType: 'location',
        sourceUrl: searchUrl,
        searchUrl,
    }];
}

function resolveProxyInput(inputProxy) {
    const requested = inputProxy ?? { useApifyProxy: true };
    if (requested.useApifyProxy === false) return requested;

    const hasProxyPassword = cleanString(process.env.APIFY_PROXY_PASSWORD);
    const hasToken = cleanString(process.env.APIFY_TOKEN);
    if (hasProxyPassword || hasToken) return requested;

    log.warning('APIFY_PROXY_PASSWORD/APIFY_TOKEN not found. Falling back to direct connection.');
    return {
        ...requested,
        useApifyProxy: false,
    };
}

function upsertCount(counts, id, value) {
    if (!id || value === undefined || value === null) return counts;

    const nextCounts = Array.isArray(counts) ? [...counts] : [];
    const index = nextCounts.findIndex((entry) => entry?.id === id);
    const normalized = typeof value === 'number' ? value : Number(value);
    const nextValue = Number.isFinite(normalized) ? normalized : value;

    if (index >= 0) nextCounts[index] = { id, value: nextValue };
    else nextCounts.push({ id, value: nextValue });

    return nextCounts;
}

function buildDeferredSearchPayload({ searchUrl, duaid, searchId, startIndex }) {
    const url = new URL(searchUrl);
    const destination = cleanString(url.searchParams.get('destination'));
    const regionId = cleanString(url.searchParams.get('regionId'));
    const latLong = cleanString(url.searchParams.get('latLong'));
    const startDate = cleanString(url.searchParams.get('startDate') ?? url.searchParams.get('d1'));
    const endDate = cleanString(url.searchParams.get('endDate') ?? url.searchParams.get('d2'));
    const adults = toPositiveInt(url.searchParams.get('adults'), 2);
    const [latitude, longitude] = (latLong ?? '')
        .split(',')
        .map((value) => Number(value));

    const payload = {
        operationName: 'DeferredSearchResults',
        variables: {
            deferList: true,
            deferMap: false,
            includeMapToolbar: false,
            includeDynamicMap: false,
            context: {
                siteId: 9001001,
                locale: 'en_US',
                eapid: 1,
                tpid: 9001,
                currency: 'USD',
                device: { type: 'DESKTOP' },
                identity: {
                    duaid,
                    authState: 'ANONYMOUS',
                },
                privacyTrackingState: 'CAN_TRACK',
                debugContext: {
                    abacusOverrides: [],
                },
            },
            criteria: {
                primary: {
                    destination: {
                        regionName: destination,
                        regionId,
                        coordinates: Number.isFinite(latitude) && Number.isFinite(longitude)
                            ? { latitude, longitude }
                            : null,
                        mapBounds: null,
                    },
                    rooms: [{
                        adults,
                        children: [],
                    }],
                    dateRange: {
                        checkInDate: {
                            year: Number(startDate?.slice(0, 4)),
                            month: Number(startDate?.slice(5, 7)),
                            day: Number(startDate?.slice(8, 10)),
                        },
                        checkOutDate: {
                            year: Number(endDate?.slice(0, 4)),
                            month: Number(endDate?.slice(5, 7)),
                            day: Number(endDate?.slice(8, 10)),
                        },
                    },
                },
                secondary: {
                    ranges: [],
                    selections: [
                        { id: 'sort', value: 'RECOMMENDED' },
                        { id: 'searchId', value: searchId },
                    ],
                    booleans: [],
                    counts: [],
                },
            },
            shoppingContext: {
                queryTriggeredBy: startIndex > 0 ? 'NEXT_PAGINATION' : 'PAGE-LOAD',
                typeaheadCollationId: null,
            },
        },
        extensions: {
            persistedQuery: {
                version: 1,
                sha256Hash: DEFERRED_SEARCH_RESULTS_HASH,
            },
        },
    };

    if (startIndex > 0) {
        payload.variables.criteria.secondary.counts = upsertCount(
            payload.variables.criteria.secondary.counts,
            'resultsStartingIndex',
            startIndex,
        );
    }

    return payload;
}

function buildGraphQlHeaders({ referer }) {
    return {
        accept: 'multipart/mixed;deferSpec=20220824,application/json',
        'content-type': 'application/json',
        origin: 'https://www.vrbo.com',
        referer,
        'accept-language': 'en-US,en;q=0.9',
        'client-info': 'shopping-pwa,ea624da1e0c23debcf613a27651fb50f72015e57,us-east-1',
        'x-page-id': 'page.Hotel-Search,H,20',
        'x-hcom-origin-id': 'page.Hotel-Search,H,20',
        'x-parent-brand-id': 'vrbo',
        'x-product-line': 'lodging',
        'ctx-view-id': randomUUID(),
    };
}

function parseMultipartJson(text) {
    return String(text ?? '')
        .split('--graphql')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const firstBrace = part.indexOf('{');
            if (firstBrace === -1) return undefined;

            try {
                return JSON.parse(part.slice(firstBrace));
            } catch {
                return undefined;
            }
        })
        .filter(Boolean);
}

function findListingsNode(node) {
    if (!node || typeof node !== 'object') return [];

    if (Array.isArray(node)) {
        return node.flatMap((item) => findListingsNode(item));
    }

    if (Array.isArray(node.incremental)) {
        return node.incremental.flatMap((entry) => findListingsNode(entry));
    }

    const directListings = node?.data?.propertySearch?.propertySearchListings
        ?? node?.data?.deferredListingSearchResults?.propertySearchListings
        ?? node?.propertySearch?.propertySearchListings
        ?? node?.deferredListingSearchResults?.propertySearchListings
        ?? node?.propertySearchListings;

    if (Array.isArray(directListings)) return directListings;

    return Object.values(node).flatMap((value) => findListingsNode(value));
}

function extractListingCards(parts) {
    const rawListings = parts.flatMap((part) => findListingsNode(part));

    return rawListings.filter((item) => {
        if (!item || typeof item !== 'object') return false;
        if (!item.id) return false;
        if (!item.headingSection?.heading) return false;
        // eslint-disable-next-line no-underscore-dangle
        if (String(item.__typename ?? '').includes('Placeholder')) return false;
        return true;
    });
}

function findSearchSummary(node) {
    if (!node || typeof node !== 'object') return undefined;

    if (Array.isArray(node)) {
        for (const entry of node) {
            const summary = findSearchSummary(entry);
            if (summary) return summary;
        }
        return undefined;
    }

    if (node.summary && typeof node.summary === 'object'
        && (node.summary.resultsHeading || node.summary.resultMessages || node.summary.propertyCount)) {
        return node.summary;
    }

    for (const value of Object.values(node)) {
        const summary = findSearchSummary(value);
        if (summary) return summary;
    }

    return undefined;
}

function getSearchSummary(parts) {
    for (const part of parts) {
        const summary = findSearchSummary(part);
        if (summary) return summary;
    }

    return undefined;
}

function getSearchPropertyCount(summary) {
    const heading = String(summary?.resultsHeading ?? '');
    const match = heading.match(/([\d,]+)\s+properties?/i);
    return match ? toNumber(match[1].replace(/,/g, '')) : summary?.propertyCount;
}

function getAllImageUrls(item) {
    return uniqueBy(
        (item?.mediaSection?.gallery?.media ?? [])
            .map((entry) => cleanString(entry?.media?.url))
            .filter(Boolean),
        (url) => url,
    );
}

function getLocationText(item) {
    const texts = [
        ...(item?.headingSection?.featuredMessages ?? []).map((entry) => cleanString(entry?.text)),
        ...(item?.headingSection?.locationInfo ?? []).map((entry) => cleanString(entry?.text)),
    ].filter(Boolean);

    return texts.length ? texts.join(' | ') : undefined;
}

function getReviewSummary(item) {
    const section = item?.summarySections?.find((entry) => entry?.reviewSummary)?.reviewSummary;
    const rawScore = toNumber(section?.graphic?.text);
    const score = rawScore && rawScore > 0 ? rawScore : undefined;
    const label = score ? cleanString(section?.title?.shoppingProductTitle?.text) : undefined;
    const reviewText = cleanString(section?.subtexts?.[0]?.shoppingProductTitle?.text);
    const reviewCount = reviewText ? toPositiveInt(reviewText.replace(/[^\d]/g, ''), 0) || undefined : undefined;
    const theme = score ? cleanString(section?.graphic?.badgeTheme) : undefined;

    return { score, label, reviewCount, theme };
}

function getPriceDetails(item) {
    const summary = item?.priceSection?.priceSummary;
    const leadOption = summary?.options?.[0];
    const lineItems = summary?.displayMessages?.flatMap((entry) => entry?.lineItems ?? []) ?? [];

    const pricePerNight = toNumber(
        leadOption?.displayPrice?.formatted
        ?? lineItems.find((entry) => entry?.role === 'LEAD')?.price?.formatted,
    );

    const priceOriginal = toNumber(
        leadOption?.strikeOut?.formatted
        ?? lineItems.find((entry) => entry?.role === 'STRIKEOUT')?.price?.formatted,
    );

    const totalText = cleanString(lineItems.find((entry) => cleanString(entry?.value)?.includes(' for '))?.value);
    const priceTotal = totalText ? toNumber(totalText.match(/\$[\d,]+/)?.[0]) : undefined;
    const nights = totalText ? toNumber(totalText.match(/for\s+(\d+)\s+nights?/i)?.[1]) : undefined;

    const priceQualifier = cleanString(
        summary?.priceMessaging?.map((entry) => cleanString(entry?.value)).filter(Boolean).join(' | '),
    );

    const allFeesIncluded = lineItems.some((entry) => cleanString(entry?.value) === 'All fees included');

    return {
        pricePerNight,
        priceOriginal,
        priceTotal,
        nights,
        priceQualifier,
        allFeesIncluded,
    };
}

function parseListingMessages(item) {
    const raw = cleanString(item?.headingSection?.messages?.[0]?.text);
    const title = cleanString(item?.headingSection?.heading);

    if (!raw) {
        return {
            sleeps: toNumber(title?.match(/Sleeps\s+(?:up to\s+)?(\d+)/i)?.[1]),
        };
    }

    const propertyType = cleanString(raw.split('·')[0]);
    const bedrooms = toNumber(raw.match(/(\d+)\s*bedroom/i)?.[1]);
    const bathrooms = toNumber(raw.match(/(\d+)\s*bathroom/i)?.[1]);
    const sleeps = toNumber(raw.match(/Sleeps\s+(\d+)/i)?.[1])
        ?? toNumber(title?.match(/Sleeps\s+(?:up to\s+)?(\d+)/i)?.[1]);
    const bedMatch = raw.match(/(\d+)\s+((?:Double|Queen|King|Single|Twin|Sofa|Bunk|Full|California King)\s+)?Beds?\b/i);

    return {
        propertyType,
        bedrooms,
        bathrooms,
        sleeps,
        beds: bedMatch ? Number(bedMatch[1]) : undefined,
        bedType: cleanString(bedMatch?.[2]),
    };
}

function getBadges(item) {
    const group = item?.mediaSection?.badges ?? {};
    const texts = [
        group.primaryBadge?.text,
        group.secondaryBadge?.text,
        group.tertiaryBadge?.text,
        item?.priceSection?.badge?.text,
    ].map((text) => cleanString(text)).filter(Boolean);

    return uniqueBy(texts, (text) => text);
}

function getAnalyticsAttributes(item) {
    const content = (item?.analyticsEvents ?? [])
        .find((event) => event?.attribute?.name === 'product_list')?.attribute?.content;
    if (!content) return {};

    let parsed;
    try { parsed = JSON.parse(content); } catch { return {}; }
    const product = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!product || typeof product !== 'object') return {};

    return {
        freeCancellation: product.free_cancellation_bool === true ? true : undefined,
        sponsored: product.search_sponsored_bool === true ? true : undefined,
        searchPosition: toNumber(product.search_product_position),
        guestRatingSource: cleanString(product.guest_rating_source),
        badges: (product.lodging_product?.badges ?? []).map((badge) => cleanString(badge)).filter(Boolean),
    };
}

function getCancellationText(item) {
    return cleanString(
        item?.summarySections
            ?.flatMap((section) => section?.footerMessages?.listItems ?? [])
            .map((entry) => cleanString(entry?.text))
            .find(Boolean),
    );
}

function mapListing(item, meta) {
    const review = getReviewSummary(item);
    const price = getPriceDetails(item);
    const cancellationText = getCancellationText(item);
    const stay = parseListingMessages(item);
    const images = getAllImageUrls(item);
    const badges = getBadges(item);
    const analytics = getAnalyticsAttributes(item);

    const freeCancellation = analytics.freeCancellation
        ?? (cancellationText?.toLowerCase().includes('free cancellation') ? true : undefined);

    const mapped = deepClean({
        property_id: cleanString(String(item.id)),
        title: cleanString(item?.headingSection?.heading),
        listing_url: cleanString(item?.cardLink?.resource?.value),
        listing_path: cleanString(item?.cardLink?.resource?.relativePath),
        property_type: stay.propertyType,
        bedrooms: stay.bedrooms,
        beds: stay.beds,
        bed_type: stay.bedType,
        bathrooms: stay.bathrooms,
        sleeps: stay.sleeps,
        location_text: getLocationText(item),
        review_score: review.score,
        review_label: review.label,
        review_count: review.reviewCount,
        review_theme: review.theme,
        price_per_night: price.pricePerNight,
        price_original: price.priceOriginal,
        price_total: price.priceTotal,
        nights: price.nights,
        price_qualifier: price.priceQualifier,
        all_fees_included: price.allFeesIncluded,
        cancellation_policy: cancellationText,
        free_cancellation: freeCancellation,
        image_url: images[0],
        image_count: images.length,
        images,
        badges,
        badge_text: badges[0],
        sponsored: analytics.sponsored,
        search_position: analytics.searchPosition,
        guest_rating_source: analytics.guestRatingSource,
        source_type: 'vrbo_deferred_search_results',
        source_url: VRBO_GRAPHQL_URL,
        search_url: meta.searchUrl,
        input_type: meta.inputType,
        page_number: meta.pageNumber,
        currency: meta.currency,
        scraped_at: new Date().toISOString(),
    });

    return mapped;
}

async function createVrboClient({ proxyConfiguration, sessionPrefix }) {
    let proxyUrl;
    if (proxyConfiguration) {
        const sessionId = `${sessionPrefix}_${randomUUID().replace(/-/g, '')}`;
        proxyUrl = await proxyConfiguration.newUrl(sessionId);
    }

    return new Impit({
        browser: 'chrome',
        ignoreTlsErrors: true,
        ...(proxyUrl && { proxyUrl }),
    });
}

async function queryVrboListings({
    createClient,
    payload,
    referer,
}) {
    const attempts = MAX_RETRIES;
    let client = await createClient();

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const headers = buildGraphQlHeaders({ referer });
            const response = await client.fetch(VRBO_GRAPHQL_URL, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                timeout: 15_000,
            });

            const bodyText = await response.text();
            const parts = parseMultipartJson(bodyText);
            const hadErrors = bodyText.includes('"errors"');

            if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
                const waitMs = Math.min(300 * attempt, 1_500);
                log.debug(`GraphQL retry ${attempt}/${attempts} due to HTTP ${response.status}.`);
                await sleep(waitMs);
                client = await createClient();
                continue;
            }

            return {
                statusCode: response.status,
                parts,
                hadErrors,
            };
        } catch (error) {
            if (attempt >= attempts) {
                return {
                    statusCode: 0,
                    parts: [],
                    error: error.message,
                };
            }

            const waitMs = Math.min(300 * attempt, 1_500);
            log.debug(`GraphQL retry ${attempt}/${attempts} failed: ${error.message}.`);
            await sleep(waitMs);
            client = await createClient();
        }
    }

    return {
        statusCode: 0,
        parts: [],
        error: 'Max retries reached.',
    };
}

async function fetchPropertyDetail({ createClient, url }) {
    const attempts = MAX_RETRIES;
    let client = await createClient();

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const response = await client.fetch(url, {
                headers: {
                    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'accept-language': 'en-US,en;q=0.9',
                },
                timeout: 15_000,
            });

            const html = await response.text();

            if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
                const waitMs = Math.min(300 * attempt, 1_500);
                log.debug(`Property detail retry ${attempt}/${attempts} due to HTTP ${response.status}.`);
                await sleep(waitMs);
                client = await createClient();
                continue;
            }

            return { statusCode: response.status, html };
        } catch (error) {
            if (attempt >= attempts) return { statusCode: 0, html: '', error: error.message };

            const waitMs = Math.min(300 * attempt, 1_500);
            log.debug(`Property detail retry ${attempt}/${attempts} failed: ${error.message}.`);
            await sleep(waitMs);
            client = await createClient();
        }
    }

    return { statusCode: 0, html: '', error: 'Max retries reached.' };
}

async function pushInBatches(items, batchSize = DEFAULT_BATCH_SIZE) {
    const safeBatchSize = toPositiveInt(batchSize, DEFAULT_BATCH_SIZE);
    for (let index = 0; index < items.length; index += safeBatchSize) {
        await Actor.pushData(items.slice(index, index + safeBatchSize));
    }
}

await Actor.init();

let failed = false;

try {
    const input = (await Actor.getInput()) ?? {};

    const resultsWanted = toPositiveInt(input.results_wanted, DEFAULT_RESULTS_WANTED);
    const maxPages = toPositiveInt(input.max_pages, DEFAULT_MAX_PAGES);
    const resultsSize = RESULTS_SIZE;

    const targets = getTargets(input);
    log.info(`Loaded ${targets.length} target(s) from input.`);
    if (!targets.length) {
        throw new Error('Provide property_listings_urls or a location input.');
    }

    const proxyInput = resolveProxyInput(input.proxyConfiguration);
    const proxyConfiguration = proxyInput?.useApifyProxy === false
        ? undefined
        : await Actor.createProxyConfiguration(proxyInput);

    const seen = new Set();
    let savedCount = 0;

    for (let index = 0; index < targets.length; index++) {
        if (savedCount >= resultsWanted) break;

        const meta = targets[index];
        const createClient = () => createVrboClient({
            proxyConfiguration,
            sessionPrefix: `vrbo_${index + 1}`,
        });

        if (meta.inputType === 'property') {
            log.info(`Handling property page ${meta.sourceUrl}`);

            const detail = await fetchPropertyDetail({ createClient, url: meta.sourceUrl });
            if (detail.error) {
                log.warning(`Property fetch failed for ${meta.sourceUrl}: ${detail.error}`);
            }

            const record = detail.html ? mapPropertyDetail(detail.html, meta) : undefined;
            if (record) {
                const detailKey = record.property_id ?? record.listing_url;
                if (detailKey && !seen.has(detailKey)) {
                    seen.add(detailKey);
                    await pushInBatches([record], DEFAULT_BATCH_SIZE);
                    savedCount++;
                    log.info(`Saved property detail for ${detailKey}.`);
                }
            } else {
                log.warning(`No property details found for ${meta.sourceUrl}.`);
            }

            continue;
        }

        log.info(`Handling search page ${meta.searchUrl}`);

        const duaid = randomUUID();
        const searchId = randomUUID();
        const currency = 'USD';

        let emptyPageStreak = 0;

        for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
            if (savedCount >= resultsWanted) break;

            let pageRows = [];
            let cards = [];
            let pageFailed = false;

            for (let pageAttempt = 1; pageAttempt <= 3; pageAttempt++) {
                const startIndex = (pageNumber - 1) * resultsSize;
                const payload = buildDeferredSearchPayload({
                    searchUrl: meta.searchUrl,
                    duaid,
                    searchId,
                    startIndex,
                });

                const result = await queryVrboListings({
                    createClient,
                    payload,
                    referer: meta.searchUrl,
                });

                cards = extractListingCards(result.parts);

                if (pageNumber === 1 && pageAttempt === 1) {
                    const propertyCount = getSearchPropertyCount(getSearchSummary(result.parts));
                    if (propertyCount) {
                        log.info(`Search reported ${propertyCount} total properties for ${meta.searchUrl}.`);
                    }
                }

                pageRows = [];

                for (const card of cards) {
                    const mapped = mapListing(card, {
                        inputType: meta.inputType,
                        searchUrl: meta.searchUrl,
                        pageNumber,
                        currency,
                    });
                    if (!mapped) continue;

                    const dedupeKey = mapped.property_id ?? mapped.listing_url;
                    if (!dedupeKey || seen.has(dedupeKey)) continue;

                    seen.add(dedupeKey);
                    pageRows.push(mapped);

                    if (savedCount + pageRows.length >= resultsWanted) break;
                }

                pageFailed = Boolean(result.error) || result.hadErrors
                    || result.statusCode === 429 || result.statusCode >= 500;

                if (pageRows.length || !pageFailed || pageAttempt >= 3) break;
            }

            if (pageRows.length) {
                await pushInBatches(pageRows, DEFAULT_BATCH_SIZE);
                savedCount += pageRows.length;
            } else if (pageFailed) {
                log.warning(`Page ${pageNumber}: no results after retries; continuing.`);
            }

            log.info(`Page ${pageNumber}: kept ${pageRows.length} unique listings from ${cards.length} cards.`);

            if (!pageRows.length) {
                emptyPageStreak++;
                if (emptyPageStreak >= 2) break;
            } else {
                emptyPageStreak = 0;
            }

            if (cards.length < resultsSize && !pageFailed) break;
        }
    }

    if (!savedCount) {
        log.warning('No listings were extracted. Use the Unblocker proxy group and verify target dates/location.');
    }

    log.info(`Finished. Extracted ${savedCount} listing rows.`);
} catch (error) {
    failed = true;
    log.exception(error, 'Actor run failed');
} finally {
    await Actor.exit({ exitCode: failed ? 1 : 0 });
}
