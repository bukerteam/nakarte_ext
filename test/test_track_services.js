import {SportsTrackerActivity} from '~/lib/leaflet.control.track-list/lib/services/sportstracker';
import Tracedetrail from '~/lib/leaflet.control.track-list/lib/services/tracedetrail';

const botProtectionPage = [
    '<!--Debug [[Security_Rule = "badbots"; More_info = "blocked"]] EndOfDebug-->',
    '<!DOCTYPE HTML>',
    '<html lang="en-US">',
    '<head>',
    '  <title>HTTP 403</title>',
    '</head>',
    '<body>',
    '  <h1>HTTP 403 - Access denied</h1>',
    '  <a href="https://faq.o2switch.fr/hebergement-mutualise/tutoriels-cpanel/tiger-protect">Tiger Protect</a>',
    '</body>',
    '</html>',
].join('\n');

function sportstrackerResponses(data, metadata) {
    return [
        {status: 200, responseBinaryText: JSON.stringify(data)},
        {status: 200, responseBinaryText: JSON.stringify(metadata)},
    ];
}

suite('Tracedetrail track service');

test('reports the bot protection page as a download failure', function () {
    const service = new Tracedetrail('https://tracedetrail.fr/en/trace/125395');
    const result = service.parseResponse([{status: 200, responseText: botProtectionPage}]);
    assert.deepEqual(result, [{name: 'Tracedetrail track 125395', error: 'NETWORK'}]);
});

test('parses a track page', function () {
    const page = [
        '<html><head><title>Weekend route: Forest ride</title></head>',
        '<body>',
        '<script>',
        'var track = {',
        'geometry : "[{\\"lon\\": 1, \\"lat\\": 2}, {\\"lon\\": 3, \\"lat\\": 4}]",',
        '};',
        '</script>',
        '</body></html>',
    ].join('\n');
    const service = new Tracedetrail('https://tracedetrail.fr/en/trace/125395');
    const result = service.parseResponse([{status: 200, responseText: page}]);
    assert.lengthOf(result, 1);
    assert.equal(result[0].name, 'Forest ride');
    assert.lengthOf(result[0].tracks, 1);
    assert.lengthOf(result[0].tracks[0], 2);
});

test('reports a page without the geometry as unsupported', function () {
    const service = new Tracedetrail('https://tracedetrail.fr/en/trace/125395');
    const result = service.parseResponse([{status: 200, responseText: '<html><body>hello</body></html>'}]);
    assert.deepEqual(result, [{name: 'Tracedetrail track 125395', error: 'UNSUPPORTED'}]);
});

suite('Sports Tracker track service');

test('reports a response without the track data as a download failure', function () {
    const service = new SportsTrackerActivity('https://www.sports-tracker.com/workout/tester/abcdef');
    const responses = sportstrackerResponses({error: 'Not authenticated'}, {});
    assert.deepEqual(service.parseResponse(responses), [{name: 'Sports Tracker activity', error: 'NETWORK'}]);
});

test('parses the track data and the description', function () {
    const service = new SportsTrackerActivity('https://www.sports-tracker.com/workout/tester/abcdef');
    const responses = sportstrackerResponses(
        {payload: {locations: [{la: 1, ln: 2}], description: 'Evening run'}},
        {payload: {startTime: '2026-10-01T10:00:00Z', fullname: 'tester'}}
    );
    const result = service.parseResponse(responses);
    assert.equal(result[0].name, 'Evening run');
    assert.deepEqual(result[0].tracks[0], [{lat: 1, lng: 2}]);
});

test('names the track after the metadata when there is no description', function () {
    const service = new SportsTrackerActivity('https://www.sports-tracker.com/workout/tester/abcdef');
    const responses = sportstrackerResponses(
        {payload: {locations: [{la: 1, ln: 2}]}},
        {payload: {startTime: '2026-10-01T10:00:00Z', fullname: 'tester'}}
    );
    const result = service.parseResponse(responses);
    assert.match(result[0].name, /^tester on /u);
});

test('keeps the default name when the metadata is missing', function () {
    const service = new SportsTrackerActivity('https://www.sports-tracker.com/workout/tester/abcdef');
    const responses = sportstrackerResponses({payload: {locations: [{la: 1, ln: 2}]}}, {});
    const result = service.parseResponse(responses);
    assert.equal(result[0].name, 'Sports Tracker activity');
    assert.lengthOf(result[0].tracks[0], 1);
});
