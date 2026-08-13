'use strict';

(() => {
    const nativeFetch = window.fetch.bind(window);
    const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
    let csrfToken = '';
    let csrfTokenLoaded = false;
    let csrfTokenRequest = null;

    async function loadCsrfToken() {
        if (csrfTokenLoaded) return csrfToken;
        if (csrfTokenRequest) return csrfTokenRequest;

        csrfTokenRequest = nativeFetch('/csrf-token', {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
        })
            .then(async response => {
                if (!response.ok) {
                    throw new Error(`CSRF-Token konnte nicht geladen werden (${response.status}).`);
                }

                const result = await response.json();
                csrfToken = String(result.csrfToken || '');
                csrfTokenLoaded = true;
                return csrfToken;
            })
            .finally(() => {
                csrfTokenRequest = null;
            });

        return csrfTokenRequest;
    }

    window.fetch = async (input, init) => {
        let request = new Request(input, init);
        const requestUrl = new URL(request.url, window.location.href);
        const sameOrigin = requestUrl.origin === window.location.origin;

        if (sameOrigin && !safeMethods.has(request.method.toUpperCase())) {
            const token = await loadCsrfToken();

            if (token) {
                const headers = new Headers(request.headers);
                headers.set('X-CSRF-Token', token);
                request = new Request(request, { headers });
            }
        }

        const response = await nativeFetch(request);
        const responseToken = String(response.headers.get('X-CSRF-Token') || '');

        if (responseToken) {
            csrfToken = responseToken;
            csrfTokenLoaded = true;
        }

        return response;
    };
})();
