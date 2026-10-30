import { useEffect, useRef } from 'react';

// Document-level event delegation for buttons that carry their action in a
// data attribute (e.g. data-backend-action="open-order-details"). This keeps the
// markup free of inline handlers and lets dynamically rendered rows share handlers.
export function useDelegatedClick(selector, handler) {
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    useEffect(() => {
        const onClick = event => {
            const element = event.target.closest(selector);
            if (!element || element.disabled) return;
            handlerRef.current(element, event);
        };
        document.addEventListener('click', onClick);
        return () => document.removeEventListener('click', onClick);
    }, [selector]);
}
