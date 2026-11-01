// Browser-side self-tests, run from the admin gear. Read-only on the loaded tree.
import { S, P, F, spouseIn as spouseOf, parseGed, fmtDate, previewDate, gedToInput, norm, md, personName, h } from './core.js';
import { layoutAncestors, layoutDescendants, layoutHourglass, layoutFamily, findPath, kinTerm, relationLabel, renderChart, buildExportSVG, fitGiven, SDX, SDY } from './charts.js';
import { distractors, buildQuiz, shuffle } from './quiz.js';

class AssertError extends Error { }
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new AssertError(`${m} várt: ${JSON.stringify(b)}, kapott: ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new AssertError(m || 'feltétel nem teljesült'); };

function overlaps(nodes) {
  // a person and the spouse cards tucked behind it form one unit; units must not overlap each other
  const units = [];
  for (const n of nodes) {
    if (n.spouse) continue;
    const sp = nodes.filter(s => s.spouse && s.of === n.id && Math.abs(s.x - n.x - s.layer * SDX) < 1 && Math.abs(s.y - n.y - s.layer * SDY) < 1);
    units.push({ ...n, w: n.w + sp.length * SDX, h: n.h + sp.length * SDY });
  }
  const uniq = [];
  for (const n of units) if (!uniq.some(u => u.x === n.x && u.y === n.y && u.id === n.id)) uniq.push(n);
  for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) {
    const a = uniq[i], b = uniq[j];
    if (a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5) return [a, b];
  }
  return null;
}
// pick a few well-connected people to exercise the layouts
function samples() {
  const ids = [S.tree.home, ...[...S.tree.P.values()].sort((a, b) => (b.fs.length + b.fc.length) - (a.fs.length + a.fc.length)).slice(0, 6).map(p => p.id)];
  return [...new Set(ids.filter(Boolean))];
}
const O = { up: 4, down: 3, photos: true, places: false, spouses: true };

const T = {
  'Dátum: GEDCOM értelmezés és magyar kiírás': () => {
    eq(fmtDate('16 SEP 1953'), '1953. szeptember 16.');
    eq(fmtDate('DEC 1902'), '1902. december');
    eq(fmtDate('1944'), '1944');
    eq(fmtDate('ABT 1950'), 'kb. 1950');
    eq(fmtDate('BEF 1900'), '1900 előtt');
    eq(fmtDate('BET 1900 AND 1910'), '1900–1910 között');
    eq(parseGed('5 MAR 2013'), { y: 2013, m: 3, d: 5, q: '' });
  },
  'Dátum: szabad szöveges bevitel előnézete': () => {
    eq(previewDate('1953. 09. 16.').text, '1953. szeptember 16.');
    eq(previewDate('1953-09-16').text, '1953. szeptember 16.');
    eq(previewDate('kb. 1920').text, 'kb. 1920');
    eq(previewDate('1956 után').text, '1956 után');
    eq(previewDate('1953. szeptember 16.').text, '1953. szeptember 16.');
    eq(previewDate('Sep 16 1953').text, '1953. szeptember 16.');
    ok(!previewDate('valamikor a háború előtt régen').ok, 'ismeretlen formát jelezni kell');
    eq(gedToInput('16 SEP 1953'), '1953. 09. 16.');
  },
  'Keresés: ékezet- és kisbetű-független': () => {
    eq(norm('  Csurgay  ÁRPÁD '), 'csurgay arpad');
    ok(norm('Szőke Győző').includes('gyozo'));
  },
  'Markdown: HTML-t nem enged át (XSS)': () => {
    const out = md('<img src=x onerror=alert(1)> **félkövér**\n\n## Cím');
    ok(!out.includes('<img'), 'nyers HTML maradt');
    ok(out.includes('&lt;img'), 'nincs escape-elve');
    ok(out.includes('<strong>félkövér</strong>'));
    ok(out.includes('<h2>Cím</h2>'));
    ok(!md('[x](javascript:alert(1))').includes('href="javascript'), 'javascript: link átment');
  },
  'Névformázás: sorrend, előtag, sorszám-utótag': () => {
    const keep = { ...S.settings };
    try {
      S.settings.name_order = 'hu'; S.settings.hide_suffix_numbers = true;
      eq(personName({ g: 'Árpád István', s: 'Csurgay', t: 'Dr.', x: '2' }), 'Dr. Csurgay Árpád István');
      S.settings.name_order = 'west';
      eq(personName({ g: 'Árpád', s: 'Csurgay', t: '', x: '' }), 'Árpád Csurgay');
    } finally { Object.assign(S.settings, keep); }
  },
  'Családfa: kapcsolatok kölcsönösen konzisztensek': () => {
    let n = 0;
    for (const f of S.tree.F.values()) {
      for (const c of f.c) { ok(P(c), `#${f.id} család gyermeke (#${c}) hiányzik`); ok(P(c).fc.includes(f.id), `#${c} famc nem tartalmazza #${f.id}-t`); n++; }
      for (const s of [f.h, f.w]) if (s) ok(P(s)?.fs.includes(f.id), `#${s} fams nem tartalmazza #${f.id}-t`);
    }
    for (const p of S.tree.P.values()) for (const fid of p.fc) ok(F(fid)?.c.includes(p.id), `#${p.id} szülői családja nem ismeri`);
    ok(S.tree.P.size === 0 || n >= 0);
  },
  'Diagram: felmenői fa dobozai nem fedik egymást': () => { for (const id of samples()) { const o = overlaps(layoutAncestors(id, O).nodes); ok(!o, `átfedés: #${o?.[0].id} és #${o?.[1].id} (gyökér #${id})`); } },
  'Diagram: leszármazotti fa dobozai nem fedik egymást': () => { for (const id of samples()) { const o = overlaps(layoutDescendants(id, O).nodes); ok(!o, `átfedés: #${o?.[0].id} és #${o?.[1].id} (gyökér #${id})`); } },
  'Diagram: homokóra dobozai nem fedik egymást': () => { for (const id of samples()) { const o = overlaps(layoutHourglass(id, { ...O, up: 3, down: 2 }).nodes); ok(!o, `átfedés: #${o?.[0].id} és #${o?.[1].id} (gyökér #${id})`); } },
  'Diagram: családlap dobozai nem fedik egymást': () => { for (const id of samples()) { const o = overlaps(layoutFamily(id, O).nodes); ok(!o, `átfedés a #${id} családlapján`); } },
  'Diagram: felmenői fa a gyökérrel indul és a szülőket tartalmazza': () => {
    const id = samples().find(i => P(i).fc.length); if (!id) return 'skip';
    const L = layoutAncestors(id, { ...O, up: 1 });
    ok(L.nodes.find(n => n.root)?.id === id);
    const f = F(P(id).fc[0]);
    for (const par of [f.h, f.w].filter(Boolean)) ok(L.nodes.some(n => n.id === par), 'hiányzó szülő #' + par);
  },
  'Nyelvek: dátum angolul és németül': () => {
    eq(fmtDate('16 SEP 1953', 'en'), '16 September 1953');
    eq(fmtDate('16 SEP 1953', 'de'), '16. September 1953');
    eq(fmtDate('ABT 1950', 'en'), 'c. 1950');
    eq(fmtDate('BET 1900 AND 1910', 'de'), 'zwischen 1900 und 1910');
    eq(fmtDate('BEF 1900', 'hu'), '1900 előtt');
  },
  'Nyelvek: rokonsági elnevezések angolul és németül': () => {
    eq(kinTerm(2, 0, 'F', 'en'), 'grandmother'); eq(kinTerm(3, 0, 'M', 'en'), 'great-grandfather'); eq(kinTerm(0, 2, 'U', 'en'), 'grandchild');
    eq(kinTerm(2, 2, 'M', 'en'), 'first cousin'); eq(kinTerm(2, 3, 'F', 'en'), 'first cousin once removed'); eq(kinTerm(2, 1, 'F', 'en'), 'aunt');
    eq(kinTerm(2, 0, 'F', 'de'), 'Großmutter'); eq(kinTerm(3, 0, 'M', 'de'), 'Urgroßvater'); eq(kinTerm(4, 0, 'M', 'de'), 'Ururgroßvater');
    eq(kinTerm(0, 3, 'M', 'de'), 'Urenkel'); eq(kinTerm(1, 2, 'F', 'de'), 'Nichte'); eq(kinTerm(2, 2, 'F', 'de'), 'Cousine 1. Grades');
  },
  'Nyelvek: a felület szótárában minden helykitöltő megvan': async () => {
    const miss = [];
    for (const lang of ['en', 'de']) {
      let d; try { d = await (await fetch(`assets/i18n/${lang}.json`)).json(); } catch (e) { miss.push(lang + ': hiányzik a szótár'); continue; }
      for (const [k, v] of Object.entries(d)) {
        const ph = x => (x.match(/\{\d+\}/g) || []).sort().join();
        if (!v) miss.push(`${lang}: üres – ${k}`); else if (ph(k) !== ph(v)) miss.push(`${lang}: helykitöltő – ${k}`);
      }
    }
    ok(!miss.length, miss.slice(0, 5).join('\n'));
  },
  'Diagram: házastárs-kártya a partnere mögött, jobbra-lent': () => {
    const id = [...S.tree.P.values()].find(p => p.fs.length && p.fs.some(f => spouseOf(F(f), p.id)))?.id;
    if (!id) return 'skip';
    const L = layoutDescendants(id, { up: 1, down: 1, photos: true, spouses: true });
    const root = L.nodes.find(n => n.root), sp = L.nodes.filter(n => n.spouse && n.of === id);
    ok(sp.length >= 1, 'nincs házastárs-kártya');
    sp.forEach(s => { eq(s.x - root.x, s.layer * SDX); eq(s.y - root.y, s.layer * SDY); });
  },
  'Diagram: három keresztnévből kettő, ha nem fér ki': () => {
    eq(fitGiven('Árpád István Ernő', 12), 'Árpád István');
    eq(fitGiven('Árpád István Ernő', 40), 'Árpád István Ernő');
    eq(fitGiven('Bence', 3), 'Be…');
  },
  'Rokonság: útkeresés és magyar rokonsági elnevezés': () => {
    const child = [...S.tree.P.values()].find(p => p.fc.length && F(p.fc[0])?.h);
    if (!child) return 'skip';
    const dad = F(child.fc[0]).h;
    const path = findPath(child.id, dad);
    eq(path.length, 2, 'szülő 1 lépés');
    eq(path[1].how, 'up');
    ok(relationLabel(path).includes(kinTerm(1, 0, P(dad).sx)));
    eq(kinTerm(2, 0, 'F'), 'nagyanyja'); eq(kinTerm(0, 2, 'M'), 'unokája'); eq(kinTerm(2, 2, 'M'), 'unokatestvére'); eq(kinTerm(1, 1, 'F'), 'lánytestvére'); eq(kinTerm(2, 1, 'M'), 'nagybátyja');
  },
  'Kvíz: zavaró válaszok – hasonló kor, azonos nem, egyedi nevek': () => {
    const mk = (id, sx, b, g) => ({ id, sx, b, g, s: 'Teszt' });
    const people = [mk(1, 'M', 1950, 'Ádám'), mk(2, 'M', 1952, 'Béla'), mk(3, 'M', 1948, 'Csaba'), mk(4, 'M', 1955, 'Dénes'), mk(5, 'F', 1950, 'Éva'), mk(6, 'M', 1890, 'Ferenc'), mk(7, 'M', 1951, 'Béla')];
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 20; k++) {
      const d = distractors(people[0], people, { band: 10, sameSex: true, rnd, nameOf: p => p.g });
      eq(d.length, 3);
      ok(!d.includes(people[0]), 'a helyes válasz nem lehet zavaró');
      ok(d.every(p => p.sx === 'M'), 'csak férfi lehet');
      ok(d.every(p => Math.abs(p.b - 1950) <= 10), 'korsávon kívüli');
      eq(new Set(d.map(p => p.g)).size, 3, 'ismétlődő név');
    }
  },
  'Kvíz: kérdéssor felépítése': () => {
    const pool = [...S.tree.P.values()].filter(p => p.ph);
    const all = [...S.tree.P.values()].filter(p => !p.masked);
    const src = pool.length >= 4 ? pool : all.slice(0, 30);
    if (src.length < 4) return 'skip';
    const q = buildQuiz(src, all, 10, { band: 15, sameSex: true });
    eq(q.length, Math.min(10, src.length));
    ok(q.every(x => x.options.length === 4 && x.options.includes(x.target)), '4 opció, benne a helyes');
    eq(new Set(q.map(x => x.target.id)).size, q.length, 'ugyanaz az arc kétszer');
    eq(shuffle([1, 2, 3, 4]).sort(), [1, 2, 3, 4]);
  },
  'Diagram: SVG renderelés és export': async () => {
    const id = S.tree.home; if (!id) return 'skip';
    const host = h('div', { style: 'position:fixed;left:-9999px;top:0;width:800px;height:600px' });
    document.body.append(host);
    try {
      for (const kind of ['hourglass', 'ancestors', 'descendants', 'fan', 'family']) {
        const c = renderChart(host, { kind, root: id, up: 3, down: 2, photos: false, interactive: false });
        ok(c.svg.querySelectorAll('.node').length > 0, kind + ': nincs doboz');
        const ex = await buildExportSVG(c.svg, c.bounds, { paper: '#fff', ink: '#000', muted: '#666', surface: '#fff' }, 'Teszt');
        ok(ex.text.startsWith('<?xml') && ex.text.includes('<svg'), kind + ': hibás SVG');
        ok(!ex.text.includes('color-mix'), kind + ': color-mix maradt az exportban');
        c.destroy();
      }
    } finally { host.remove(); }
  },
};

export async function runClientTests() {
  const out = [];
  const lang0 = S.lang; S.lang = 'hu'; // the expectations are written in Hungarian
  try {
  for (const [name, fn] of Object.entries(T)) {
    const t0 = performance.now();
    try { const r = await fn(); out.push({ name, status: r === 'skip' ? 'skip' : 'pass', ms: performance.now() - t0 }); }
    catch (e) { out.push({ name, status: 'fail', ms: performance.now() - t0, msg: e.message }); }
  }
  } finally { S.lang = lang0; }
  return out;
}
