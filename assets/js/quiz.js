// "Ki kicsoda?" face quiz.
import { S, T, P, h, api, icon, personName, years, setTitle, loadTree, personPicker, field, toast, fail, photoStyle, huCmp, norm } from './core.js';

const birthYear = p => p.b || p.e || null;

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Pick 3 distractors of similar age (and sex) for `target` from `cands`. Pure, testable. */
export function distractors(target, cands, { band = 15, sameSex = true, n = 3, rnd = Math.random, nameOf = personName } = {}) {
  const ty = birthYear(target);
  const tn = nameOf(target);
  const usedNames = new Set([tn]);
  const ok = cands.filter(p => p.id !== target.id && !p.masked && (p.g || p.s));
  const tiers = [
    ok.filter(p => (!sameSex || target.sx === 'U' || p.sx === target.sx) && ty && birthYear(p) && Math.abs(birthYear(p) - ty) <= band),
    ok.filter(p => (!sameSex || target.sx === 'U' || p.sx === target.sx)),
    ok,
  ];
  const out = [];
  for (const tier of tiers) {
    let pool = shuffle(tier, rnd);
    if (tier !== tiers[0] && ty) pool.sort((a, b) => Math.abs((birthYear(a) ?? 1e4) - ty) - Math.abs((birthYear(b) ?? 1e4) - ty));
    for (const p of pool) {
      if (out.length >= n) break;
      const nm = nameOf(p);
      if (usedNames.has(nm) || out.includes(p)) continue;
      usedNames.add(nm); out.push(p);
    }
    if (out.length >= n) break;
  }
  return out;
}

export function buildQuiz(pool, all, count, opts = {}) {
  const rnd = opts.rnd || Math.random;
  const picks = shuffle(pool, rnd).slice(0, Math.min(count, pool.length));
  return picks.map(t => ({ target: t, options: opts.mode === 'list' ? null : shuffle([t, ...distractors(t, all, { ...opts, rnd })], rnd) }));
}

export async function viewQuiz() {
  setTitle(T('Kvíz'));
  await loadTree();
  const s = S.settings;
  const all = [...S.tree.P.values()].filter(p => !p.masked);
  const pool0 = all.filter(p => p.ph);
  const wrap = h('div', { class: 'quiz' });
  let top = [];
  try { top = await api('quiz.top'); } catch (e) { /* toplist optional */ }

  const setup = () => {
    let mode = s.quiz_mode;
    const counts = [];
    for (let i = +s.quiz_min; i <= +s.quiz_max; i += i < 10 ? 1 : 5) counts.push(i);
    if (!counts.includes(+s.quiz_count)) counts.push(+s.quiz_count);
    counts.sort((a, b) => a - b);
    const cnt = h('select', null, counts.map(c => h('option', { value: c, selected: c === +s.quiz_count }, c + T(' arc'))));
    const surnames = [...new Set(pool0.map(p => p.s).filter(Boolean))].sort(huCmp);
    const sn = h('select', null, h('option', { value: '' }, T('Az egész család')), surnames.map(x => h('option', { value: x }, x + T(' ág'))));
    const seg = h('div', { class: 'seg', role: 'radiogroup' },
      [['choice', T('4 hasonló korú közül')], ['list', T('Névlistából')]].map(([k, l]) => h('button', { type: 'button', class: k === mode ? 'on' : '', onclick: e => { mode = k; seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.currentTarget)); } }, l)));
    const enough = pool0.length >= 4;
    wrap.replaceChildren(
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, T('Ki kicsoda?')), h('p', null, T('Egymás után jönnek az arcok a családi albumból. Felismered őket?')))),
      h('div', { class: 'quiz-setup' },
        h('div', { class: 'panel' },
          enough ? [
            field(T('Hány arc legyen?'), cnt),
            field(T('Játékmód'), seg),
            field(T('Kikből?'), sn),
            +s.quiz_seconds ? h('p', { class: 'hint' }, T("Kérdésenként {0} másodperc áll rendelkezésre.", s.quiz_seconds)) : null,
            h('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:8px;padding:13px', onclick: () => {
              const pool = sn.value ? pool0.filter(p => p.s === sn.value) : pool0;
              if (pool.length < 1) return toast(T('Ebben az ágban nincs portré.'), 'bad');
              play(buildQuiz(pool, all, +cnt.value, { mode, band: +s.quiz_age_band, sameSex: !!s.quiz_same_sex }), mode);
            } }, T('Indulhat a játék'))]
            : h('div', null, h('h3', null, T('Ehhez még kevés a portré')), h('p', null, T("A kvízhez legalább 4 családtagról kell fotó. Most {0} portré van.", pool0.length)), h('a', { class: 'btn', href: '#/people?tab=all' }, T('Fotók feltöltése')))),
        h('div', null, h('h2', null, T('Toplista')), top.length ? h('table', { class: 'toplist' }, top.map((r, i) => h('tr', null, h('td', null, i + 1 + '.'), h('td', null, r.name, h('div', { class: 'hint' }, r.mode === 'list' ? T('névlistás') : T('4 válaszos'))), h('td', null, `${r.score}/${r.total}`))))
          : h('p', { class: 'empty' }, T('Még senki nem játszott. Légy te az első!')))));
  };

  const play = (qs, mode) => {
    let i = 0, score = 0, timer = null;
    const results = [];
    const t0 = performance.now();
    const next = () => {
      clearInterval(timer);
      if (i >= qs.length) return finish();
      const q = qs[i];
      const prog = h('div', { class: 'quiz-progress' }, qs.map((_, k) => h('span', { class: k < i ? (results[k] ? 'ok' : 'bad') : k === i ? 'cur' : '' })));
      const bar = h('div', { class: 'timer', style: 'width:100%' });
      const face = h('div', { class: 'quiz-face' }, h('img', { src: q.target.pf || q.target.ph, alt: T('Ki van a képen?'), style: photoStyle(q.target) }), +s.quiz_seconds ? bar : null);
      const fb = h('div', { class: 'quiz-feedback', 'aria-live': 'polite' });
      const nextBtn = h('button', { class: 'btn btn-primary', hidden: true, onclick: () => { i++; next(); } }, i === qs.length - 1 ? T('Eredmény') : T('Következő'));
      let answered = false;
      const answer = (pid, btn) => {
        if (answered) return;
        answered = true; clearInterval(timer);
        const ok = pid === q.target.id || (pid && personName(P(pid)) === personName(q.target));
        results[i] = ok; if (ok) score++;
        if (q.options) for (const b of opts.querySelectorAll('button')) { b.disabled = true; if (+b.dataset.id === q.target.id) b.classList.add('ok'); else if (b === btn) b.classList.add('bad'); }
        fb.replaceChildren(h('b', null, ok ? T('Így van! ') : pid === null ? T('Lejárt az idő. ') : T('Nem talált. ')), ok ? '' : T('Ő '), h('a', { href: '#/person/' + q.target.id, target: '_blank' }, personName(q.target)), ' (' + years(q.target) + ')');
        nextBtn.hidden = false; nextBtn.focus();
      };
      let opts;
      if (q.options) {
        opts = h('div', { class: 'quiz-options' }, q.options.map(p => h('button', { 'data-id': p.id, onclick: e => answer(p.id, e.currentTarget) }, personName(p), h('small', null, years(p)))));
      } else {
        const filter = s.quiz_list_all ? (p => !p.masked) : (p => !!p.ph);
        const pk = personPicker({ placeholder: T('Kezdd gépelni a nevét…'), filter });
        const go = h('button', { class: 'btn btn-primary', onclick: () => answer(pk.get() || -1) }, T('Ez az!'));
        pk.input.addEventListener('keydown', e => { if (e.key === 'Enter' && pk.get()) answer(pk.get()); });
        opts = h('div', { class: 'row', style: 'max-width:480px;margin:0 auto;flex-wrap:nowrap' }, h('div', { class: 'grow' }, pk.el), go);
        setTimeout(() => pk.input.focus(), 50);
      }
      wrap.replaceChildren(h('div', { class: 'quiz-card' }, prog, h('p', { class: 'muted' }, T("{0}. arc a {1}-ből", i + 1, qs.length)), face, opts, fb, nextBtn));
      if (+s.quiz_seconds) {
        const end = Date.now() + s.quiz_seconds * 1000;
        timer = setInterval(() => { const left = end - Date.now(); bar.style.width = Math.max(0, left / (s.quiz_seconds * 10)) + '%'; if (left <= 0) answer(null); }, 100);
      }
    };
    const finish = () => {
      const ms = Math.round(performance.now() - t0);
      const pct = Math.round(score / qs.length * 100);
      const verdict = pct === 100 ? T('Hibátlan! Te vagy a család emlékezete.') : pct >= 70 ? T('Nagyon jó, ismered a családot.') : pct >= 40 ? T('Nem rossz – érdemes lapozgatni az arcképcsarnokot.') : T('Itt az ideje egy családi fotónézegetésnek.');
      const nameIn = S.user ? null : h('input', { type: 'text', placeholder: T('A neved a toplistára'), maxlength: 60 });
      const saveBtn = h('button', { class: 'btn', onclick: async () => { try { await api('quiz.save', { score, total: qs.length, mode, ms, name: nameIn?.value }); toast(T('Felkerültél a toplistára.')); saveBtn.disabled = true; } catch (e) { fail(e); } } }, T('Mentés a toplistára'));
      wrap.replaceChildren(h('div', { class: 'quiz-card' },
        h('div', { class: 'quiz-score' }, `${score}/${qs.length}`),
        h('p', { style: 'font-size:1.15rem;margin-top:8px' }, verdict),
        h('p', { class: 'muted' }, T("Idő: {0} perc {1} mp", Math.floor(ms / 60000), Math.round(ms / 1000) % 60)),
        h('div', { class: 'row', style: 'justify-content:center' }, nameIn, saveBtn, h('button', { class: 'btn btn-primary', onclick: setup }, T('Új játék'))),
        h('div', { class: 'quiz-review' }, qs.map((q, k) => h('a', { href: '#/person/' + q.target.id }, h('div', { class: 'img' + (results[k] ? '' : ' bad') }, h('img', { src: q.target.ph, alt: '', style: photoStyle(q.target) })), personName(q.target, { short: true }))))));
    };
    next();
  };
  setup();
  return wrap;
}
