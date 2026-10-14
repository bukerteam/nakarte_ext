import BaseService from './baseService';
import {urlViaCorsProxy} from '~/lib/CORSProxy';
import L from 'leaflet';

/*
 The bot protection page of the hosting of tracedetrail (o2switch, the "Tiger Protect" rule
 "badbots"): the service refuses to serve the track page to the automated requests, so the answer
 is reported as a download failure instead of an unsupported page.
 */
function isBotProtectionPage(documentText) {
    return documentText.includes('Tiger Protect') || documentText.includes('Security_Rule = "badbots"');
}

class Tracedetrail extends BaseService {
    urlRe = /^https?:\/\/(?:www\.)?tracedetrail\.[a-z]{2,}.*\/(?:trace\/trace|trace|iframe)\/([0-9]+)/u;

    isOurUrl() {
        return this.urlRe.test(this.origUrl);
    }

    requestOptions() {
        return [{
            url: urlViaCorsProxy(this.origUrl),
            options: {
                isResponseSuccess: (xhr) => [200, 500].includes(xhr.status),
            },
        }];
    }

    parseResponse(responses) {
        const trackId = this.urlRe.exec(this.origUrl)[1];
        let name = `Tracedetrail track ${trackId}`;
        const response = responses[0];
        const documentText = response.responseText;
        try {
            // the hosting of the service answers the bot protection page instead of the track page
            // for automated requests, including the ones that go through a CORS proxy: there is no
            // track data in the answer at all
            if (isBotProtectionPage(documentText)) {
                return [{name, error: 'NETWORK'}];
            }
            const geometryMatch = /geometry\s*:\s*"(.+)",\n/u.exec(documentText);
            if (!geometryMatch) {
                let error = 'UNSUPPORTED';
                if (documentText.includes("track doesn't exist") || response.status === 500) {
                    error = '{name} was deleted or did not exist';
                } else if (documentText.includes('Private track')) {
                    error = '{name} is private';
                }
                return [{name, error}];
            }
            const encodedGeometry = geometryMatch[1];
            const titleMatch = /<title>.+:\s*(.+)<\/title>/u.exec(documentText);
            if (titleMatch) {
                name = titleMatch[1];
            }

            const geometry = JSON.parse(encodedGeometry.replaceAll('\\"', '"'));
            const proj = L.CRS.EPSG3857;
            const points = geometry.map((item) => proj.unproject(L.point(item.lon, item.lat)));

            return [{
                name,
                tracks: [points]
            }];
        } catch (e) {
            return [{name, error: 'UNSUPPORTED'}];
        }
    }
}

export default Tracedetrail;
