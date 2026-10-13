/*
 Geometry helpers for the POI discovery search: cumulative distances along a polyline,
 sub-segment extraction by a distance range, the distance from a point to a polyline and
 splitting a polyline into chunks for separate Overpass queries.

 A track may consist of several parts (segments of a GPX file, polylines of one track) with gaps
 between them: the parts are kept separate, so the kilometer range and the position of a POI
 match the track length and the gaps are never interpolated as if they were part of the track.

 Points are plain {lat, lng} objects, distances are meters.
 */

import RBush from 'rbush';

const EARTH_RADIUS = 6371000;
const METERS_PER_DEGREE = 111320;

function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
}

/*
 Haversine distance between two points, in meters.
 */
function haversineDistance(a, b) {
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/*
 Initial bearing from a to b, in radians.
 */
function getBearing(a, b) {
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const dLng = toRadians(b.lng - a.lng);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return Math.atan2(y, x);
}

function interpolate(a, b, ratio) {
    return {lat: a.lat + (b.lat - a.lat) * ratio, lng: a.lng + (b.lng - a.lng) * ratio};
}

/*
 Cumulative distance from the start of the polyline to every point: [0, ...].
 */
function getCumulativeDistances(points) {
    const result = [];
    for (let i = 0; i < points.length; i++) {
        result.push(i === 0 ? 0 : result[i - 1] + haversineDistance(points[i - 1], points[i]));
    }
    return result;
}

/*
 Returns the part of the polyline between startMeters and endMeters, with the first and the last
 points interpolated when the range does not hit a vertex exactly (including a range that lies
 inside a single segment). Returns an empty array when the range lies outside the polyline.
 */
function extractSubSegment(points, startMeters, endMeters) {
    if (!points.length) {
        return [];
    }
    const cumulative = getCumulativeDistances(points);
    const result = [];
    for (let i = 0; i < points.length; i++) {
        if (cumulative[i] >= startMeters && cumulative[i] <= endMeters) {
            if (!result.length && i > 0 && cumulative[i - 1] < startMeters) {
                const ratio = (startMeters - cumulative[i - 1]) / (cumulative[i] - cumulative[i - 1]);
                result.push(interpolate(points[i - 1], points[i], ratio));
            }
            result.push({lat: points[i].lat, lng: points[i].lng});
        } else if (cumulative[i] > endMeters) {
            // the range starts and ends inside this segment: no vertex belongs to the range
            if (i > 0 && cumulative[i - 1] < startMeters) {
                const ratio = (startMeters - cumulative[i - 1]) / (cumulative[i] - cumulative[i - 1]);
                result.push(interpolate(points[i - 1], points[i], ratio));
            }
            if (i > 0 && cumulative[i - 1] <= endMeters) {
                const ratio = (endMeters - cumulative[i - 1]) / (cumulative[i] - cumulative[i - 1]);
                result.push(interpolate(points[i - 1], points[i], ratio));
            }
            break;
        }
    }
    return result;
}

/*
 Projects a point onto a polyline segment: returns the distance to the segment and the distance
 from the segment start to the projection, both in meters (cross-track/along-track formulas).
 */
function projectPointOnSegment(point, a, b, segmentLength) {
    if (segmentLength === 0) {
        return {distance: haversineDistance(point, a), along: 0};
    }
    const distanceToA = haversineDistance(a, point);
    if (distanceToA === 0) {
        return {distance: 0, along: 0};
    }
    const bearingDelta = getBearing(a, point) - getBearing(a, b);
    if (Math.cos(bearingDelta) < 0) {
        // the point lies behind the segment start, the closest point is the start itself
        return {distance: distanceToA, along: 0};
    }
    const crossTrack = Math.asin(Math.sin(distanceToA / EARTH_RADIUS) * Math.sin(bearingDelta)) * EARTH_RADIUS;
    const cosCrossTrack = Math.cos(crossTrack / EARTH_RADIUS);
    let alongTrack = distanceToA;
    if (cosCrossTrack !== 0) {
        const cosAlong = Math.cos(distanceToA / EARTH_RADIUS) / cosCrossTrack;
        alongTrack = Math.acos(Math.min(1, Math.max(-1, cosAlong))) * EARTH_RADIUS;
    }
    if (alongTrack > segmentLength) {
        return {distance: haversineDistance(point, b), along: segmentLength};
    }
    return {distance: Math.abs(crossTrack), along: alongTrack};
}

/*
 Returns {distance, along}: the distance from the point to the polyline and the distance from the
 polyline start to the closest point.
 */
function projectOnPolyline(point, points, cumulativeDistances) {
    if (!points.length) {
        return {distance: Infinity, along: 0};
    }
    if (points.length === 1) {
        return {distance: haversineDistance(point, points[0]), along: 0};
    }
    const cumulative = cumulativeDistances ?? getCumulativeDistances(points);
    let best = {distance: Infinity, along: 0};
    for (let i = 1; i < points.length; i++) {
        const segmentLength = cumulative[i] - cumulative[i - 1];
        const projection = projectPointOnSegment(point, points[i - 1], points[i], segmentLength);
        if (projection.distance < best.distance) {
            best = {distance: projection.distance, along: cumulative[i - 1] + projection.along};
        }
    }
    return best;
}

/*
 Bounding box of a polyline as [south, west, north, east].
 */
function getBbox(points) {
    let south = Infinity;
    let west = Infinity;
    let north = -Infinity;
    let east = -Infinity;
    for (const point of points) {
        south = Math.min(south, point.lat);
        west = Math.min(west, point.lng);
        north = Math.max(north, point.lat);
        east = Math.max(east, point.lng);
    }
    return [south, west, north, east];
}

/*
 Expands a bbox by widthMeters on every side. Longitudes are not clamped: a corridor crossing the
 antimeridian is split into valid parts by the query builder. Tracks loaded from files keep their
 longitudes unwrapped, so a track crossing the antimeridian works; a track that stores wrapped
 coordinates (for example one added by the route planner) is not supported.
 */
function expandBbox([south, west, north, east], widthMeters) {
    // the longitude padding is computed for the latitude closest to the pole, so that the queried
    // area is never smaller than the corridor
    const worstLat = Math.abs(south) > Math.abs(north) ? south : north;
    const latOffset = widthMeters / METERS_PER_DEGREE;
    const lngOffset = widthMeters / (METERS_PER_DEGREE * Math.max(0.01, Math.cos(toRadians(worstLat))));
    return [Math.max(-90, south - latOffset), west - lngOffset, Math.min(90, north + latOffset), east + lngOffset];
}

function getSegmentBbox(a, b, paddingMeters) {
    // the longitude padding is computed for the latitude closest to the pole, so that the bbox
    // never becomes smaller than the real padded area; the small margin covers the difference
    // between the meters per degree constants
    const worstLat = Math.abs(a.lat) > Math.abs(b.lat) ? a.lat : b.lat;
    const padding = paddingMeters * 1.02;
    const latOffset = padding / METERS_PER_DEGREE;
    const lngOffset = padding / (METERS_PER_DEGREE * Math.max(0.01, Math.cos(toRadians(worstLat))));
    return {
        minX: Math.min(a.lng, b.lng) - lngOffset,
        minY: Math.min(a.lat, b.lat) - latOffset,
        maxX: Math.max(a.lng, b.lng) + lngOffset,
        maxY: Math.max(a.lat, b.lat) + latOffset,
    };
}

class SegmentBush extends RBush {
    toBBox(segment) {
        return segment.bbox;
    }

    compareMinX(a, b) {
        return a.bbox.minX - b.bbox.minX;
    }

    compareMinY(a, b) {
        return a.bbox.minY - b.bbox.minY;
    }
}

/*
 Builds an index of the track parts. Every part keeps its own cumulative distances and the offset
 along the whole track, so the kilometer range and the position of a POI match the track length
 even when the parts have gaps between them.

 `parts` is a list of {points, offsetMeters}; the offset is accumulated from the previous parts
 when it is not given. With a positive paddingMeters the segments are also put into an r-tree
 expanded by this distance, so that projectOnSegments() can skip the segments that are farther
 than the corridor width.
 */
function buildSegmentsIndex(parts, paddingMeters = 0) {
    const index = {segments: [], tree: paddingMeters > 0 ? new SegmentBush(9) : null, totalMeters: 0};
    let offsetMeters = 0;
    for (const part of parts) {
        const {points} = part;
        if (!points.length) {
            continue;
        }
        const startOffset = part.offsetMeters ?? offsetMeters;
        const cumulative = getCumulativeDistances(points);
        index.segments.push({points, cumulative, offsetMeters: startOffset});
        offsetMeters = startOffset + cumulative[cumulative.length - 1];
    }
    index.totalMeters = offsetMeters;
    if (index.tree) {
        for (const entry of index.segments) {
            if (entry.points.length === 1) {
                // a part of a single point has no segments: it is indexed as a point
                const point = entry.points[0];
                index.tree.insert({
                    bbox: getSegmentBbox(point, point, paddingMeters),
                    entry,
                    segmentIndex: null,
                });
                continue;
            }
            for (let i = 1; i < entry.points.length; i++) {
                index.tree.insert({
                    bbox: getSegmentBbox(entry.points[i - 1], entry.points[i], paddingMeters),
                    entry,
                    segmentIndex: i,
                });
            }
        }
    }
    return index;
}

/*
 Returns the parts of the track between startMeters and endMeters (along the whole track): one
 sub-polyline per part that overlaps the range, with the offset of the sub-polyline start. Gaps
 between the parts are not interpolated.
 */
function extractSubSegments(index, startMeters, endMeters) {
    const result = [];
    for (const segment of index.segments) {
        const segmentLength = segment.cumulative[segment.cumulative.length - 1];
        const segmentStart = segment.offsetMeters;
        const segmentEnd = segmentStart + segmentLength;
        if (segmentEnd < startMeters || segmentStart > endMeters) {
            continue;
        }
        const from = Math.max(0, startMeters - segmentStart);
        const to = Math.min(segmentLength, endMeters - segmentStart);
        const points = extractSubSegment(segment.points, from, to);
        if (points.length) {
            result.push({points, offsetMeters: segmentStart + from});
        }
    }
    return result;
}

/*
 Splits the parts into chunks of at most chunkMeters along the whole track; chunks never cross the
 boundaries of the parts. Returns {chunks, truncated}: truncated is true when maxChunks is hit
 before the end of the track.
 */
function chunkSegments(parts, chunkMeters, maxChunks = Infinity) {
    const step = chunkMeters > 0 ? chunkMeters : 1;
    const chunks = [];
    let truncated = false;
    let offsetMeters = 0;
    for (const part of parts) {
        const partOffset = part.offsetMeters ?? offsetMeters;
        const cumulative = getCumulativeDistances(part.points);
        const partLength = cumulative.length ? cumulative[cumulative.length - 1] : 0;
        if (!partLength && part.points.length) {
            // a part of a single point (or of coincident points) still has to be searched
            if (chunks.length >= maxChunks) {
                truncated = true;
                break;
            }
            chunks.push({
                points: [{lat: part.points[0].lat, lng: part.points[0].lng}],
                startMeters: partOffset,
                endMeters: partOffset,
            });
            offsetMeters = partOffset;
            continue;
        }
        for (let localStart = 0; localStart < partLength; localStart += step) {
            if (chunks.length >= maxChunks) {
                truncated = true;
                break;
            }
            const localEnd = Math.min(localStart + step, partLength);
            chunks.push({
                points: extractSubSegment(part.points, localStart, localEnd),
                startMeters: partOffset + localStart,
                endMeters: partOffset + localEnd,
            });
        }
        offsetMeters = partOffset + partLength;
        if (truncated) {
            break;
        }
    }
    if (!chunks.length && parts.length && parts[0].points.length) {
        const first = parts[0];
        const firstOffset = first.offsetMeters ?? 0;
        chunks.push({
            points: [{lat: first.points[0].lat, lng: first.points[0].lng}],
            startMeters: firstOffset,
            endMeters: firstOffset,
        });
    }
    return {chunks, truncated};
}

/*
 Projects the point onto the track parts: with the r-tree (built with a padding not less than the
 corridor width) only the segments that can be close enough are checked, otherwise all the parts
 are walked through.
 */
function projectOnSegmentsOnce(point, index) {
    let best = {distance: Infinity, along: 0};
    if (index.tree) {
        const candidates = index.tree.search({minX: point.lng, minY: point.lat, maxX: point.lng, maxY: point.lat});
        for (const candidate of candidates) {
            const {entry, segmentIndex} = candidate;
            if (segmentIndex === null) {
                const distance = haversineDistance(point, entry.points[0]);
                if (distance < best.distance) {
                    best = {distance, along: entry.offsetMeters};
                }
                continue;
            }
            const segmentLength = entry.cumulative[segmentIndex] - entry.cumulative[segmentIndex - 1];
            const projection = projectPointOnSegment(
                point,
                entry.points[segmentIndex - 1],
                entry.points[segmentIndex],
                segmentLength
            );
            if (projection.distance < best.distance) {
                best = {
                    distance: projection.distance,
                    along: entry.offsetMeters + entry.cumulative[segmentIndex - 1] + projection.along,
                };
            }
        }
        return best;
    }
    for (const segment of index.segments) {
        const projection = projectOnPolyline(point, segment.points, segment.cumulative);
        if (projection.distance < best.distance) {
            best = {distance: projection.distance, along: segment.offsetMeters + projection.along};
        }
    }
    return best;
}

/*
 Returns {distance, along}: the distance from the point to the track parts and the position along
 the whole track. The longitude of the point is also tried shifted by ±360 degrees: the tracks
 loaded from files keep their longitudes unwrapped (180.05), while the sources return wrapped
 ones (-179.95).
 */
function projectOnSegments(point, index) {
    let best = {distance: Infinity, along: 0};
    for (const offset of [0, 360, -360]) {
        const shifted = offset === 0 ? point : {lat: point.lat, lng: point.lng + offset};
        const projection = projectOnSegmentsOnce(shifted, index);
        if (projection.distance < best.distance) {
            best = projection;
        }
    }
    return best;
}

export {
    buildSegmentsIndex,
    chunkSegments,
    expandBbox,
    extractSubSegment,
    extractSubSegments,
    getBbox,
    getCumulativeDistances,
    haversineDistance,
    projectOnPolyline,
    projectOnSegments,
};
