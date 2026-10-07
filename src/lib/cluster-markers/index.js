import RBush from 'rbush';

function distanceSquared(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return dx * dx + dy * dy;
}

/*
 Groups points located within the given radius (in the same units as point coordinates) into clusters.
 Points are greedy merged around the first not yet clustered point, cluster coordinates are the
 centroid of the members. Returns an array of {points, x, y}, one entry per cluster.
 */
function clusterPoints(points, radius) {
    const index = new RBush();
    index.load(
        points.map((point, i) => ({
            minX: point.x,
            minY: point.y,
            maxX: point.x,
            maxY: point.y,
            i,
        }))
    );
    const visited = new Array(points.length).fill(false);
    const radiusSquared = radius * radius;
    const clusters = [];
    for (let i = 0; i < points.length; i++) {
        if (visited[i]) {
            continue;
        }
        const point = points[i];
        visited[i] = true;
        const members = [point];
        const neighbors = index.search({
            minX: point.x - radius,
            minY: point.y - radius,
            maxX: point.x + radius,
            maxY: point.y + radius,
        });
        for (const neighbor of neighbors) {
            if (visited[neighbor.i]) {
                continue;
            }
            const candidate = points[neighbor.i];
            if (distanceSquared(point, candidate) <= radiusSquared) {
                visited[neighbor.i] = true;
                members.push(candidate);
            }
        }
        let sumX = 0;
        let sumY = 0;
        for (const member of members) {
            sumX += member.x;
            sumY += member.y;
        }
        clusters.push({points: members, x: sumX / members.length, y: sumY / members.length});
    }
    return clusters;
}

export {clusterPoints};
