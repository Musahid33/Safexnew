/**
 * Icon sprite for the SafetyOS console.
 *
 * Lifted verbatim from the design file. Rendered once near the root so every
 * `<svg className="icon"><use href="#i-…" /></svg>` in the console resolves.
 */
export default function SafetyOsIcons() {
  return (
    <svg className="defs" aria-hidden="true" focusable="false">
      <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 2.5 20 5v6.4c0 5.2-3.3 8.6-8 10.8-4.7-2.2-8-5.6-8-10.8V5l8-2.5Z"/><path d="m8.2 11.8 2.4 2.4 5.1-5.2"/></symbol>
      <symbol id="i-dashboard" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="4" rx="1.3"/><rect x="13.5" y="10.5" width="7" height="10" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/></symbol>
      <symbol id="i-chart" viewBox="0 0 24 24"><path d="M4 19.5h16"/><path d="M6.5 16V9.5M12 16V5.5M17.5 16v-4"/><path d="m5.5 7 5.7-3 5.5 3 2.3-2"/></symbol>
      <symbol id="i-briefcase" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18M10 12v2h4v-2"/></symbol>
      <symbol id="i-cap" viewBox="0 0 24 24"><path d="m2.5 9.2 9.5-5 9.5 5-9.5 5-9.5-5Z"/><path d="M6.5 11.5v5c3.5 2.6 7.5 2.6 11 0v-5M21.5 9.5v6"/></symbol>
      <symbol id="i-users" viewBox="0 0 24 24"><path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20"/><circle cx="9" cy="7" r="3.5"/><path d="M17 11a3.5 3.5 0 1 0-1.1-6.8M22 20v-1.5a4 4 0 0 0-3-3.9"/></symbol>
      <symbol id="i-book" viewBox="0 0 24 24"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17Z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20M8 6h8M8 9h6"/></symbol>
      <symbol id="i-folder" viewBox="0 0 24 24"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5Z"/><path d="M3.5 9h17l-1.7 8.5H5.2L3.5 9Z"/></symbol>
      <symbol id="i-shield-alert" viewBox="0 0 24 24"><path d="M12 2.5 20 5v6.4c0 5.2-3.3 8.6-8 10.8-4.7-2.2-8-5.6-8-10.8V5l8-2.5Z"/><path d="M12 8v5m0 3.2h.01"/></symbol>
      <symbol id="i-scales" viewBox="0 0 24 24"><path d="M12 3v18M7 6h10M5 21h14M7 6 3.5 13h7L7 6Zm10 0-3.5 7h7L17 6Z"/><path d="M4 13c.5 2.1 2 3.2 3.5 3.2S10.5 15.1 11 13m2 0c.5 2.1 2 3.2 3.5 3.2S19.5 15.1 20 13"/></symbol>
      <symbol id="i-file" viewBox="0 0 24 24"><path d="M6 2.5h8l5 5v14H6a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2Z"/><path d="M14 2.5v5h5M8 13h8M8 17h8"/></symbol>
      <symbol id="i-award" viewBox="0 0 24 24"><circle cx="12" cy="8" r="5.5"/><path d="m8.5 12-1 9 4.5-2.7 4.5 2.7-1-9M9.5 8l1.6 1.6L14.8 6"/></symbol>
      <symbol id="i-message" viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-6 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h6"/></symbol>
      <symbol id="i-clipboard" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="18" rx="2"/><path d="M9 4V2h6v2M8 10h8M8 14h8M8 18h5"/></symbol>
      <symbol id="i-layout" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/></symbol>
      <symbol id="i-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.2 2.1-2 2-2.1-1.2h-.2l-2.4 1v.1L13.6 21h-2.8l-.4-2.1-2.4-1h-.2L5.7 19l-2-2 1.2-2.1v-.2l-1-2.4H1.8V9.5L4 9.1l1-2.4v-.2L3.8 4.4l2-2L8 3.6h.2l2.4-1 .4-2.1h2.8l.4 2.1 2.4 1h.2l2.1-1.2 2 2-1.2 2.1v.2l1 2.4 2.2.4v2.8l-2.2.4-1 2.4Z" transform="translate(1 1) scale(.92)"/></symbol>
      <symbol id="i-key" viewBox="0 0 24 24"><circle cx="7.5" cy="16.5" r="4.2"/><path d="m10.5 13.5 9-9M16 8l3 3m-6.5-.5 3 3"/></symbol>
      <symbol id="i-logout" viewBox="0 0 24 24"><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></symbol>
      <symbol id="i-pin" viewBox="0 0 24 24"><path d="M20 10c0 5.1-8 11.2-8 11.2S4 15.1 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></symbol>
      <symbol id="i-search" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></symbol>
      <symbol id="i-bell" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></symbol>
      <symbol id="i-chevron-down" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
      <symbol id="i-chevron-right" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></symbol>
      <symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></symbol>
      <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
      <symbol id="i-download" viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/></symbol>
      <symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 16V4m-5 5 5-5 5 5M4 20h16"/></symbol>
      <symbol id="i-calendar" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/></symbol>
      <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></symbol>
      <symbol id="i-checkcircle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16.5 8"/></symbol>
      <symbol id="i-alert" viewBox="0 0 24 24"><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 17.5h.01"/></symbol>
      <symbol id="i-flame" viewBox="0 0 24 24"><path d="M12 22a8 8 0 0 0 8-8c0-4.2-2.3-7.1-5.2-10-.3 3-1.6 4.1-2.8 5-1-3.1-3.1-5.4-5-6.7.2 3.4-3 6.4-3 11.7a8 8 0 0 0 8 8Z"/><path d="M10 17a2.5 2.5 0 0 0 5 0c0-1.5-1-2.4-2.5-3.5-.1 1.4-.8 2-1.3 2.2-.2-.9-.6-1.4-1.2-1.8"/></symbol>
      <symbol id="i-play" viewBox="0 0 24 24"><path d="m8 5 12 7-12 7V5Z"/></symbol>
      <symbol id="i-pdf" viewBox="0 0 24 24"><path d="M5 2.5h9l5 5v14H5a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2Z"/><path d="M14 2.5v5h5M6.5 17.5h2l1-5 1.2 5 1.2-5 1 5h3"/></symbol>
      <symbol id="i-edit" viewBox="0 0 24 24"><path d="m4 16.5-.8 4.3 4.3-.8L20 7.5 16.5 4 4 16.5Z"/><path d="m14.5 6 3.5 3.5M3 21h18"/></symbol>
      <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 14h11l1-14M9 7V4h6v3"/></symbol>
      <symbol id="i-filter" viewBox="0 0 24 24"><path d="M4 5h16M7 12h10m-7 7h4"/></symbol>
      <symbol id="i-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></symbol>
      <symbol id="i-bolt" viewBox="0 0 24 24"><path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/></symbol>
    </svg>
  );
}
