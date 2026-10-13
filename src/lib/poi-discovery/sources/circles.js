/*
 Circle queries of the sources that search around a point (Wikidata, iNaturalist): the search
 area is covered by circles, the source queries every circle and the candidates are filtered by
 the real area afterwards.

 The circles are built so that they always cover their part of the area: the radius is computed
 for the latitude closest to the equator, where the part is the widest. The number of circles is
 capped, the caller reports the possible incompleteness.

 All distances are meters.
 */

import {chunkSegments, getBbox} from '../corridor';

const METERS_PER_DEGREE = 111320;
const defaultChunkLength = 20000;
const defaultMaxChunks = 10;
const defaultMaxCircles = 25;

function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
}

/*
 The circle around a bbox: the center of the box and the radius covering its corners.
 */
function bboxCircle(bbox) {
    const [south, west, north, east] = bbox;
    const centerLat = (south + north) / 2;
    const centerLng = (west + east) / 2;
    // the latitude closest to the equator gives the widest box in meters
    const widestLat = Math.abs(south) < Math.abs(north) ? south : north;
    const latMeters = (north - south) * METERS_PER_DEGREE;
    const lngMeters = (east - west) * METERS_PER_DEGREE * Math.cos(toRadians(widestLat));
    return {lat: centerLat, lng: centerLng, radiusMeters: Math.sqrt(latMeters ** 2 + lngMeters ** 2) / 2, bbox};
}

/*
 Returns the number of parts to split an axis of the given length into, so that every part fits
 into a circle of maxRadiusMeters.
 */
function splitCount(axisMeters, maxRadiusMeters) {
    // the half of the part must not exceed maxRadius/sqrt(2), so that the half-diagonal of the
    // part fits into the circle
    return Math.max(1, Math.ceil(axisMeters / (maxRadiusMeters * Math.SQRT2)));
}

/*
 Covers a bbox with circles of at most maxRadiusMeters: the axes are split independently, so a
 long narrow area does not produce a square grid of hundreds of circles. The number of circles is
 capped by maxCircles. Returns {circles, truncated}: truncated is true when the cap is hit and a
 part of the area is not covered by the query.
 */
function buildAreaCircles(bbox, maxRadiusMeters, maxCircles = defaultMaxCircles) {
    const [south, west, north, east] = bbox;
    const latSpan = Math.max(0, north - south);
    const lngSpan = Math.max(0, east - west);
    const widestLat = Math.abs(south) < Math.abs(north) ? south : north;
    const latMeters = latSpan * METERS_PER_DEGREE;
    const lngMeters = lngSpan * METERS_PER_DEGREE * Math.cos(toRadians(widestLat));
    let rows = splitCount(latMeters, maxRadiusMeters);
    let columns = splitCount(lngMeters, maxRadiusMeters);
    let truncated = false;
    while (rows * columns > maxCircles) {
        truncated = true;
        if (rows >= columns && rows > 1) {
            rows -= 1;
        } else if (columns > 1) {
            columns -= 1;
        } else {
            break;
        }
    }
    const circles = [];
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            circles.push(
                bboxCircle([
                    south + (latSpan * row) / rows,
                    west + (lngSpan * column) / columns,
                    south + (latSpan * (row + 1)) / rows,
                    west + (lngSpan * (column + 1)) / columns,
                ])
            );
        }
    }
    return {circles, truncated};
}

/*
 Covers the corridor with circles: every chunk of the track gets a circle around its bbox expanded
 by the corridor width. Returns {circles, truncated}: truncated is true when the chunks limit is
 hit and the rest of the track is not searched.
 */
function buildCorridorCircles(segments, widthMeters, maxChunks = defaultMaxChunks, chunkLength = defaultChunkLength) {
    const {chunks, truncated} = chunkSegments(segments, chunkLength, maxChunks);
    const circles = chunks.map((chunk) => {
        const circle = bboxCircle(getBbox(chunk.points));
        return {...circle, radiusMeters: circle.radiusMeters + widthMeters};
    });
    return {circles, truncated};
}

/*
 The bbox test of the area mode: a point may come with a wrapped longitude (the sources return
 -179.95 instead of 180.05 for the tracks that keep their longitudes unwrapped), so the shifted
 longitudes are checked too.
 */
function isInsideBbox(poi, bbox) {
    if (poi.lat < bbox[0] || poi.lat > bbox[2]) {
        return false;
    }
    return [0, 360, -360].some((offset) => poi.lon + offset >= bbox[1] && poi.lon + offset <= bbox[3]);
}

export {buildAreaCircles, buildCorridorCircles, isInsideBbox};
