// Same-origin state-changing requests carry the session CSRF token. The wrapper is
// installed once per page before any component fetches data, exactly like the
// previous js/csrf.js, so every call site can keep using plain fetch().
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
// Mirrors the server-side exemption: the first-admin setup runs before any
// session exists, so it must not depend on loading a token first.
const csrfExemptPaths = new Set(['/setup-admin']);

export function installCsrfFetch(targetWindow = window) {
    if (targetWindow.__segnitzCsrfFetchInstalled) return;
    targetWindow.__segnitzCsrfFetchInstalled = true;

    const nativeFetch = targetWindow.fetch.bind(targetWindow);
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

    targetWindow.fetch = async (input, init) => {
        let request = new Request(input, init);
        const requestUrl = new URL(request.url, targetWindow.location.href);
        const sameOrigin = requestUrl.origin === targetWindow.location.origin;

        if (
            sameOrigin &&
            !safeMethods.has(request.method.toUpperCase()) &&
            !csrfExemptPaths.has(requestUrl.pathname)
        ) {
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
}
