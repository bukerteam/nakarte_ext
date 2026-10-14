/*
 Text formatting helpers of the POI discovery panel. Distances are meters.
 */

import {t} from '~/lib/lang';

function formatDistance(meters) {
    if (!Number.isFinite(meters)) {
        return '';
    }
    const rounded = Math.round(meters);
    if (rounded < 1000) {
        return t(`${rounded} м`, `${rounded} m`);
    }
    return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} ${t('км', 'km')}`;
}

function formatKilometers(meters) {
    if (!Number.isFinite(meters)) {
        return '';
    }
    return `${(meters / 1000).toFixed(1)} ${t('км', 'km')}`;
}

export {formatDistance, formatKilometers};
