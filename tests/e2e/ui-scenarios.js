#!/usr/bin/env node
/**
 * UI scenario tests: builds typical and tricky family-tree situations ONLY through the user interface
 * (clicks and typing, like a family member would), then checks that exactly the right tree came out.
 *
 * It never touches real data: it copies the app into a temporary folder, starts its own PHP server there with an
 * empty SQLite database, installs it through the UI and works on that.
 *
 *   npm i -D playwright && npx playwright install chromium     (once)
 *   node tests/e2e/ui-scenarios.js            # all scenarios, report in tests/e2e/report/index.html
 *   node tests/e2e/ui-scenarios.js S6 S8      # only these
 *   HEADED=1 node tests/e2e/ui-scenarios.js   # watch it in a browser window
 *   PHP=/path/to/php node tests/e2e/ui-scenarios.js
 *
 * For every scenario the report shows: pass/fail of each structural check, how many clicks / typed fields /
 * questions it took, the dialogs that came up, error messages, screenshots, and usability notes.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'report');
const ONLY = process.argv.slice(2).filter(a => /^S\d+$/i.test(a)).map(a => a.toUpperCase());

// ------------------------------------------------------------------ a private copy of the app with an empty database
function copyApp(dst) {
  const skip = new Set(['.git', 'node_modules', 'config.php', 'tests']);
  const walk = (src, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (skip.has(e.name) && src === ROOT) continue;
      const s = path.join(src, e.name), d = path.join(to, e.name);
      if (e.isDirectory()) {
        if ((src === ROOT && (e.name === 'data' || e.name === 'uploads'))) {
          fs.mkdirSync(d, { recursive: true });
          for (const f of ['.htaccess', '.gitkeep']) if (fs.existsSync(path.join(s, f))) fs.copyFileSync(path.join(s, f), path.join(d, f));
          continue;
        }
        walk(s, d);
      } else fs.copyFileSync(s, d);
    }
  };
  walk(ROOT, dst);
  // no starting GEDCOM: the scenarios start from an empty tree
  for (const f of fs.readdirSync(dst)) if (f.toLowerCase().endsWith('.ged')) fs.unlinkSync(path.join(dst, f));
}
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

// ------------------------------------------------------------------ the driver: every action is counted
class Run {
  constructor(page, name, title) {
    this.p = page; this.name = name; this.title = title;
    this.clicks = 0; this.fields = 0; this.questions = []; this.dialogs = []; this.errors = []; this.notes = [];
    this.checks = []; this.shots = []; this.t0 = Date.now();
    this.stale = null;
  }
  async init() { this.stale = new Set(await this.p.locator('.toast').allTextContents()); }
  async click(loc, what) {
    this.clicks++;
    await loc.first().click();
    await this.p.waitForTimeout(250);
  }
  async type(sel, text) { this.fields++; await this.p.fill(sel, text); }
  async select(sel, value) { this.fields++; await this.p.selectOption(sel, value); }
  async shot(label) {
    const f = `${this.name}-${String(this.shots.length + 1).padStart(2, '0')}.png`;
    await this.p.screenshot({ path: path.join(OUT, f) });
    this.shots.push({ f, label });
  }
  async settle() {
    await this.p.waitForTimeout(700);
    // collect error toasts as they appear
    for (const t of await this.p.locator('.toast.bad').allTextContents()) if (!this.errors.includes(t) && !this.stale?.has(t)) this.errors.push(t);
  }
  /** The modal that is open now (title noted). */
  async dialog() {
    const m = this.p.locator('.modal').last();
    await m.waitFor({ state: 'visible', timeout: 5000 });
    const t = (await m.locator('h2, .modal-h').first().textContent().catch(() => '')).trim();
    this.dialogs.push(t);
    return m;
  }
  // ---- navigation
  async home() { await this.p.goto(this.base + '#/'); await this.settle(); }
  async openPerson(name, year) {
    await this.click(this.p.locator('#q'));
    this.fields++;
    await this.p.locator('#q').fill(name);
    await this.p.waitForTimeout(450);
    let a = this.p.locator('#qres a', { hasText: name });
    if (year) a = a.filter({ hasText: String(year) });
    if (!(await a.count())) throw new Error(`A keresőben nincs találat: ${name}${year ? ' (' + year + ')' : ''}`);
    await this.click(a);
    await this.settle();
  }
  // ---- the person dialog
  async fillPerson({ s, g, sx, b, d }, m) {
    if (s !== undefined) await this.type('.modal input[name=surname]', s);
    await this.type('.modal input[name=given]', g);
    if (sx) {
      const cur = await this.p.locator('.modal select[name=sex]').inputValue();
      if (cur !== sx) await this.select('.modal select[name=sex]', sx);
    }
    if (b) await this.type('.modal input[name=birth_date]', String(b));
    if (d) { await this.click(this.p.locator('.modal input[name=deceased]')); await this.type('.modal input[name=death_date]', String(d)); }
  }
  async save(label = 'Létrehozás') { await this.click(this.p.locator('.modal').last().locator(`button:has-text("${label}")`)); await this.settle(); }
  /** After adding a relative: if the app jumped to the new person's page, go back like a user would (1 click). */
  async stayOn(hashBefore) {
    const now = await this.p.evaluate(() => location.hash);
    if (now !== hashBefore) {
      if (!this.notes.some(n => n.k === 'jump')) this.notes.push({ k: 'jump', t: 'Rokon felvétele után a program átugrik az új személy oldalára – a következő rokonhoz (pl. a második szülőhöz, a következő gyerekhez) vissza kell lépni.' });
      this.jumps = (this.jumps || 0) + 1;
      this.clicks++;
      await this.p.goto(this.base + hashBefore); await this.settle();
    }
  }
  here() { return this.p.evaluate(() => location.hash); }
  /** Answer a choice dialog by the visible text of the option (or keep the first one). */
  async answer(optionText) {
    const m = await this.dialog();
    const opts = await m.locator('.choice').allTextContents();
    this.questions.push({ q: this.dialogs[this.dialogs.length - 1], options: opts.map(o => o.trim()), chose: optionText || opts[0]?.trim() });
    if (optionText) await this.click(m.locator('.choice', { hasText: optionText }));
    await this.click(m.locator('button:has-text("Tovább")'));
    await this.p.waitForTimeout(400);
  }
  // ---- the buttons on a person page
  async addFirst(person) {
    await this.home();
    await this.click(this.p.locator('button:has-text("Első személy")'));
    await this.dialog();
    await this.fillPerson(person);
    await this.save();
  }
  /** "Apa hozzáadása" / "Anya hozzáadása"; untick: sibling names to untick in "A testvéreknek is szülője?" */
  async addParent(person, { answer, sex, untick = [] } = {}) {
    const back = await this.here();
    const sx = sex || person?.sx;
    const btn = this.p.locator(`button:has-text("${sx === 'F' ? 'Anya hozzáadása' : 'Apa hozzáadása'}")`);
    if (!(await btn.count())) throw new Error(`Nincs „${sx === 'F' ? 'Anya' : 'Apa'} hozzáadása” gomb`);
    await this.click(btn);
    if (answer !== undefined) await this.answer(answer);
    if (answer && !/új személy/i.test(answer) && !/meglévő/i.test(answer)) { await this.settle(); return; }
    const m = await this.dialog();
    // usability: the form already knows it is a father / a mother
    const cur = await m.locator('select[name=sex]').inputValue();
    if (cur !== sx && !this.notes.some(n => n.k === 'parent-sex')) this.notes.push({ k: 'parent-sex', t: `Az ${sx === 'F' ? 'Anya' : 'Apa'} gomb után a „Nem” mező nem ${sx}, hanem ${cur}.` });
    this.sibAsked = await m.locator('.kid-pick').count() > 0;
    for (const k of untick) await this.click(m.locator('.kid-pick label', { hasText: k }).locator('input'));
    await this.fillPerson(person);
    await this.save();
    await this.stayOn(back);
  }
  async addSpouse(person, { common = [] } = {}) {
    const back = await this.here();
    await this.click(this.p.locator('.btn:has-text("Házastárs")'));
    const m = await this.dialog();
    for (const k of common) await this.click(m.locator('.kid-pick label', { hasText: k }).locator('input'));
    await this.fillPerson(person);
    await this.save();
    await this.stayOn(back);
  }
  async addChild(person, { answer } = {}) {
    const back = await this.here();
    await this.click(this.p.locator('.btn:has-text("Gyermek")'));
    if (answer !== undefined) await this.answer(answer);
    await this.dialog();
    await this.fillPerson(person);
    await this.save();
    await this.stayOn(back);
  }
  async linkExisting(kind, otherName, { common = [], answer } = {}) {
    await this.click(this.p.locator('button:has-text("Meglévő személy")'));
    const m = await this.dialog();
    await this.select('.modal select', { spouse: 'spouse', child: 'child', parent: 'parent' }[kind]);
    this.fields++;
    await m.locator('.picker input').fill(otherName);
    await this.p.waitForTimeout(300);
    await this.click(m.locator('.picker .opts button', { hasText: otherName }));
    for (const k of common) await this.click(m.locator('.kid-pick label', { hasText: k }).locator('input'));
    await this.click(m.locator('button:has-text("Kapcsolás")'));
    if (answer !== undefined) await this.answer(answer);
    await this.settle();
  }
  async editFamilyKid(kidName, optionText) {
    await this.click(this.p.locator('button:has-text("Szerkesztés")'));
    const m = await this.dialog();
    const row = m.locator('.kid-row', { hasText: kidName });
    const sel = row.locator('select');
    const opt = (await sel.locator('option').allTextContents()).find(o => o.includes(optionText));
    if (!opt) throw new Error(`Nincs ilyen választás: ${optionText}`);
    this.fields++;
    await sel.selectOption({ label: opt });
    await this.save('Mentés');
  }
  // ---- checking the result through the API (what the tree really became)
  async tree() {
    return this.p.evaluate(async () => (await (await fetch('api.php?a=tree')).json()).data);
  }
  async expect(desc, fn) {
    const t = await this.tree();
    const nm = id => { const p = t.persons.find(x => x.id === id); return p ? `${p.s} ${p.g}`.trim() : null; };
    const by = (full, year) => t.persons.filter(p => `${p.s} ${p.g}`.trim() === full && (!year || p.b === year));
    const one = (full, year) => { const r = by(full, year); if (r.length !== 1) throw new Error(`${full}${year ? ' (' + year + ')' : ''}: ${r.length} ilyen személy van, 1 kellene`); return r[0]; };
    const parents = (full, year) => { const p = one(full, year); return p.fc.flatMap(fid => { const f = t.families.find(x => x.id === fid); return [f.h, f.w].filter(Boolean).map(nm); }).sort(); };
    const spouses = (full, year) => { const p = one(full, year); return p.fs.map(fid => { const f = t.families.find(x => x.id === fid); return nm(f.h === p.id ? f.w : f.h); }).filter(Boolean).sort(); };
    const kidsOf = (a, b) => { const A = one(a), B = one(b); const f = t.families.find(x => (x.h === A.id && x.w === B.id) || (x.h === B.id && x.w === A.id)); return f ? f.c.map(nm).sort() : null; };
    const api = { t, nm, one, parents, spouses, kidsOf };
    let ok = true, msg = '';
    try { const r = await fn(api); if (r !== true && r !== undefined) { ok = false; msg = String(r); } } catch (e) { ok = false; msg = e.message; }
    this.checks.push({ desc, ok, msg });
    return ok;
  }
  /** Things that should never be in a tree: the same couple twice, families with nobody, a child with 3+ parents. */
  async integrity() {
    await this.expect('Épség: nincs dupla házaspár, üres család, 2-nél több szülő', ({ t, nm }) => {
      const seen = new Map(), bad = [];
      for (const f of t.families) {
        if (f.h && f.w) { const k = [f.h, f.w].sort().join('-'); if (seen.has(k)) bad.push(`dupla család: ${nm(f.h)} + ${nm(f.w)}`); seen.set(k, f.id); }
        if (!f.c.length && (!f.h || !f.w)) bad.push(`üres/egyszülős gyerektelen család #${f.id}`);
      }
      for (const p of t.persons) {
        const ps = new Set(p.fc.flatMap(fid => { const f = t.families.find(x => x.id === fid); return [f.h, f.w].filter(Boolean); }));
        if (ps.size > 2) bad.push(`${nm(p.id)}: ${ps.size} szülő`);
      }
      return bad.length ? bad.join('; ') : true;
    });
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b) || `kapott: ${JSON.stringify(a)}, várt: ${JSON.stringify(b)}`;

// ------------------------------------------------------------------ the scenarios
const SCENARIOS = [
  ['S1', 'Első személy és két szülő', async r => {
    await r.addFirst({ s: 'Kovács', g: 'Péter', sx: 'M', b: 1950 });
    await r.shot('Kovács Péter létrehozva');
    await r.addParent({ s: 'Kovács', g: 'János', sx: 'M', b: 1920 });
    await r.addParent({ s: 'Nagy', g: 'Mária', sx: 'F', b: 1925 });
    await r.shot('Két szülő felvéve');
    await r.expect('Péter szülei: János és Mária', ({ parents }) => eq(parents('Kovács Péter'), ['Kovács János', 'Nagy Mária']));
    await r.expect('János és Mária házastársak (a közös gyerek miatt)', ({ spouses }) => eq(spouses('Kovács János'), ['Nagy Mária']));
  }],
  ['S2', 'Testvér: a szülőnél „Gyermek” – megkérdezi, melyik házastárssal', async r => {
    await r.openPerson('Kovács János');
    await r.addChild({ g: 'Anna', sx: 'F', b: 1953 }, { answer: 'Nagy Mária' });
    await r.shot('Anna felvéve');
    await r.expect('Anna szülei: János és Mária', ({ parents }) => eq(parents('Kovács Anna'), ['Kovács János', 'Nagy Mária']));
    await r.expect('Péter és Anna a szülők közös gyerekei', ({ kidsOf }) => eq(kidsOf('Kovács János', 'Nagy Mária'), ['Kovács Anna', 'Kovács Péter']));
  }],
  ['S3', 'Féltestvér: az apa második felesége és közös gyerekük', async r => {
    await r.openPerson('Kovács János');
    await r.addSpouse({ s: 'Szabó', g: 'Éva', b: 1935 });
    await r.addChild({ g: 'Gábor', sx: 'M', b: 1965 }, { answer: 'Szabó Éva' });
    await r.shot('Gábor a második házasságból');
    await r.expect('Gábor szülei: János és Szabó Éva', ({ parents }) => eq(parents('Kovács Gábor'), ['Kovács János', 'Szabó Éva']));
    await r.expect('János két felesége: Mária, Éva', ({ spouses }) => eq(spouses('Kovács János'), ['Nagy Mária', 'Szabó Éva']));
    await r.expect('Mária gyerekei közé nem került Gábor', ({ kidsOf }) => eq(kidsOf('Kovács János', 'Nagy Mária'), ['Kovács Anna', 'Kovács Péter']));
  }],
  ['S4', 'Gyerek előző kapcsolatból (csak az anyáé) – gyereknél „Más / ismeretlen”', async r => {
    await r.openPerson('Kovács Péter');
    await r.addSpouse({ s: 'Ferenczy', g: 'Éva', b: 1952 });
    await r.addChild({ g: 'Zsuzsa', sx: 'F', b: 1981 }, { answer: 'Ferenczy Éva' });
    await r.openPerson('Ferenczy Éva');
    await r.addChild({ s: 'Zeke', g: 'Zsófia', sx: 'F', b: 1975 }, { answer: 'Más / ismeretlen' });
    await r.shot('Zsófia csak Éva gyermeke');
    await r.expect('Zsófia szülője csak Éva', ({ parents }) => eq(parents('Zeke Zsófia'), ['Ferenczy Éva']));
    await r.expect('Péter és Éva közös gyereke csak Zsuzsa', ({ kidsOf }) => eq(kidsOf('Kovács Péter', 'Ferenczy Éva'), ['Kovács Zsuzsa']));
  }],
  ['S5', 'Rossz helyre került gyerek javítása a családszerkesztőben', async r => {
    await r.openPerson('Kovács Péter');
    await r.addChild({ s: 'Zeke', g: 'Ákos', sx: 'M', b: 1977 }, { answer: 'Ferenczy Éva' });
    await r.expect('(hibásan) Ákos közös gyerekként került be', ({ parents }) => eq(parents('Zeke Ákos'), ['Ferenczy Éva', 'Kovács Péter']));
    await r.openPerson('Zeke Ákos');
    await r.click(r.p.locator('.fam-block a:has-text("család")'));
    await r.settle();
    await r.editFamilyKid('Zeke Ákos', 'Csak Ferenczy Éva');
    await r.shot('Ákos átállítva');
    await r.expect('Ákos szülője már csak Éva', ({ parents }) => eq(parents('Zeke Ákos'), ['Ferenczy Éva']));
    await r.expect('Ákos és Zsófia (mindkettő csak Éváé) egy családban', ({ t, one }) => one('Zeke Ákos').fc[0] === one('Zeke Zsófia').fc[0] || 'két külön egyszülős család lett');
  }],
  ['S6', 'Később kiderül az ismeretlen apa', async r => {
    await r.openPerson('Zeke Zsófia');
    await r.addParent({ s: 'Zeke', g: 'Tamás', sx: 'M', b: 1950 }, { answer: 'Egyik sem – új személy', untick: ['Zeke Ákos'] });
    await r.expect('Rákérdezett a testvérre (Ákos)', () => r.sibAsked || 'nem kérdezett');
    await r.shot('Zeke Tamás apaként');
    await r.expect('Zsófia szülei: Éva és Tamás', ({ parents }) => eq(parents('Zeke Zsófia'), ['Ferenczy Éva', 'Zeke Tamás']));
    await r.expect('Ákos (Zsófia féltestvére) nem kapott apát, mert kivettük a pipát', ({ parents }) => {
      const ak = parents('Zeke Ákos');
      if (ak.includes('Zeke Tamás')) { r.notes.push({ k: 'sibling-parent', t: 'Szülő hozzáadásakor a program a gyerekkel egy családban lévő testvérnek (itt Zeke Ákos) is szülővé teszi az új személyt – kérdés nélkül. Lehet, hogy Ákos apja más.' }); return 'Ákos is megkapta Zeke Tamást apának'; }
      return true;
    });
    await r.expect('Éva két házastársa: Péter és Tamás', ({ spouses }) => eq(spouses('Ferenczy Éva'), ['Kovács Péter', 'Zeke Tamás']));
  }],
  ['S7', 'Csáki-eset: előbb az apa, a házastárs később, aztán a második szülő', async r => {
    await r.addFirstAnother({ s: 'Csáki', g: 'László', sx: 'M', b: 1928 });
    await r.addParent({ s: 'Csáki', g: 'István', sx: 'M', b: 1900 });
    await r.openPerson('Csáki István');
    await r.addSpouse({ s: 'Kovács', g: 'Ágnes', b: 1903 });   // NOT ticking László as common child
    await r.openPerson('Csáki László');
    await r.addParent(null, { answer: 'Kovács Ágnes', sex: 'F' });
    await r.shot('László mindkét szülővel');
    await r.expect('László szülei: István és Ágnes', ({ parents }) => eq(parents('Csáki László'), ['Csáki István', 'Kovács Ágnes']));
    await r.expect('István egyetlen házastársa Ágnes (nincs dupla)', ({ spouses }) => eq(spouses('Csáki István'), ['Kovács Ágnes']));
  }],
  ['S8', 'Új házastárs a meglévő gyerekek közül kiválasztva', async r => {
    await r.addFirstAnother({ s: 'Tóth', g: 'Béla', sx: 'M', b: 1940 });
    await r.addChild({ g: 'Dóra', sx: 'F', b: 1966 });
    await r.openPerson('Tóth Béla');
    await r.addChild({ g: 'Ervin', sx: 'M', b: 1970 }, {});
    await r.openPerson('Tóth Béla');
    await r.addSpouse({ s: 'Varga', g: 'Klára', b: 1942 }, { common: ['Tóth Dóra'] });
    await r.shot('Klára: Dóra közös, Ervin nem');
    await r.expect('Dóra szülei: Béla és Klára', ({ parents }) => eq(parents('Tóth Dóra'), ['Tóth Béla', 'Varga Klára']));
    await r.expect('Ervin szülője csak Béla', ({ parents }) => eq(parents('Tóth Ervin'), ['Tóth Béla']));
  }],
  ['S9', 'Két testvér két testvért vesz el (Baum–Csurgay)', async r => {
    await r.addFirstAnother({ s: 'Baum', g: 'Ferenc', sx: 'M', b: 1861 });
    await r.addSpouse({ s: 'Hucke', g: 'Karolina', b: 1866 });
    await r.addChild({ g: 'Karolina', sx: 'F', b: 1894 }, { answer: 'Hucke Karolina' });
    await r.openPerson('Baum Ferenc');
    await r.addChild({ g: 'Viktória', sx: 'F', b: 1901 }, { answer: 'Hucke Karolina' });
    await r.addFirstAnother({ s: 'Csurgay', g: 'Árpád', sx: 'M', b: 1864 });
    await r.addSpouse({ s: 'Riedl', g: 'Anna', b: 1869 });
    await r.addChild({ g: 'Ernő', sx: 'M', b: 1892 }, { answer: 'Riedl Anna' });
    await r.openPerson('Csurgay Árpád', 1864);
    await r.addChild({ g: 'Árpád', sx: 'M', b: 1894 }, { answer: 'Riedl Anna' });
    await r.openPerson('Csurgay Ernő');
    await r.linkExisting('spouse', 'Baum Viktória');
    await r.openPerson('Csurgay Árpád', 1894);
    await r.linkExisting('spouse', 'Baum Karolina');
    await r.expect('Ernő ⚭ Viktória, ifj. Árpád ⚭ Karolina', ({ spouses }) => eq([spouses('Csurgay Ernő'), spouses('Csurgay Árpád', 1894)], [['Baum Viktória'], ['Baum Karolina']]));
    // the relationship chart shows both connections
    const v = (await r.tree()).persons.find(p => p.g === 'Viktória').id, a = (await r.tree()).persons.find(p => p.g === 'Árpád' && p.b === 1894).id;
    await r.p.goto(`${r.base}#/tree/${v}?kind=relation&other=${a}`); await r.settle();
    await r.shot('Rokonság: két kapcsolat');
    const lanes = await r.p.evaluate(() => [...document.querySelectorAll('svg text')].filter(t => /kapcsolat:/.test(t.textContent)).length);
    await r.expect('A Rokonság ábra 2 kapcsolatot mutat', () => lanes === 2 || `${lanes} kapcsolat`);
  }],
  ['S10', 'Ugyanaz a pár kétszer – a program nem engedi', async r => {
    await r.openPerson('Kovács János');
    await r.linkExisting('spouse', 'Nagy Mária');
    await r.expect('Hibaüzenet: már házastársak', () => r.errors.some(e => /már házastársak/.test(e)) || `üzenetek: ${JSON.stringify(r.errors)}`);
    r.errors = r.errors.filter(e => !/már házastársak/.test(e));   // expected, not a failure
    // the link dialog stays open after the refusal (the user can pick someone else) – close it
    if (await r.p.locator('.modal').count()) await r.click(r.p.locator('.modal button:has-text("Mégse")'));
  }],
  ['S11', 'Azonos nevű nagyapa és unoka – a keresőben évszámmal megkülönböztethető', async r => {
    await r.openPerson('Kovács Péter');
    await r.addChild({ g: 'János', sx: 'M', b: 1979 }, { answer: 'Ferenczy Éva' });
    await r.click(r.p.locator('#q')); r.fields++;
    await r.p.locator('#q').fill('Kovács János');
    await r.p.waitForTimeout(450);
    const hits = await r.p.locator('#qres a', { hasText: 'Kovács János' }).allTextContents();
    await r.shot('Két Kovács János a keresőben');
    await r.expect('Két találat, évszámmal', () => (hits.length === 2 && hits.some(h => h.includes('1920')) && hits.some(h => h.includes('1979'))) || JSON.stringify(hits));
    await r.p.keyboard.press('Escape');
  }],
  ['S12', 'Véletlen törlés: megerősítést kér, és a fa ép marad', async r => {
    await r.openPerson('Zeke Tamás');
    await r.click(r.p.locator('.person-head button:has-text("Szerkesztés")'));
    await r.dialog();
    await r.click(r.p.locator('.modal button:has-text("Törlés")'));
    const confirm = await r.dialog();
    await r.shot('Törlés megerősítése');
    await r.click(confirm.locator('button:has-text("Törlés")'));
    await r.settle();
    await r.expect('Zsófia és Ákos szülője újra csak Éva', ({ parents }) => eq([parents('Zeke Zsófia'), parents('Zeke Ákos')], [['Ferenczy Éva'], ['Ferenczy Éva']]));
    r.notes.push({ k: 'no-undo', t: 'Törlés után nincs visszavonás / lomtár.' });
  }],
  ['S13', 'Telefonon: gyerek felvétele kérdéssel, gombok elérhetők', async r => {
    const ctx = await r.p.context().browser().newContext({ ...devices['iPhone 13'], locale: 'hu-HU' });
    const m = await ctx.newPage();
    const main = r.p; r.p = m;
    try {
      await m.goto(r.base + '#/login'); await m.waitForTimeout(800);
      await m.fill('input[name=email]', 'teszt@example.com'); await m.fill('input[name=password]', 'teszt-jelszo-1'); await m.click('form button[type=submit]'); await m.waitForTimeout(1500);
      const t = await r.tree(); const pid = t.persons.find(p => p.s === 'Tóth' && p.g === 'Béla').id;
      await m.goto(`${r.base}#/person/${pid}`); await r.settle();
      const over = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      await r.expect('Nincs vízszintes görgetés a személy oldalán', () => over <= 1 || `${over}px túllógás`);
      await r.addChild({ g: 'Fruzsina', sx: 'F', b: 1975 }, { answer: 'Varga Klára' });
      await r.shot('Telefon: Fruzsina felvéve');
      await r.expect('Fruzsina szülei: Béla és Klára', ({ parents }) => eq(parents('Tóth Fruzsina'), ['Tóth Béla', 'Varga Klára']));
    } finally { r.p = main; await ctx.close(); }
  }],
];

Run.prototype.addFirstAnother = async function (person) {
  // a separate tree part: a new person who is not related to anyone yet
  await this.home();
  const first = this.p.locator('button:has-text("Első személy")');
  if (await first.count()) return this.addFirst(person);
  // the tree is not empty: "Új személy" in the family-tree browser (Családfa menu)
  await this.click(this.p.locator('[data-nav="tree"]'));
  await this.settle();
  const add = this.p.locator('.chart-side button:has-text("Új személy")');
  if (await add.count()) { await this.click(add); await this.dialog(); await this.fillPerson(person); await this.save(); return; }
  if (!this.notes.some(n => n.k === 'no-new')) this.notes.push({ k: 'no-new', t: 'Nem üres fánál nincs „Új személy” gomb egy még senkihez sem kapcsolódó személyhez – csak meglévő személyhez lehet hozzáadni.' });
  await this.p.evaluate(async (pp) => {
    const b = await (await fetch('api.php?a=boot')).json();
    await fetch('api.php?a=op', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': b.data.csrf }, body: JSON.stringify({ name: 'person.create', payload: { surname: pp.s, given: pp.g, sex: pp.sx, birth_date: String(pp.b) } }) });
  }, person);
  await this.p.reload(); await this.settle();
  await this.openPerson(`${person.s} ${person.g}`, person.b);
};

// ------------------------------------------------------------------ report
function report(runs, meta) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const rows = runs.map(r => {
    const ok = r.checks.every(c => c.ok) && !r.crash;
    return `<section class="sc ${ok ? 'ok' : 'bad'}"><h2>${esc(r.name)} · ${esc(r.title)} <span>${ok ? 'RENDBEN' : 'HIBA'}</span></h2>
      <p class="m">${r.clicks} kattintás${r.jumps ? ` (ebből ${r.jumps} visszalépés)` : ''} · ${r.fields} kitöltött mező · ${r.questions.length} kérdés · ${(r.ms / 1000).toFixed(1)} s</p>
      ${r.crash ? `<p class="err">Megszakadt: ${esc(r.crash)}</p>` : ''}
      <ul>${r.checks.map(c => `<li class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'} ${esc(c.desc)}${c.msg ? ` — <i>${esc(c.msg)}</i>` : ''}</li>`).join('')}</ul>
      ${r.questions.length ? `<h3>Kérdések</h3><ul>${r.questions.map(q => `<li><b>${esc(q.q)}</b> → ${esc(q.chose)} <small>(${q.options.map(esc).join(' / ')})</small></li>`).join('')}</ul>` : ''}
      ${r.errors.length ? `<h3>Hibaüzenetek</h3><ul>${r.errors.map(e => `<li class="bad">${esc(e)}</li>`).join('')}</ul>` : ''}
      ${r.notes.length ? `<h3>Használhatósági megjegyzés</h3><ul>${r.notes.map(n => `<li>${esc(n.t)}</li>`).join('')}</ul>` : ''}
      <div class="shots">${r.shots.map(s => `<figure><a href="${s.f}"><img src="${s.f}" loading="lazy"></a><figcaption>${esc(s.label)}</figcaption></figure>`).join('')}</div></section>`;
  }).join('\n');
  const passed = runs.filter(r => r.checks.every(c => c.ok) && !r.crash).length;
  fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>UI-forgatókönyvek</title>
<style>body{font:15px/1.45 system-ui,sans-serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#222}h1{margin:0 0 4px}.sc{border:1px solid #ddd;border-left:6px solid #2a7;border-radius:8px;padding:10px 16px;margin:16px 0}.sc.bad{border-left-color:#c33}.sc h2{font-size:18px;margin:4px 0}.sc h2 span{float:right;font-size:13px;color:#fff;background:#2a7;padding:2px 8px;border-radius:10px}.sc.bad h2 span{background:#c33}.m{color:#666;margin:2px 0 8px}li.bad,.err{color:#b22}li.ok{color:#265}.shots{display:flex;gap:8px;flex-wrap:wrap}figure{margin:0;width:240px}img{width:240px;border:1px solid #ccc;border-radius:4px}figcaption{font-size:12px;color:#555}</style>
<h1>UI-forgatókönyvek</h1><p>${passed} / ${runs.length} rendben · ${esc(meta)}</p>${rows}`);
}

// ------------------------------------------------------------------ main
(async () => {
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ui-'));
  copyApp(dir);
  const port = await freePort();
  const php = spawn(process.env.PHP || 'php', ['-S', `127.0.0.1:${port}`], { cwd: dir, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}/`;
  await new Promise(r => setTimeout(r, 900));
  const browser = await chromium.launch({ headless: !process.env.HEADED, slowMo: process.env.HEADED ? 120 : 0 });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'hu-HU' });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));
  const runs = [];
  try {
    // install through the UI
    await page.goto(base); await page.waitForTimeout(1200);
    // the installer offers a GEDCOM found next to the app (or one folder up) – the scenarios need an empty tree
    if (await page.locator('input[name=import]').count()) await page.uncheck('input[name=import]');
    await page.fill('input[name=name]', 'Teszt Admin'); await page.fill('input[name=email]', 'teszt@example.com'); await page.fill('input[name=password]', 'teszt-jelszo-1');
    await page.click('button[type=submit]'); await page.waitForTimeout(2500);
    for (const [name, title, fn] of SCENARIOS) {
      if (ONLY.length && !ONLY.includes(name)) continue;
      const r = new Run(page, name, title); r.base = base;
      try { await r.init(); await fn(r); await r.integrity(); }
      catch (e) { r.crash = e.message.split('\n')[0]; try { await r.shot('Itt akadt el'); } catch (x) { /* ignore */ } }
      r.ms = Date.now() - r.t0;
      runs.push(r);
      const ok = r.checks.every(c => c.ok) && !r.crash;
      console.log(`${ok ? '✓' : '✗'} ${name} ${title} — ${r.clicks} kattintás, ${r.fields} mező, ${r.questions.length} kérdés${r.crash ? ' — ' + r.crash : ''}`);
      for (const c of r.checks.filter(c => !c.ok)) console.log(`    ✗ ${c.desc}: ${c.msg}`);
      for (const n of r.notes) console.log(`    · ${n.t}`);
      for (const e of r.errors) console.log(`    ! ${e}`);
    }
  } finally {
    report(runs, `JS-hibák: ${jsErrors.length ? jsErrors.join(' | ') : 'nincs'}`);
    await browser.close();
    php.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const failed = runs.filter(r => !r.checks.every(c => c.ok) || r.crash).length;
  console.log(`\n${runs.length - failed} / ${runs.length} rendben. Jelentés: ${path.join(OUT, 'index.html')}${jsErrors.length ? '\nJS-hibák: ' + jsErrors.join(' | ') : ''}`);
  process.exit(failed ? 1 : 0);
})();
