/*
 Shared helpers of the POI sources that query their own APIs: a cancellable search handle and a
 JSON request that remembers the in-flight request, so that abort() cancels it.
 */

import {fetch} from '~/lib/xhr-promise';

const defaultTimeout = 30000;

/*
 Runs the queries of a source one by one and supports cancellation; the returned handle has the
 same shape as the searches in ../search ({promise, abort}). The promise settles right after
 abort(), even though the request of the source cannot be rejected (the result is ignored).
 */
function startSourceSearch(run) {
    const state = {aborted: false, request: null};
    let rejectAbort;
    const abortPromise = new Promise((resolve, reject) => {
        rejectAbort = reject;
    });
    const runPromise = run(state);
    runPromise.catch(() => {
        // the error is reported through the race below
    });
    const promise = Promise.race([runPromise, abortPromise]).then((result) => {
        if (state.aborted) {
            throw new Error('search aborted');
        }
        return result;
    });
    return {
        promise,
        abort: () => {
            if (state.aborted) {
                return;
            }
            state.aborted = true;
            if (state.request && typeof state.request.abort === 'function') {
                state.request.abort();
            }
            rejectAbort(new Error('search aborted'));
        },
    };
}

async function requestJson(state, url, options = {}) {
    const request = fetch(url, {responseType: 'json', timeout: defaultTimeout, ...options});
    state.request = request;
    const xhr = await request;
    return xhr.responseJSON;
}

/*
 Forgets the finished request, so that abort() does not touch a settled request.
 */
function clearRequest(state) {
    state.request = null;
}

export {clearRequest, requestJson, startSourceSearch};
