// Core: API client, shared state, DOM helpers, formatting, router, dialogs.
import { DICT, loadDict } from './i18n.js';
export const S = { boot: null, user: null, settings: {}, tree: null, csrf: '', lang: 'hu' };
try { S.lang = localStorage.getItem('ft_lang') || 'hu'; } catch (e) { /* storage blocked */ }
export async function setLang(l) { S.lang = l; try { localStorage.setItem('ft_lang', l); } catch (e) { } document.documentElement.lang = l; await loadDict(l); }

/**
 * Translate a UI string. Keys are the Hungarian texts; placeholders {0} {1} … are filled from args.
 *   T('Mentés')                     T('{0} fotó feltöltve.', n)
 * Missing translations fall back to Hungarian, so nothing ever shows up empty.
 */
export function T(key, ...args) {
  const d = DICT[S.lang];
  let s = (d && d[key]) || key;
  if (args.length) s = s.replace(/\{(\d+)\}/g, (m, i) => (args[+i] ?? ''));
  return s;
}
export const LANG_NAMES = { hu: 'magyar', en: 'angol', de: 'német' };

// ------------------------------------------------------------------ API
export async function api(action, data = null, opts = {}) {
  const url = 'api.php?a=' + encodeURIComponent(action) + (opts.query ? '&' + new URLSearchParams(opts.query) : '');
  const init = { credentials: 'same-origin', headers: { 'X-Lang': S.lang } };
  if (data !== null || opts.post) {
    init.method = 'POST';
    init.headers['X-CSRF'] = S.csrf;
    if (data instanceof FormData) init.body = data;
    else { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(data || {}); }
  }
  let res, j;
  try { res = await fetch(url, init); } catch (e) { throw new Error(T('Nincs kapcsolat a szerverrel.')); }
  try { j = await res.json(); } catch (e) { throw new Error(T('A szerver nem JSON-t küldött (') + res.status + ').'); }
  // stale or lost session token (e.g. the session expired in another tab): fetch a fresh one and retry once
  if (!j.ok && res.status === 419 && !opts.retried && action !== 'boot') {
    try { const b = await api('boot'); S.csrf = b.csrf; } catch (e) { /* fall through */ }
    return api(action, data, { ...opts, retried: true });
  }
  if (!j.ok) { const err = new Error(j.error || T('Hiba')); err.status = res.status; throw err; }
  return j.data;
}
export const op = (name, payload) => api('op', { name, payload });

// ------------------------------------------------------------------ DOM
// append/replaceChildren would print "null" for optional parts – skip empty values everywhere.
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const fn of ['append', 'replaceChildren', 'prepend']) {
    const orig = proto[fn];
    proto[fn] = function (...kids) { return orig.apply(this, kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false)); };
  }
}
export function h(tag, attrs, ...kids) {
  const el = tag === 'frag' ? document.createDocumentFragment() : (tag.startsWith('svg:') ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag));
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // only used with trusted, escaped strings
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  chat: '<path d="M4 5h16v11H10l-5 4v-4H4z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4.1M6.6 6.6A17.3 17.3 0 002 12s3.6 7 10 7a9.8 9.8 0 005.4-1.6M9.9 9.9a3 3 0 004.2 4.2"/>',
  pin: '<path d="M9 3h6l-1 6 4 4H6l4-4-1-6zM12 13v8"/>',
  photo: '<rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 17l-5-5-9 8"/>',
  tree: '<path d="M12 21v-7M12 14l-6-5M12 14l6-5M6 9V5M18 9V5M6 5h0M18 5h0"/><circle cx="6" cy="4" r="1.5"/><circle cx="18" cy="4" r="1.5"/><circle cx="12" cy="21" r="1.5"/>',
  birth: '<path d="M12 3v4M12 7c-3 0-5 2-5 5v6h10v-6c0-3-2-5-5-5zM5 21h14"/>',
  death: '<path d="M12 3v18M7 8h10"/>',
  rings: '<circle cx="9" cy="13" r="5"/><circle cx="15" cy="13" r="5"/>',
  water: '<path d="M12 3c-4 6-6 9-6 12a6 6 0 0012 0c0-3-2-6-6-12z"/>',
  star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.3l6-.7z"/>',
  book: '<path d="M4 4h6a3 3 0 013 3v13a2 2 0 00-2-2H4zM20 4h-6a3 3 0 00-3 3v13a2 2 0 012-2h7z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
  save: '<path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  left: '<path d="M15 5l-7 7 7 7"/>', right: '<path d="M9 5l7 7-7 7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>',
  ancestors: '<circle cx="5" cy="12" r="2"/><circle cx="14" cy="6" r="2"/><circle cx="14" cy="18" r="2"/><circle cx="21" cy="3" r="1.4"/><circle cx="21" cy="9" r="1.4"/><circle cx="21" cy="15" r="1.4"/><circle cx="21" cy="21" r="1.4"/><path d="M7 12h3v-6h2M10 12v6h2"/>',
  descendants: '<circle cx="12" cy="4" r="2"/><circle cx="5" cy="13" r="2"/><circle cx="19" cy="13" r="2"/><circle cx="3" cy="21" r="1.4"/><circle cx="8" cy="21" r="1.4"/><circle cx="19" cy="21" r="1.4"/><path d="M12 6v3H5v2M12 9h7v2"/>',
  hourglass: '<circle cx="12" cy="12" r="2.2"/><circle cx="6" cy="3" r="1.5"/><circle cx="18" cy="3" r="1.5"/><circle cx="6" cy="21" r="1.5"/><circle cx="18" cy="21" r="1.5"/><path d="M6 5l4 5M18 5l-4 5M10 14l-4 5M14 14l4 5"/>',
  fan: '<path d="M3 19a9 9 0 0118 0M7 19a5 5 0 0110 0M12 10v-6M5.6 12.6L2.4 9.4M18.4 12.6l3.2-3.2"/><circle cx="12" cy="19" r="1.5"/>',
  family: '<circle cx="7" cy="6" r="2.2"/><circle cx="17" cy="6" r="2.2"/><path d="M9.5 6h5M12 6v6M6 18h12M6 18v-4M12 12v6M18 18v-4"/><circle cx="6" cy="21" r="1.3"/><circle cx="12" cy="21" r="1.3"/><circle cx="18" cy="21" r="1.3"/>',
  relation: '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M6.5 6.5l3 3M11 11h2M14.5 14.5l3 3"/><circle cx="12" cy="12" r="1.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 .5c0 2-2.5 2-2.5 4M12 17h0"/>',
  silhouette: '<circle cx="12" cy="8.5" r="4.2"/><path d="M3.5 22c.8-5 4.1-7.5 8.5-7.5s7.7 2.5 8.5 7.5z"/>',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', name === 'silhouette' ? '0' : '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  if (name === 'silhouette') s.setAttribute('fill', 'currentColor');
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = ICONS[name] || '';
  return s;
}
export const ICON_SVG = ICONS;

// ------------------------------------------------------------------ text helpers
export const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
export const huCmp = (a, b) => String(a || '').localeCompare(String(b || ''), 'hu', { sensitivity: 'base' });

const HU_MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
const GED_M = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Parse a GEDCOM date as stored by the server ("16 SEP 1953", "ABT 1950", "BET 1900 AND 1910"). */
export function parseGed(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^BET\s+(.+)\s+AND\s+(.+)$/i);
  if (m) { const a = parseGed(m[1]), b = parseGed(m[2]); return a && b ? { ...a, q: 'BET', to: b } : null; }
  let q = '';
  m = s.match(/^(ABT|EST|CAL|BEF|AFT)\s+(.+)$/i);
  let rest = s;
  if (m) { q = m[1].toUpperCase(); rest = m[2]; }
  m = rest.match(/^(?:(\d{1,2})\s+)?(?:([A-Z]{3})\s+)?(\d{3,4})$/i);
  if (!m) return { text: s };
  return { y: +m[3], m: m[2] ? GED_M.indexOf(m[2].toUpperCase()) + 1 : 0, d: m[1] ? +m[1] : 0, q };
}
const MONTHS = {
  hu: HU_MONTHS,
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
};
/** One date in the UI language: "1953. szeptember 16." / "16 September 1953" / "16. September 1953". */
export function fmtDate(raw, lang = S.lang) {
  const p = typeof raw === 'object' ? raw : parseGed(raw);
  if (!p) return '';
  if (p.text) return p.text;
  const M = MONTHS[lang] || MONTHS.hu;
  const one = x => {
    if (!x.m) return String(x.y);
    if (lang === 'en') return (x.d ? x.d + ' ' : '') + M[x.m - 1] + ' ' + x.y;
    if (lang === 'de') return (x.d ? x.d + '. ' : '') + M[x.m - 1] + ' ' + x.y;
    return `${x.y}. ${M[x.m - 1]}${x.d ? ' ' + x.d + '.' : ''}`;
  };
  const main = one(p);
  const q = { hu: ['kb. {0}', '{0} előtt', '{0} után', '{0}–{1} között'], en: ['c. {0}', 'before {0}', 'after {0}', '{0}–{1}'], de: ['ca. {0}', 'vor {0}', 'nach {0}', 'zwischen {0} und {1}'] }[lang] || [];
  const f = (t, a, b) => t.replace('{0}', a).replace('{1}', b ?? '');
  if (p.q === 'ABT' || p.q === 'EST' || p.q === 'CAL') return f(q[0], main);
  if (p.q === 'BEF') return f(q[1], main);
  if (p.q === 'AFT') return f(q[2], main);
  if (p.q === 'BET') return f(q[3], main, one(p.to));
  return main;
}
/** Split a formatted date into [year, rest] for the timeline's date column. */
export function splitDate(text) {
  const m = String(text || '').match(/\b(\d{3,4})\b/);
  if (!m) return [text || '—', ''];
  const rest = String(text).replace(m[0], '').replace(/^[\s.,]+|[\s.,]+$/g, '').replace(/\s{2,}/g, ' ');
  return [m[1], rest];
}
/** Client-side preview of what the server will understand from free-text date input. */
export function previewDate(input) {
  const s = String(input || '').trim();
  if (!s) return { ok: true, text: '' };
  let q = '', t = s, m;
  const pre = [[/^(abt|about|ca\.?|circa|kb\.?|körülbelül|cca\.?)\s+/i, 'ABT'], [/^(bef|before|előtt)\s+/i, 'BEF'], [/^(aft|after|után)\s+/i, 'AFT'], [/^(est|becs\.?)\s+/i, 'ABT']];
  for (const [re, qq] of pre) if (re.test(t)) { q = qq; t = t.replace(re, ''); break; }
  if (!q) { if ((m = t.match(/^(.+?)\s+előtt$/))) { q = 'BEF'; t = m[1]; } else if ((m = t.match(/^(.+?)\s+után$/))) { q = 'AFT'; t = m[1]; } else if ((m = t.match(/^(.+?)\s+körül$/))) { q = 'ABT'; t = m[1]; } }
  if ((m = s.match(/^bet\s+(.+?)\s+and\s+(.+)$/i)) || (m = s.match(/^(.+?)\s*(?:–|-|és)\s*(.+?)\s+között$/))) {
    const a = simple(m[1]), b = simple(m[2]);
    if (a && b) return { ok: true, text: fmtDate({ ...a, q: 'BET', to: b }) };
  }
  const a = simple(t);
  if (!a) return { ok: false, text: T('Szövegként tárolom (nem ismert dátumforma).') };
  return { ok: true, text: fmtDate({ ...a, q }) };
  function simple(x) {
    x = x.trim(); let r;
    if ((r = x.match(/^(\d{3,4})\s*[.\-\/]\s*(\d{1,2})\s*(?:[.\-\/]\s*(\d{1,2}))?\s*\.?$/))) return { y: +r[1], m: +r[2], d: +(r[3] || 0) };
    if ((r = x.match(/^(\d{1,2})\s*[.\/]\s*(\d{1,2})\s*[.\/]\s*(\d{4})\.?$/))) return { y: +r[3], m: +r[2], d: +r[1] };
    if ((r = x.match(/^(\d{3,4})\.?\s+([a-záéíóöőúüű]+)\.?\s*(\d{1,2})?\.?$/i))) { const mm = monthNum(r[2]); if (mm) return { y: +r[1], m: mm, d: +(r[3] || 0) }; }
    if ((r = x.match(/^(?:(\d{1,2})\s+)?([a-z]{3,})\.?\s+(\d{3,4})$/i))) { const mm = monthNum(r[2]); if (mm) return { y: +r[3], m: mm, d: +(r[1] || 0) }; }
    if ((r = x.match(/^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{3,4})$/i))) { const mm = monthNum(r[1]); if (mm) return { y: +r[3], m: mm, d: +r[2] }; }
    if ((r = x.match(/^(\d{3,4})\.?$/))) return { y: +r[1], m: 0, d: 0 };
    return null;
  }
  function monthNum(w) {
    w = w.toLowerCase();
    const en = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], hu = ['jan', 'feb', 'már', 'ápr', 'máj', 'jún', 'júl', 'aug', 'szep', 'okt', 'nov', 'dec'];
    for (let i = 0; i < 12; i++) if (w.startsWith(en[i]) || w.startsWith(hu[i])) return i + 1;
    return 0;
  }
}
/** GEDCOM date → value shown in the edit field (Hungarian style). */
export function gedToInput(raw) {
  const p = parseGed(raw);
  if (!p) return '';
  if (p.text) return p.text;
  const one = x => x.y + (x.m ? '. ' + String(x.m).padStart(2, '0') + '.' + (x.d ? ' ' + String(x.d).padStart(2, '0') + '.' : '') : '');
  if (p.q === 'BET') return one(p) + '–' + one(p.to) + ' között';
  const v = one(p);
  return p.q === 'BEF' ? v + ' előtt' : p.q === 'AFT' ? v + ' után' : p.q ? 'kb. ' + v : v;
}

// ------------------------------------------------------------------ tree model
export function setTree(t) {
  const P = new Map(), F = new Map();
  for (const p of t.persons) P.set(p.id, p);
  for (const f of t.families) F.set(f.id, f);
  S.tree = { P, F, home: t.home, branch: new Set(t.branch || []) };
}
export async function loadTree(force = false) {
  if (S.tree && !force) return S.tree;
  setTree(await api('tree'));
  return S.tree;
}
export const P = id => S.tree?.P.get(+id);
export const F = id => S.tree?.F.get(+id);

export function personName(p, { short = false, withTitle = true } = {}) {
  if (!p) return T('Ismeretlen');
  let suffix = p.x || '';
  if (S.settings.hide_suffix_numbers && /^\d+$|^[IVX]+\.?$/.test(suffix)) suffix = '';
  const parts = S.settings.name_order === 'west' ? [p.g, p.s] : [p.s, p.g];
  let n = parts.filter(Boolean).join(' ');
  if (short && p.g) n = S.settings.name_order === 'west' ? p.g.split(' ')[0] + ' ' + (p.s || '') : (p.s || '') + ' ' + p.g.split(' ')[0];
  if (withTitle && p.t) n = p.t + ' ' + n;
  if (suffix) n += ' ' + suffix;
  return n.trim() || (p.masked ? T('Élő személy') : T('Névtelen'));
}
export function years(p) {
  if (!p) return '';
  if (p.masked) return T('élő');
  const b = p.b ? String(p.b) : (p.dec || p.d ? '?' : '');
  if (p.d) return `${b}–${p.d}`;
  if (p.dec) return b ? `${b}–?` : '†';
  return p.b ? T('sz. {0}', p.b) : '';
}
export const initials = p => ((p?.s || '')[0] || '') + ((p?.g || '')[0] || '');
export function parentsOf(id) {
  const p = P(id); const out = [];
  for (const fid of p?.fc || []) { const f = F(fid); if (f?.h) out.push(f.h); if (f?.w) out.push(f.w); }
  return out;
}
export function birthFamily(id) { const p = P(id); return p?.fc?.length ? F(p.fc[0]) : null; }
export function spouseIn(f, id) { return f ? (f.h === +id ? f.w : f.h) : null; }
export function childrenOf(id) { const out = []; for (const fid of P(id)?.fs || []) for (const c of F(fid)?.c || []) out.push(c); return out; }
export function siblingsOf(id) {
  const out = new Set();
  for (const fid of P(id)?.fc || []) for (const c of F(fid)?.c || []) if (c !== +id) out.add(c);
  return [...out];
}
export function photoStyle(p) {
  return p?.ph ? `object-position:${Math.round((p.fx ?? .5) * 100)}% ${Math.round((p.fy ?? .35) * 100)}%` : '';
}
export function avatar(p, size = 44) {
  const el = h('span', { class: 'av ' + (p?.sx || 'U'), style: `--sz:${size}px` });
  if (p?.ph) el.append(h('img', { src: p.ph, alt: '', loading: 'lazy', style: photoStyle(p) }));
  else el.append(initials(p) || '?');
  return el;
}
export function chip(id, extra = '') {
  const p = P(id);
  if (!p) return h('span', { class: 'muted' }, T('ismeretlen'));
  return h('a', { class: 'pchip', href: '#/person/' + p.id }, avatar(p, 40),
    h('span', { style: 'min-width:0' }, extra ? h('div', { class: 'rl' }, extra) : null, h('div', { class: 'nm' }, personName(p)), h('div', { class: 'yr' }, years(p))));
}
export function personLink(id) {
  const p = P(id);
  return p ? h('a', { href: '#/person/' + id }, personName(p)) : h('span', null, T('ismeretlen'));
}
export function familyLabel(f) {
  if (!f) return '';
  const a = f.h ? personName(P(f.h), { short: true }) : '?'; const b = f.w ? personName(P(f.w), { short: true }) : '?';
  return T("{0} és {1}", a, b);
}

// ------------------------------------------------------------------ markdown (tiny, escapes first)
export function md(src) {
  const lines = esc(src || '').replace(/\r/g, '').split('\n');
  const out = []; let para = [];
  const inline = s => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((#\/[^)\s]+|https?:\/\/[^)\s]+)\)/g, (m, t, u) => `<a href="${u}"${u.startsWith('http') ? ' rel="noopener" target="_blank"' : ''}>${t}</a>`);
  const flush = () => { if (para.length) { out.push('<p>' + inline(para.join('<br>')) + '</p>'); para = []; } };
  for (const l of lines) {
    let m;
    if (!l.trim()) { flush(); continue; }
    if ((m = l.match(/^(#{2,3})\s+(.*)$/))) { flush(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if ((m = l.match(/^&gt;\s?(.*)$/))) { flush(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
    para.push(l);
  }
  flush();
  return out.join('\n');
}

// ------------------------------------------------------------------ toasts & modals
export function toast(msg, kind = '') {
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 3500);
}
export function fail(e) { console.error(e); toast(e.message || String(e), 'bad'); }
/** Feedback after an op: applied directly or waiting for approval. */
export function opDone(res, okMsg) {
  if (res?.queued) { toast(T('Elküldve jóváhagyásra — az admin elfogadása után jelenik meg.'), 'pend'); return false; }
  if (res?.warning) { toast(res.warning, 'pend'); return true; }
  toast(okMsg || T('Mentve.'));
  return true;
}

export function modal({ title, body, actions = [], wide = false, onClose }) {
  const wrap = h('div', { class: 'modal-wrap', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const foot = actions.length ? h('div', { class: 'modal-f' }, actions.map(a => {
    const b = h('button', { class: 'btn ' + (a.cls || ''), type: a.submit ? 'submit' : 'button' }, a.label);
    b.addEventListener('click', async ev => {
      if (!a.onClick) return close();
      ev.preventDefault();
      b.disabled = true;
      try { const r = await a.onClick(); if (r !== false) close(); }
      catch (e) { fail(e); }
      finally { b.disabled = false; }
    });
    return b;
  })) : null;
  const m = h('div', { class: 'modal' + (wide ? ' wide' : '') },
    h('div', { class: 'modal-h' }, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': T('Bezárás'), onclick: close }, icon('close'))),
    h('div', { class: 'modal-b' }, body), foot);
  wrap.append(m);
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', onKey);
  $('#modal-root').append(wrap);
  setTimeout(() => { const f = m.querySelector('input:not([type=hidden]),select,textarea'); f && f.focus(); }, 30);
  return { close, el: m };
}
export function confirmBox(title, text, okLabel = T('Igen'), cls = 'btn-danger') {
  return new Promise(res => {
    let done = false;
    modal({ title, body: h('p', null, text), actions: [{ label: T('Mégse') }, { label: okLabel, cls, onClick: () => { done = true; res(true); } }], onClose: () => { if (!done) res(false); } });
  });
}
/** Banner inside an edit dialog telling the user what will happen to the change. */
export function modeNote(mode, kind) {
  if (mode === 'queue') return h('div', { class: 'mode-note' }, kind === 'delete' ? T('A törlés admin jóváhagyás után történik meg.') : T('A módosítás admin jóváhagyás után jelenik meg.'));
  return null;
}

// ------------------------------------------------------------------ form helpers
/** A password input with an eye button that shows / hides what was typed. */
export function pwInput(attrs = {}) {
  const inp = h('input', { type: 'password', autocapitalize: 'off', spellcheck: 'false', ...attrs });
  const btn = h('button', { type: 'button', class: 'pw-eye', 'aria-label': T('Jelszó megjelenítése'), title: T('Jelszó megjelenítése'), 'aria-pressed': 'false' }, icon('eye'));
  btn.addEventListener('mousedown', e => e.preventDefault()); // keep the focus (and the caret) in the field
  btn.addEventListener('click', () => {
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.replaceChildren(icon(show ? 'eyeoff' : 'eye'));
    const t = show ? T('Jelszó elrejtése') : T('Jelszó megjelenítése');
    btn.title = t; btn.setAttribute('aria-label', t); btn.setAttribute('aria-pressed', String(show));
  });
  // never leave a password readable when the form is sent or reset
  queueMicrotask(() => { const f = inp.form; if (!f) return; const hide = () => { if (inp.type === 'text') btn.click(); }; f.addEventListener('submit', hide, true); f.addEventListener('reset', hide); });
  return h('span', { class: 'pw-wrap' }, inp, btn);
}
export function field(label, input, help) { return h('label', { class: 'f' }, h('span', null, label), input, help ? h('small', null, help) : null); }
export function dateInput(name, raw) {
  const inp = h('input', { type: 'text', name, value: gedToInput(raw), placeholder: 'pl. 1953. 09. 16., 1950, kb. 1900', autocomplete: 'off' });
  const pv = h('div', { class: 'date-preview' });
  const upd = () => { const r = previewDate(inp.value); pv.textContent = r.text; pv.className = 'date-preview' + (r.ok ? '' : ' bad'); };
  inp.addEventListener('input', upd); upd();
  return h('div', null, inp, pv);
}
export function formData(form) {
  const o = {};
  for (const el of form.querySelectorAll('[name]')) {
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}
/** Searchable person picker. Returns {el, get(), set(id)} */
export function personPicker({ value = null, placeholder = T('Kezdd el gépelni a nevet…'), filter = null, onPick = null } = {}) {
  let cur = value ? +value : null;
  const inp = h('input', { type: 'text', placeholder, autocomplete: 'off' });
  const opts = h('div', { class: 'opts', hidden: true });
  const show = () => {
    const q = norm(inp.value);
    const all = [...S.tree.P.values()].filter(p => !filter || filter(p));
    const res = (q ? all.filter(p => norm(personName(p) + ' ' + (p.n || '') + ' ' + (p.b || '')).includes(q)) : all)
      .sort((a, b) => huCmp(personName(a), personName(b))).slice(0, 40);
    opts.replaceChildren(...res.map(p => h('button', { type: 'button', onmousedown: e => { e.preventDefault(); pick(p.id); } }, avatar(p, 28), h('span', null, personName(p), ' ', h('small', { class: 'muted' }, years(p))))));
    opts.hidden = !res.length;
  };
  const pick = (id, silent = false) => { cur = id; inp.value = id ? personName(P(id)) + (P(id)?.b ? ` (${P(id).b})` : '') : ''; opts.hidden = true; if (!silent && onPick) onPick(id); };
  inp.addEventListener('focus', show); inp.addEventListener('input', () => { cur = null; show(); });
  inp.addEventListener('blur', () => setTimeout(() => (opts.hidden = true), 120));
  if (cur) pick(cur, true);
  return { el: h('div', { class: 'picker' }, inp, opts), get: () => cur, set: id => pick(id, true), input: inp };
}

// ------------------------------------------------------------------ router
const routes = [];
export function route(pattern, fn, opts = {}) { routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), fn, opts }); }
export function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
let renderSeq = 0;
export async function render() {
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  const main = $('#main');
  const seq = ++renderSeq;
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    main.className = r.opts.full ? 'full' : '';
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === r.opts.nav));
    $('#mainnav').classList.remove('open');
    try {
      const out = await r.fn(...m.slice(1).map(decodeURIComponent), qs);
      if (seq !== renderSeq) return;
      if (out) main.replaceChildren(out);
    } catch (e) {
      if (seq !== renderSeq) return;
      if (e.status === 401) { go('#/login?next=' + encodeURIComponent(location.hash)); return; }
      main.replaceChildren(h('div', { class: 'empty', style: r.opts.full ? 'padding:40px max(16px, calc((100vw - 1180px) / 2))' : '' }, h('h2', null, T('Ez most nem sikerült')), h('p', null, e.message), h('a', { class: 'btn', href: '#/' }, T('Vissza a kezdőlapra'))));
    }
    if (!qs.get('keep')) window.scrollTo(0, 0);
    return;
  }
  main.replaceChildren(h('div', { class: 'empty' }, h('h2', null, T('Nincs ilyen oldal')), h('a', { class: 'btn', href: '#/' }, T('Kezdőlap'))));
}
export function setTitle(t) { document.title = (t ? t + ' – ' : '') + (S.settings.site_title || T('Családfa')); }

export const can = { edit: () => !!S.user, admin: () => S.user?.role === 'admin' };
