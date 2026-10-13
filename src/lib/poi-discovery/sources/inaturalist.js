/*
 iNaturalist source: observations of the species the user has not observed yet, in the ±15 day
 window around today (port of the reference implementation). The taxon with the most observations
 inside the search area is chosen, one point per observation of it; the description keeps the
 observation date and the time of day distribution.
 */

import {t} from '~/lib/lang';
import safeLocalStorage from '~/lib/safe-localstorage';

import {buildAreaCircles, buildCorridorCircles, isInsideBbox} from './circles';
import {clearRequest, requestJson, startSourceSearch} from './runner';
import {buildSegmentsIndex, projectOnSegments} from '../corridor';

const apiUrl = 'https://api.inaturalist.org/v2';
const usernameStorageKey = 'poiDiscoveryInaturalistUser';
const maxRadiusMeters = 25000;
const perPage = 200;
const maxPages = 3;
const requestDelay = 100;
const maxResults = 1000;
const categoryId = 'inat_species';
const windowDays = 15;

const timeBuckets = [
    {from: 4, to: 7, titleRu: 'Раннее утро', titleEn: 'Early morning'},
    {from: 8, to: 10, titleRu: 'Утро', titleEn: 'Morning'},
    {from: 11, to: 13, titleRu: 'Полдень', titleEn: 'Midday'},
    {from: 14, to: 16, titleRu: 'День', titleEn: 'Afternoon'},
    {from: 17, to: 19, titleRu: 'Вечер', titleEn: 'Evening'},
    {from: 20, to: 23, titleRu: 'Поздний вечер', titleEn: 'Late evening'},
    {from: 0, to: 3, titleRu: 'Ночь', titleEn: 'Night'},
];

let cachedUser = null;

function getUsername() {
    try {
        return (safeLocalStorage.getItem(usernameStorageKey) ?? '').trim();
    } catch (e) {
        return '';
    }
}

function setUsername(username) {
    try {
        if (username && username.trim()) {
            safeLocalStorage.setItem(usernameStorageKey, username.trim());
        } else {
            safeLocalStorage.removeItem(usernameStorageKey);
        }
    } catch (e) {
        // the storage is unavailable, the username is applied for the current session only
    }
    cachedUser = null;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/*
 The month numbers of the ±15 day window around today, so that the API returns the species of the
 current season.
 */
function getMonths(now = new Date()) {
    const months = new Set();
    for (let offset = -windowDays; offset <= windowDays; offset++) {
        months.add(new Date(now.getTime() + offset * 24 * 60 * 60 * 1000).getMonth() + 1);
    }
    return [...months];
}

function parseLocation(value) {
    const match = /^([-\d.]+),([-\d.]+)$/u.exec(value ?? '');
    if (!match) {
        return null;
    }
    return {lat: Number(match[1]), lon: Number(match[2])};
}

function getTimeBucket(timeObservedAt) {
    if (!timeObservedAt) {
        return null;
    }
    // the API returns UTC, the buckets describe the time of day at the place of the observation
    const date = new Date(timeObservedAt);
    const hour = Number.isNaN(date.getTime()) ? null : date.getHours();
    if (hour === null) {
        return null;
    }
    return timeBuckets.find((bucket) => hour >= bucket.from && hour <= bucket.to) ?? null;
}

function getTaxonName(taxon) {
    return taxon.preferred_common_name || taxon.name || '';
}

/*
 The taxon with the most observations: the reference implementation shows one species per search,
 the most observed one.
 */
function getMostFrequentTaxon(observations) {
    const counts = new Map();
    for (const observation of observations) {
        const taxon = observation.taxon;
        if (!taxon || !taxon.id) {
            continue;
        }
        const entry = counts.get(taxon.id) ?? {taxon, count: 0};
        entry.count += 1;
        counts.set(taxon.id, entry);
    }
    let best = null;
    for (const entry of counts.values()) {
        if (!best || entry.count > best.count) {
            best = entry;
        }
    }
    return best ? best.taxon : null;
}

/*
 The intervals with more than 20% of the observations, as in the reference implementation.
 */
function buildTimeDescription(observations) {
    const counts = new Map();
    for (const observation of observations) {
        const bucket = getTimeBucket(observation.time_observed_at);
        if (bucket) {
            counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
        }
    }
    const parts = [...counts.entries()]
        .filter(([, count]) => count / observations.length > 0.2)
        .sort((a, b) => b[1] - a[1])
        .map(([bucket, count]) => `${t(bucket.titleRu, bucket.titleEn)} (${count})`);
    if (!parts.length) {
        return t('Наблюдения в течение всего дня', 'Observed all day');
    }
    return t(`Время наблюдений: ${parts.join(', ')}`, `Observation time: ${parts.join(', ')}`);
}

function rememberUser(username, id) {
    cachedUser = {username, id};
}

async function getUserId(state, username) {
    if (cachedUser && cachedUser.username === username) {
        return cachedUser.id;
    }
    const query = `q=${encodeURIComponent(username)}&per_page=1`;
    const data = await requestJson(state, `${apiUrl}/users/autocomplete?${query}`);
    const id = data?.results?.[0]?.id;
    if (!id) {
        throw new Error(
            t(`Пользователь iNaturalist «${username}» не найден`, `iNaturalist user "${username}" was not found`)
        );
    }
    rememberUser(username, id);
    return id;
}

async function fetchObservations(state, {userId, circle, months, locale}) {
    const observations = [];
    const radiusKm = Math.max(0.1, circle.radiusMeters / 1000);
    const fields = [
        '(id:!t,taxon:(id:!t,preferred_common_name:!t,name:!t),location:!t,',
        'observed_on:!t,time_observed_at:!t)',
    ].join('');
    for (let page = 1; page <= maxPages; page++) {
        if (state.aborted) {
            throw new Error('search aborted');
        }
        const query = [
            `unobserved_by_user_id=${userId}`,
            `lat=${circle.lat.toFixed(5)}`,
            `lng=${circle.lng.toFixed(5)}`,
            `radius=${radiusKm.toFixed(1)}`,
            `month=${months.join(',')}`,
            'quality_grade=research',
            'order_by=id',
            'order=asc',
            `per_page=${perPage}`,
            `page=${page}`,
            `locale=${encodeURIComponent(locale)}`,
            `fields=${encodeURIComponent(fields)}`,
        ].join('&');
        const data = await requestJson(state, `${apiUrl}/observations?${query}`);
        const results = data?.results ?? [];
        observations.push(...results);
        if (results.length < perPage) {
            break;
        }
        await delay(requestDelay);
    }
    return observations;
}

function isObservationInArea(observation, params, projectionIndex) {
    const point = parseLocation(observation.location);
    if (!point) {
        return false;
    }
    if (params.mode === 'corridor') {
        return projectOnSegments({lat: point.lat, lng: point.lon}, projectionIndex).distance <= params.widthMeters;
    }
    return isInsideBbox(point, params.bbox);
}

const inaturalistSource = {
    id: 'inaturalist',
    titleRu: 'iNaturalist',
    titleEn: 'iNaturalist',
    attribution: '© iNaturalist contributors (CC BY-NC)',
    color: '#FF9800',
    isConfigured: () => Boolean(getUsername()),
    search: (params, context) => {
        const {onProgress} = context;
        const username = getUsername();
        const {circles, truncated: areaTruncated} =
            params.mode === 'corridor'
                ? buildCorridorCircles(params.segments, params.widthMeters)
                : buildAreaCircles(params.bbox, maxRadiusMeters);
        const projectionIndex =
            params.mode === 'corridor' ? buildSegmentsIndex(params.segments, params.widthMeters) : null;
        return startSourceSearch(async (state) => {
            const userId = await getUserId(state, username);
            const locale = (navigator.language || 'en').split('-')[0];
            const months = getMonths();
            const observations = [];
            let partial = false;
            for (let i = 0; i < circles.length; i++) {
                if (state.aborted) {
                    throw new Error('search aborted');
                }
                if (onProgress) {
                    onProgress({done: i, total: circles.length});
                }
                try {
                    const batch = await fetchObservations(state, {userId, circle: circles[i], months, locale});
                    observations.push(...batch);
                } catch (e) {
                    if (state.aborted || !observations.length) {
                        throw e;
                    }
                    partial = true;
                    break;
                }
            }
            clearRequest(state);
            // the circles overlap, the same observation can come from two of them
            const unique = new Map();
            for (const observation of observations) {
                if (!unique.has(observation.id)) {
                    unique.set(observation.id, observation);
                }
            }
            const inArea = [...unique.values()].filter((observation) =>
                isObservationInArea(observation, params, projectionIndex)
            );
            const taxon = getMostFrequentTaxon(inArea);
            const pois = [];
            if (taxon) {
                const taxonObservations = inArea.filter(
                    (observation) => observation.taxon && observation.taxon.id === taxon.id
                );
                const timeDescription = buildTimeDescription(taxonObservations);
                for (const observation of taxonObservations) {
                    const point = parseLocation(observation.location);
                    const poi = {
                        type: 'inaturalist',
                        id: observation.id,
                        lat: point.lat,
                        lon: point.lon,
                        tags: {name: getTaxonName(taxon)},
                        description: [
                            observation.observed_on
                                ? t(`Наблюдение: ${observation.observed_on}`, `Observed: ${observation.observed_on}`)
                                : '',
                            timeDescription,
                        ]
                            .filter(Boolean)
                            .join('\n'),
                        link: {
                            url: `https://www.inaturalist.org/observations/${observation.id}`,
                            text: t('Открыть в iNaturalist', 'Open in iNaturalist'),
                        },
                        categoryId,
                    };
                    if (params.mode === 'corridor') {
                        const projection = projectOnSegments({lat: point.lat, lng: point.lon}, projectionIndex);
                        pois.push({
                            ...poi,
                            sourceId: inaturalistSource.id,
                            distance: projection.distance,
                            alongMeters: projection.along,
                        });
                    } else {
                        pois.push({...poi, sourceId: inaturalistSource.id});
                    }
                }
            }
            if (onProgress) {
                onProgress({done: circles.length, total: circles.length, found: pois.length});
            }
            pois.sort((a, b) => (a.alongMeters ?? 0) - (b.alongMeters ?? 0));
            return {pois: pois.slice(0, maxResults), truncated: areaTruncated || pois.length > maxResults, partial};
        });
    },
};

export {
    buildTimeDescription,
    getMonths,
    getMostFrequentTaxon,
    getTimeBucket,
    getUsername,
    inaturalistSource,
    parseLocation,
    setUsername,
};
