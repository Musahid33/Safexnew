'use client';

import { useEffect } from 'react';

/**
 * Deterrence for casual source browsing — not a security control.
 *
 * A browser must download the HTML, CSS and JavaScript it runs, so nobody can hide those
 * bytes from a determined visitor: devtools, `view-source:`, a proxy or `curl` all see the
 * same compiled files. What the deployment *can* do is already in place — no source maps, no
 * comments in the bundle, no server code or secret in the payload, and a minimal API surface.
 *
 * This component adds the last, weakest layer: the shortcuts a non-technical visitor uses to
 * peek. It is deliberately narrow so it never gets in the way of real work:
 *  - only runs in a production build, never in development;
 *  - form fields, links and buttons keep their normal context menu, so paste, spellcheck and
 *    "open in new tab" still work;
 *  - copy/paste, selection, zoom and assistive technology are untouched.
 */
export default function SourceGuard() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;

    const isEditable = (target: EventTarget | null) => {
      const element = target instanceof Element ? target : null;
      return Boolean(element?.closest('input, textarea, select, a, button, [contenteditable="true"]'));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F12') {
        event.preventDefault();
        return;
      }
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;
      const key = event.key.toLowerCase();
      // Ctrl/Cmd+Shift+I | J | C | K — the inspector, console, element picker and network panel.
      if (event.shiftKey && ['i', 'j', 'c', 'k'].includes(key)) {
        event.preventDefault();
        return;
      }
      // Ctrl/Cmd+Alt+I | J | C — the macOS inspector bindings.
      if (event.altKey && ['i', 'j', 'c'].includes(key)) {
        event.preventDefault();
        return;
      }
      // Ctrl/Cmd+U — view source.
      if (key === 'u') event.preventDefault();
    };

    const onContextMenu = (event: MouseEvent) => {
      if (isEditable(event.target)) return;
      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  return null;
}
