/*
 Returns an AbortController when the browser provides one. Very old browsers (for example,
 Firefox 52) have no AbortController: requests cannot be cancelled there, so a stub with a no-op
 abort() and no signal is returned. Callers still detect superseded requests by comparing the
 request objects.
 */
function createAbortController() {
    if (typeof AbortController === 'undefined') {
        return {
            signal: undefined,
            abort: () => {
                // requests cannot be cancelled without AbortController
            },
        };
    }
    return new AbortController();
}

export {createAbortController};
