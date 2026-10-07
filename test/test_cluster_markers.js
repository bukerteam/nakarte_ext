import {clusterPoints} from '~/lib/cluster-markers';

suite('marker clustering');

function point(x, y) {
    return {x, y};
}

test('points within the radius are merged into one cluster', function () {
    const clusters = clusterPoints([point(0, 0), point(10, 0), point(20, 0)], 50);
    assert.lengthOf(clusters, 1);
    assert.lengthOf(clusters[0].points, 3);
});

test('distant points are not merged', function () {
    const clusters = clusterPoints([point(0, 0), point(100, 0), point(200, 0)], 50);
    assert.lengthOf(clusters, 3);
    for (const cluster of clusters) {
        assert.lengthOf(cluster.points, 1);
    }
});

test('cluster coordinates are the centroid of the members', function () {
    const clusters = clusterPoints([point(0, 0), point(10, 20)], 50);
    assert.lengthOf(clusters, 1);
    assert.equal(clusters[0].x, 5);
    assert.equal(clusters[0].y, 10);
});

test('radius is a circle, not a bounding box', function () {
    // (40, 40) fits into the bounding box of the radius but is farther than the radius from (0, 0)
    const clusters = clusterPoints([point(0, 0), point(40, 40)], 50);
    assert.lengthOf(clusters, 2);
});

test('greedy clustering keeps already clustered points together', function () {
    const clusters = clusterPoints([point(0, 0), point(60, 0), point(30, 0)], 40);
    // (0, 0) and (30, 0) are merged, (60, 0) is too far from both
    assert.lengthOf(clusters, 2);
    assert.lengthOf(clusters[0].points, 2);
    assert.lengthOf(clusters[1].points, 1);
});

test('empty input produces no clusters', function () {
    assert.deepEqual(clusterPoints([], 50), []);
});

test('every point belongs to exactly one cluster', function () {
    const points = [point(0, 0), point(10, 10), point(30, 0), point(100, 100), point(105, 100)];
    const clusters = clusterPoints(points, 25);
    const total = clusters.reduce((sum, cluster) => sum + cluster.points.length, 0);
    assert.equal(total, points.length);
});
