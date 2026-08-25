// Runtime branding engine — applies appearance settings live (CSS vars, title, favicon)
import { getLang } from './i18n.js';

const DEFAULT_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%237c6cff'/%3E%3Cstop offset='1' stop-color='%2300c896'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='14' fill='url(%23g)'/%3E%3Ctext x='32' y='42' font-size='30' font-weight='bold' text-anchor='middle' fill='white' font-family='Arial'%3EJ7%3C/text%3E%3C/svg%3E";

let applied = {};

export function applyBranding(app) {
  if (!app) return;
  const root = document.documentElement;
  if (app.accent && applied.accent !== app.accent) {
    root.style.setProperty('--accent', app.accent);
    applied.accent = app.accent;
  }
  if (app.accent2 && applied.accent2 !== app.accent2) {
    root.style.setProperty('--accent-2', app.accent2);
    applied.accent2 = app.accent2;
  }
  if (app.appName && applied.name !== app.appName) {
    document.title = app.appName;
    applied.name = app.appName;
  }
  const favicon = app.logoUrl || DEFAULT_FAVICON;
  if (applied.favicon !== favicon) {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = favicon;
    applied.favicon = favicon;
  }
}

export function resetBranding() {
  applied = {};
  document.title = 'JIO CLUB';
}
