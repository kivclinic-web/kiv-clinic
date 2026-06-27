// Icon set — thin (1.9) line icons, rounded caps. Paths lifted from the prototype. No emoji.
import { html } from './vendor/preact-standalone.module.js';

export const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.2a3 3 0 0 1 0 5.6"/><path d="M21 20c0-2.4-1.3-4.2-3.3-5"/>',
  paw: '<circle cx="6" cy="10" r="1.8"/><circle cx="11" cy="7.5" r="1.8"/><circle cx="16" cy="9" r="1.8"/><path d="M11 12c-2.6 0-4.5 2-4.5 4.2C6.5 18 8 18.5 11 18.5s4.5-.5 4.5-2.3C15.5 14 13.6 12 11 12Z"/>',
  cal: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/>',
  stetho: '<path d="M5 3v5a4 4 0 0 0 8 0V3"/><path d="M9 16v1a4 4 0 0 0 8 0v-2"/><circle cx="19" cy="11" r="2"/>',
  syringe: '<path d="m18 2 4 4M17 7l-9.5 9.5M14 4l6 6M9 13l2 2M6.5 15.5 3 19l2 2 3.5-3.5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  chart: '<path d="M4 4v16h16"/><path d="M8 14v3M12 9v8M16 11v6"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M5 5l2 2M17 17l2 2M2 12h3M19 12h3M5 19l2-2M17 7l2-2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 7-2 7h16s-2-2-2-7Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pill: '<rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-45 12 12)"/><path d="M8.5 8.5 15.5 15.5"/>',
  warn: '<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17v.5"/>',
  drop: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11Z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L20 13l1 4v2a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-1Z"/>',
  scale: '<path d="M12 3v18M7 7h10M7 7 4 14h6ZM17 7l-3 7h6Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  menu: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  logout: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  trash: '<path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>'
};

/** Render an icon as an inline SVG vnode. */
export function Icon(name, size = 19) {
  const inner = PATHS[name] || PATHS.paw;
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"
    dangerouslySetInnerHTML=${{ __html: inner }} />`;
}
