/**
 * The console's DM page.
 *
 * The design ships "DM" as an empty placeholder ("This section is ready for the workflow
 * and tools you want to add"). The daily management workflow already exists — it is a
 * Google Apps Script app (the EMVEESS DMP System) that safety supervisors use to fill the
 * 11-module Daily Management Plan and generate the PDF. Rebuilding that here would mean
 * maintaining two copies of a twelve-page controlled document, so the console hosts it
 * instead: a panel with the app in a frame, a reload, fullscreen, and a launcher that
 * always works if the frame is refused.
 *
 * Nothing about the DMP login belongs in this repository. The operator signs in to the
 * Apps Script app inside the frame; this module never sees, stores or forwards credentials.
 */

/** The company's DMP deployment. Override with NEXT_PUBLIC_DMP_URL without a rebuild of this file. */
export const DEFAULT_DMP_URL =
  'https://script.google.com/macros/s/AKfycbyKpFHGJlliJyzuDfYHn3eDaDyD12mfdviUQa44fpAd9JgyzQ5I2st65Rj-7XLrlqf9/exec';

/**
 * Only https is accepted. The URL is written into an iframe's `src`, so a `javascript:`
 * or `data:` value would be a script injection, not a configuration mistake.
 */
export function resolveDmpUrl(raw?: string | null): string {
  const value = (raw ?? '').trim();
  if (!value) return DEFAULT_DMP_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return DEFAULT_DMP_URL;
    return url.toString();
  } catch {
    return DEFAULT_DMP_URL;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Markup for the DM page.
 *
 * `embedded` false renders the launcher alone — for a deployment where the Apps Script
 * project has not been switched to `HtmlService.XFrameOptionsMode.ALLOWALL` and a frame
 * would only ever be a blank rectangle.
 */
export function dmPanelMarkup(url: string, options: { embedded?: boolean } = {}): string {
  const href = escapeHtml(resolveDmpUrl(url));
  const embedded = options.embedded !== false;

  const frame = embedded
    ? `<div class="sos-dm-frame" data-dm-frame>
        <div class="sos-dm-loading" data-dm-loading>Loading the DMP system…</div>
        <iframe src="${href}" title="EMVEESS Daily Management Plan"
          referrerpolicy="no-referrer-when-downgrade"
          allow="camera; microphone; fullscreen" loading="lazy"></iframe>
      </div>`
    : '';

  const hint = embedded
    ? `<p class="sos-dm-hint">Panel blank? The DMP app is not allowing itself to be embedded yet — open it in a new tab, or set
       <code>HtmlService.XFrameOptionsMode.ALLOWALL</code> in its <code>doGet()</code> and redeploy.</p>`
    : `<p class="sos-dm-hint">The DMP system opens in its own tab. Its sign-in stays inside the Google app — nothing is stored here.</p>`;

  return `<section class="sos-dm-panel" data-dm-url="${href}">
    <header class="sos-dm-bar">
      <div>
        <span class="sos-dm-eyebrow">DAILY MANAGEMENT</span>
        <h2>Daily Management Plan (DMP)</h2>
        <p>Permit review, tool box talk, PPE, walk-through, tools &amp; tackles, housekeeping, incident and training — one form, one PDF.</p>
      </div>
      <div class="sos-dm-actions">
        <a class="sos-dm-primary" href="${href}" target="_blank" rel="noopener noreferrer" data-dm-action="open">Conduct DM ↗</a>
        ${embedded ? '<button type="button" class="sos-dm-button" data-dm-action="reload">Reload</button>' : ''}
        ${embedded ? '<button type="button" class="sos-dm-button" data-dm-action="fullscreen">Fullscreen</button>' : ''}
      </div>
    </header>
    ${frame}
    ${hint}
  </section>`;
}

/**
 * Put the panel on the design's DM page and wire its two controls.
 *
 * Called after the design has rendered, because the design owns the page container. The
 * frame is only "loading"-masked until its first load event; after that the mask is gone
 * for good, so a refused frame shows the hint instead of a spinner that never stops.
 */
export function mountDmPage(container: HTMLElement, url: string, options: { embedded?: boolean } = {}): void {
  const page = container.querySelector<HTMLElement>('#dmPage');
  if (!page) return;

  page.innerHTML = dmPanelMarkup(url, options);
  const frame = page.querySelector<HTMLIFrameElement>('.sos-dm-frame iframe');
  const loading = page.querySelector<HTMLElement>('[data-dm-loading]');
  frame?.addEventListener('load', () => loading?.remove(), { once: true });

  page.querySelector<HTMLElement>('[data-dm-action="reload"]')?.addEventListener('click', () => {
    if (!frame) return;
    // Re-assign src rather than contentWindow.location: the frame is another origin.
    frame.src = resolveDmpUrl(url);
  });

  page.querySelector<HTMLElement>('[data-dm-action="fullscreen"]')?.addEventListener('click', () => {
    const target = page.querySelector<HTMLElement>('.sos-dm-frame');
    if (!target) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void target.requestFullscreen?.();
  });
}
