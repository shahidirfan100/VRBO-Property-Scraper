import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';
import { firefox } from 'playwright';

const VRBO_GRAPHQL_URL = 'https://www.vrbo.com/graphql';
const DEFERRED_SEARCH_RESULTS_HASH = '79d7f75261d4b71439afdd482c474ae0274c2ae9cc0e575cc1fccb54374cb7f6';

const DEFAULT_RESULTS_WANTED = 30;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_RESULTS_SIZE = 50;
const DEFAULT_RETRIES = 5;
const DEFAULT_BATCH_SIZE = 100;

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

function hasMeaningfulValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
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
    return new Promise((resolve) => setTimeout(resolve, ms));
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
        cleanString(input.location) ??
        cleanString(input.keyword) ??
        cleanString(url.searchParams.get('destination')) ??
        cleanString(url.searchParams.get('q'));

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

    const adults = toPositiveInt(input.adults ?? cleanString(url.searchParams.get('adults')), 2);
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
    const urls = [
        ...splitIntoList(input.property_listings_urls),
        ...splitIntoList(input.search_urls),
        ...splitIntoList(input.url),
    ]
        .map((item) => normalizeUrl(item))
        .filter(Boolean);

    if (urls.length) {
        return urls.map((url) => buildTargetFromInputUrl(url, input));
    }

    const destination = cleanString(input.location) ?? cleanString(input.keyword);
    if (!destination) return [];

    const now = new Date();
    const checkIn = cleanString(input.check_in) ?? toIsoDate(addDays(now, 30));
    const checkOut = cleanString(input.check_out) ?? toIsoDate(addDays(now, 33));
    const adults = toPositiveInt(input.adults, 2);
    const searchUrl = buildVrboSearchUrl({ destination, checkIn, checkOut, adults }).toString();

    return [{
        inputType: 'keyword_location',
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

async function loadFallbackInput() {
    try {
        const fallbackPath = new URL('../INPUT.json', import.meta.url);
        const parsed = JSON.parse(await readFile(fallbackPath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function mergeInputs(primary, fallback) {
    const merged = {};
    const keys = new Set([
        ...Object.keys(fallback ?? {}),
        ...Object.keys(primary ?? {}),
    ]);

    for (const key of keys) {
        const primaryValue = primary?.[key];
        const fallbackValue = fallback?.[key];
        merged[key] = hasMeaningfulValue(primaryValue) ? primaryValue : fallbackValue;
    }

    return merged;
}

function toCookieHeader(cookies) {
    const map = new Map();
    for (const cookie of cookies ?? []) {
        if (!cookie?.name || cookie?.value === undefined) continue;
        map.set(cookie.name, cookie.value);
    }

    return [...map.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function parseGraphQlBody(bodyText) {
    try {
        return JSON.parse(bodyText);
    } catch {
        return undefined;
    }
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

function cleanHeaders(rawHeaders, { referer, cookie, userAgent }) {
    const blocked = new Set([
        'content-length',
        'host',
        'connection',
        'accept-encoding',
        'cookie',
        'origin',
        'referer',
        'user-agent',
    ]);

    const headers = {};
    for (const [key, value] of Object.entries(rawHeaders ?? {})) {
        if (!key || value === undefined || value === null) continue;
        if (blocked.has(key.toLowerCase())) continue;
        headers[key.toLowerCase()] = String(value);
    }

    headers.accept = 'multipart/mixed;deferSpec=20220824,application/json';
    headers['content-type'] = 'application/json';
    headers.origin = 'https://www.vrbo.com';
    headers.referer = referer;
    headers['accept-language'] = headers['accept-language'] ?? 'en-US,en;q=0.9';
    headers['user-agent'] = userAgent;
    headers['client-info'] = headers['client-info'] ?? 'shopping-pwa,ea624da1e0c23debcf613a27651fb50f72015e57,us-east-1';
    headers['x-page-id'] = headers['x-page-id'] ?? 'page.Hotel-Search,H,20';
    headers['x-hcom-origin-id'] = headers['x-hcom-origin-id'] ?? 'page.Hotel-Search,H,20';
    headers['x-parent-brand-id'] = headers['x-parent-brand-id'] ?? 'vrbo';
    headers['x-product-line'] = headers['x-product-line'] ?? 'lodging';
    headers['ctx-view-id'] = headers['ctx-view-id'] ?? randomUUID();
    if (cookie) headers.cookie = cookie;

    return headers;
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
        if (String(item.__typename ?? '').includes('Placeholder')) return false;
        return true;
    });
}

function getSearchSummary(parts) {
    for (const part of parts) {
        const summary = part?.data?.propertySearch?.summary;
        if (summary) return summary;
    }

    return undefined;
}

function getFirstImageUrl(item) {
    return item?.mediaSection?.gallery?.media
        ?.map((entry) => cleanString(entry?.media?.url))
        .find(Boolean);
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
    const score = toNumber(section?.graphic?.text);
    const label = cleanString(section?.title?.shoppingProductTitle?.text);
    const reviewText = cleanString(section?.subtexts?.[0]?.shoppingProductTitle?.text);
    const reviewCount = reviewText ? toPositiveInt(reviewText.replace(/[^\d]/g, ''), 0) || undefined : undefined;

    return { score, label, reviewCount };
}

function getPriceDetails(item) {
    const summary = item?.priceSection?.priceSummary;
    const leadOption = summary?.options?.[0];
    const lineItems = summary?.displayMessages?.flatMap((entry) => entry?.lineItems ?? []) ?? [];

    const pricePerNight = toNumber(
        leadOption?.displayPrice?.formatted
        ?? lineItems.find((entry) => entry?.role === 'LEAD')?.price?.formatted,
    );

    const totalText = cleanString(lineItems.find((entry) => cleanString(entry?.value)?.includes(' for '))?.value);
    const priceTotal = totalText ? toNumber(totalText.match(/\$[\d,]+/)?.[0]) : undefined;

    const priceQualifier = cleanString(
        summary?.priceMessaging?.map((entry) => cleanString(entry?.value)).filter(Boolean).join(' | '),
    );

    const allFeesIncluded = lineItems.some((entry) => cleanString(entry?.value) === 'All fees included');

    return {
        pricePerNight,
        priceTotal,
        priceQualifier,
        allFeesIncluded,
    };
}

function getPropertyType(item) {
    const raw = cleanString(item?.headingSection?.messages?.[0]?.text);
    if (!raw) return undefined;
    return cleanString(raw.split('·')[0]);
}

function getSleepsInfo(item) {
    const raw = cleanString(item?.headingSection?.messages?.[0]?.text);
    const match = raw?.match(/Sleeps\s+(\d+)/i);
    return match ? Number(match[1]) : undefined;
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

    const mapped = deepClean({
        property_id: cleanString(String(item.id)),
        title: cleanString(item?.headingSection?.heading),
        listing_url: cleanString(item?.cardLink?.resource?.value),
        listing_path: cleanString(item?.cardLink?.resource?.relativePath),
        property_type: getPropertyType(item),
        sleeps: getSleepsInfo(item),
        location_text: getLocationText(item),
        review_score: review.score,
        review_label: review.label,
        review_count: review.reviewCount,
        price_per_night: price.pricePerNight,
        price_total: price.priceTotal,
        price_qualifier: price.priceQualifier,
        all_fees_included: price.allFeesIncluded,
        cancellation_policy: cancellationText,
        free_cancellation: cancellationText?.toLowerCase().includes('free cancellation') ? true : undefined,
        image_url: getFirstImageUrl(item),
        image_count: item?.mediaSection?.gallery?.media?.length,
        badge_text: cleanString(item?.mediaSection?.badges?.secondaryBadge?.text),
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

async function queryVrboListings({
    payload,
    cookieHeader,
    referer,
    userAgent,
    proxyConfiguration,
    proxySessionId,
    maxRetries,
}) {
    const headers = cleanHeaders({}, {
        referer,
        cookie: cookieHeader,
        userAgent,
    });

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const proxyUrl = proxyConfiguration
                ? await proxyConfiguration.newUrl(proxySessionId)
                : undefined;

            const response = await gotScraping({
                url: VRBO_GRAPHQL_URL,
                method: 'POST',
                headers,
                proxyUrl,
                body: JSON.stringify(payload),
                responseType: 'text',
                throwHttpErrors: false,
                timeout: { request: 45_000 },
                retry: { limit: 0 },
            });

            const parts = parseMultipartJson(response.body);

            if ((response.statusCode === 429 || response.statusCode >= 500) && attempt < maxRetries) {
                const waitMs = Math.min(1000 * 2 ** (attempt - 1), 12_000);
                log.warning(`GraphQL retry ${attempt}/${maxRetries} due to HTTP ${response.statusCode}.`);
                await sleep(waitMs);
                continue;
            }

            return {
                statusCode: response.statusCode,
                parts,
            };
        } catch (error) {
            if (attempt >= maxRetries) {
                return {
                    statusCode: 0,
                    parts: [],
                    error: error.message,
                };
            }

            const waitMs = Math.min(1000 * 2 ** (attempt - 1), 12_000);
            log.warning(`GraphQL retry ${attempt}/${maxRetries} failed: ${error.message}`);
            await sleep(waitMs);
        }
    }

    return {
        statusCode: 0,
        parts: [],
        error: 'Max retries reached.',
    };
}

async function pushInBatches(items, batchSize = DEFAULT_BATCH_SIZE) {
    const safeBatchSize = toPositiveInt(batchSize, DEFAULT_BATCH_SIZE);
    for (let index = 0; index < items.length; index += safeBatchSize) {
        await Actor.pushData(items.slice(index, index + safeBatchSize));
    }
}

function proxyUrlToLaunchOptions(proxyUrl) {
    if (!proxyUrl) return undefined;

    try {
        const parsed = new URL(proxyUrl);
        return {
            server: `${parsed.protocol}//${parsed.host}`,
            username: parsed.username || undefined,
            password: parsed.password || undefined,
        };
    } catch {
        return undefined;
    }
}

await Actor.init();

try {
    const userInput = (await Actor.getInput()) ?? {};
    const fallbackInput = await loadFallbackInput();
    const input = mergeInputs(userInput, fallbackInput);

    const resultsWanted = toPositiveInt(input.results_wanted, DEFAULT_RESULTS_WANTED);
    const maxPages = toPositiveInt(input.max_pages, DEFAULT_MAX_PAGES);
    const resultsSize = Math.min(toPositiveInt(input.results_size, DEFAULT_RESULTS_SIZE), DEFAULT_RESULTS_SIZE);
    const maxRetries = toPositiveInt(input.max_retries, DEFAULT_RETRIES);

    const targets = getTargets(input);
    log.info(`Loaded ${targets.length} target(s) from input.`);
    if (!targets.length) {
        throw new Error('Provide property_listings_urls, search_urls, url, or keyword/location input.');
    }

    const proxyInput = resolveProxyInput(input.proxyConfiguration);
    const proxyConfiguration = proxyInput?.useApifyProxy === false
        ? undefined
        : await Actor.createProxyConfiguration(proxyInput);

    const allRows = [];
    const seen = new Set();

    for (let index = 0; index < targets.length; index++) {
        if (allRows.length >= resultsWanted) break;

        const meta = targets[index];
        const proxySessionId = `vrbo_${index + 1}_${randomUUID().replace(/-/g, '')}`;
        const browserProxyUrl = proxyConfiguration
            ? await proxyConfiguration.newUrl(proxySessionId)
            : undefined;

        log.info(`Handling search page ${meta.searchUrl}`);

        const browser = await firefox.launch({
            headless: true,
            proxy: proxyUrlToLaunchOptions(browserProxyUrl),
        });

        try {
            const page = await browser.newPage();

            await page.route('**/*', (route) => {
                const type = route.request().resourceType();
                if (type === 'image' || type === 'font' || type === 'media') {
                    return route.abort();
                }
                return route.continue();
            });

            await page.goto(meta.searchUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
            await page.waitForTimeout(7_000);

            const cookies = await page.context().cookies(['https://www.vrbo.com']);
            const cookieHeader = toCookieHeader(cookies);
            const userAgent = await page.evaluate(() => navigator.userAgent);
            const duaid = cookies.find((cookie) => cookie.name === 'DUAID' || cookie.name === 'hav')?.value
                ?? randomUUID();
            const searchId = randomUUID();
            const currency = 'USD';

            let emptyPageStreak = 0;

            for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
                if (allRows.length >= resultsWanted) break;

                const startIndex = (pageNumber - 1) * resultsSize;
                const payload = buildDeferredSearchPayload({
                    searchUrl: meta.searchUrl,
                    duaid,
                    searchId,
                    startIndex,
                });
                const result = await queryVrboListings({
                    payload,
                    cookieHeader,
                    referer: meta.searchUrl,
                    userAgent,
                    proxyConfiguration,
                    proxySessionId,
                    maxRetries,
                });

                if (result.error) {
                    log.warning(`GraphQL request failed on page ${pageNumber}: ${result.error}`);
                }

                const cards = extractListingCards(result.parts);
                const summary = getSearchSummary(result.parts);
                if (pageNumber === 1 && summary?.propertyCount) {
                    log.info(`Search reported ${summary.propertyCount} total properties for ${meta.searchUrl}.`);
                }

                let addedThisPage = 0;

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
                    allRows.push(mapped);
                    addedThisPage++;

                    if (allRows.length >= resultsWanted) break;
                }

                log.info(`Page ${pageNumber}: kept ${addedThisPage} unique listings from ${cards.length} cards.`);

                if (!addedThisPage) {
                    emptyPageStreak++;
                    if (emptyPageStreak >= 2) break;
                } else {
                    emptyPageStreak = 0;
                }

                if (cards.length < resultsSize) break;
            }
        } finally {
            await browser.close();
        }
    }

    const finalItems = uniqueBy(allRows, (item) => item.property_id ?? item.listing_url)
        .slice(0, resultsWanted)
        .map((item) => deepClean(item))
        .filter(Boolean);

    if (!finalItems.length) {
        log.warning('No listings were extracted. Use residential proxies and verify target dates/location.');
    } else {
        await pushInBatches(finalItems, DEFAULT_BATCH_SIZE);
    }

    log.info(`Finished. Extracted ${finalItems.length} listing rows.`);
} finally {
    await Actor.exit();
}
