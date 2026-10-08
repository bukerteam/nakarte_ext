import config from '~/config';
import safeLocalStorage from '~/lib/safe-localstorage';
import {fetch} from '~/lib/xhr-promise';

const storageKey = 'overpassNextgisKey';
const runtimeConfigUrl = 'config.json';

let runtimeKey = null;

function normalizeKey(key) {
    return typeof key === 'string' && key.trim() ? key.trim() : null;
}

/*
 The NextGIS key entered by the user in the POI panel. It is kept in the browser only.
 */
function getUserKey() {
    try {
        return normalizeKey(safeLocalStorage.getItem(storageKey));
    } catch (e) {
        return null;
    }
}

function setUserKey(key) {
    const normalized = normalizeKey(key);
    try {
        if (normalized) {
            safeLocalStorage.setItem(storageKey, normalized);
        } else {
            safeLocalStorage.removeItem(storageKey);
        }
    } catch (e) {
        // the storage is unavailable: the key is applied for the current session only
    }
    return normalized;
}

function getRuntimeKey() {
    return runtimeKey;
}

/*
 Loads the optional runtime configuration (config.json next to the site) and reads the key from
 it. A missing or broken file is not an error: the key simply stays unset.
 */
function loadRuntimeKey() {
    return fetch(runtimeConfigUrl, {responseType: 'json', maxTries: 1})
        .then((xhr) => {
            runtimeKey = normalizeKey(xhr.responseJSON && xhr.responseJSON.overpassNextgis);
            return runtimeKey;
        })
        .catch(() => {
            runtimeKey = null;
            return null;
        });
}

function getSiteKey() {
    return normalizeKey(config.overpassNextgis);
}

/*
 Key priority: the user key from the browser, then the runtime config, then the build-time one.
 */
function getEffectiveKey() {
    return getUserKey() || getRuntimeKey() || getSiteKey();
}

export {getUserKey, setUserKey, loadRuntimeKey, getSiteKey, getEffectiveKey};
