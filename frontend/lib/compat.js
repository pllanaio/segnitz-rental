import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

// The plain-JS pages exposed their renderers as globals that returned HTML strings.
// Scripts and browser tests still use a few of them, so they stay available and are
// now backed by the React components (rendered synchronously into a detached node).
export function renderToHtml(element) {
    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => root.render(element));
    const html = container.innerHTML;
    root.unmount();
    return html;
}

export function exposeGlobals(globals) {
    Object.assign(window, globals);
    return () => {
        Object.keys(globals).forEach(name => {
            if (window[name] === globals[name]) delete window[name];
        });
    };
}
