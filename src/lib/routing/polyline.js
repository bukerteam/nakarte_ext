const PRECISION = 1e6;

// Decodes a polyline with 6 digits precision (the format used by Valhalla for leg shapes).
function decodePolyline(shape) {
    const coordinates = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < shape.length) {
        let value = 0;
        let shift = 0;
        let byte;
        do {
            byte = shape.charCodeAt(index) - 63;
            index += 1;
            value |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lat += value & 1 ? ~(value >> 1) : value >> 1;

        value = 0;
        shift = 0;
        do {
            byte = shape.charCodeAt(index) - 63;
            index += 1;
            value |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lng += value & 1 ? ~(value >> 1) : value >> 1;

        coordinates.push([lng / PRECISION, lat / PRECISION]);
    }
    return coordinates;
}

export {decodePolyline};
