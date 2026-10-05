const ROUTE_COLORS = ['#1a73e8', '#d93025', '#188038', '#9334e6', '#e37400'];
const DEFAULT_ROUTE_COLOR = ROUTE_COLORS[0];

function formatDistance(meters) {
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
    }
    return `${Math.round(meters)} m`;
}

function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${minutes} min`;
    }
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export {DEFAULT_ROUTE_COLOR, formatDistance, formatDuration};
