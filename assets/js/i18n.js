// UI dictionaries, loaded on demand from assets/i18n/<lang>.json (the same files the PHP side uses).
// Keys are the Hungarian source strings; {0}, {1} … are placeholders.
export const DICT = { hu: {} };
export async function loadDict(lang) {
  if (lang === 'hu' || DICT[lang]) return;
  try {
    const v = new URL(import.meta.url).search;
    const r = await fetch(`assets/i18n/${lang}.json${v}`, { credentials: 'same-origin' });
    DICT[lang] = r.ok ? await r.json() : {};
  } catch (e) { DICT[lang] = {}; }
}
