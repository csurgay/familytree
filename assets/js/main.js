import { S, T, api, h, $, icon, route, render, go, loadTree, personName, years, avatar, norm, fail, setLang } from './core.js';
import { viewHome, viewPerson, viewFamily, viewPeople, viewStories, viewStory, viewTree, viewCharts, viewLogin, viewInstall, viewAccount, viewEvents, viewRegister, viewSurname } from './views.js';
import { viewQuiz } from './quiz.js';
import { viewAdmin } from './admin.js';

async function boot() {
  let b;
  try { b = await api('boot'); }
  catch (e) { $('#main').replaceChildren(h('div', { class: 'empty' }, h('h2', null, T('A szerver nem érhető el')), h('p', null, e.message))); return; }
  S.boot = b; S.user = b.user; S.settings = b.settings; S.csrf = b.csrf;
  if (!(b.langs || []).some(l => l.code === S.lang)) S.lang = 'hu';
  await setLang(S.lang);
  translateStatic();
  if (S.settings.theme !== 'auto') document.documentElement.dataset.theme = S.settings.theme;
  drawUserbox();
  setupSearch();
  $('#navtoggle').addEventListener('click', () => { const n = $('#mainnav'); n.classList.toggle('open'); $('#navtoggle').setAttribute('aria-expanded', n.classList.contains('open')); });

  if (!b.installed) { route('.*', () => viewInstall()); window.addEventListener('hashchange', render); return render(); }
  const gate = fn => (...a) => (!b.canRead ? (go('#/login?next=' + encodeURIComponent(location.hash)), null) : fn(...a));
  route('/', gate(viewHome), { nav: 'home', full: true });
  route('/person/:id', gate(viewPerson), { nav: 'people' });
  route('/family/:id', gate(viewFamily), { nav: 'people' });
  route('/people', gate(qs => viewPeople(qs)), { nav: 'people' });
  route('/events', gate(qs => viewEvents(qs)), { nav: 'home' });
  route('/surname/:name', gate(viewSurname), { nav: 'people' });
  route('/stories', gate(viewStories), { nav: 'stories' });
  route('/story/:id', gate(viewStory), { nav: 'stories' });
  route('/tree', gate(qs => viewTree(null, qs)), { nav: 'tree', full: true });
  route('/tree/:id', gate(viewTree), { nav: 'tree', full: true });
  route('/charts', gate(viewCharts), { nav: 'charts' });
  route('/quiz', gate(viewQuiz), { nav: 'quiz' });
  route('/login', qs => viewLogin(qs));
  route('/register', () => viewRegister());
  route('/account', () => viewAccount());
  route('/admin', qs => viewAdmin('settings', qs));
  route('/admin/:tab', viewAdmin);
  window.addEventListener('hashchange', render);
  render();
}

/** Texts that live in index.php (menu, search box): translated in place, the Hungarian original kept in data-t. */
function translateStatic() {
  for (const el of document.querySelectorAll('#mainnav a, .skip')) { el.dataset.t ||= el.textContent; el.textContent = T(el.dataset.t); }
  const q = $('#q'); q.dataset.t ||= q.placeholder; q.placeholder = T(q.dataset.t); q.setAttribute('aria-label', T('Keresés névre…'));
  $('#navtoggle').setAttribute('aria-label', T('Menü'));
}
function langSelect() {
  const langs = S.boot.langs || [];
  if (langs.length < 2) return null;
  const sel = h('select', { 'aria-label': T('Nyelv'), title: T('Nyelv') }, langs.map(l => h('option', { value: l.code, selected: l.code === S.lang, title: l.name }, l.code.toUpperCase())));
  sel.addEventListener('change', async () => { await setLang(sel.value); translateStatic(); drawUserbox(); render(); });
  return h('label', { class: 'langsel' }, icon('globe'), sel);
}
function drawUserbox() {
  const box = $('#userbox');
  if (!S.user) { box.replaceChildren(langSelect(), h('a', { class: 'btn btn-sm btn-ghost', href: '#/login' }, T('Belépés'))); return; }
  const gear = S.user.role === 'admin' ? h('a', { class: 'gear', href: '#/admin', title: T('Admin beállítások'), 'aria-label': T('Admin beállítások') }, icon('gear'), S.boot.pending ? h('span', { class: 'dot' }, S.boot.pending) : null) : null;
  box.replaceChildren(langSelect(), gear, h('a', { class: 'gear', href: '#/account', title: S.user.name + T(' – fiókom'), 'aria-label': T('Fiókom') }, icon('user'), S.boot.myPending ? h('span', { class: 'dot' }, S.boot.myPending) : null));
}

function setupSearch() {
  const q = $('#q'), res = $('#qres');
  let sel = -1, items = [];
  const close = () => { res.hidden = true; sel = -1; };
  q.addEventListener('input', async () => {
    const v = norm(q.value);
    if (v.length < 2) return close();
    try { await loadTree(); } catch (e) { return; }
    const words = v.split(' ');
    items = [...S.tree.P.values()].filter(p => { const t = norm(personName(p) + ' ' + (p.n || '') + ' ' + (p.b || '')); return words.every(w => t.includes(w)); })
      .sort((a, b) => (b.ph ? 1 : 0) - (a.ph ? 1 : 0) || (a.b || 9999) - (b.b || 9999)).slice(0, 12);
    res.replaceChildren(...(items.length ? items.map((p, i) => h('a', { href: '#/person/' + p.id, role: 'option', onclick: () => { close(); q.value = ''; } }, avatar(p, 32), h('span', null, personName(p), h('div', { class: 'hint' }, years(p) || '—'))))
      : [h('div', { class: 'hint', style: 'padding:8px' }, T('Nincs ilyen nevű családtag.'))]));
    res.hidden = false; sel = -1;
  });
  q.addEventListener('keydown', e => {
    const links = [...res.querySelectorAll('a')];
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, links.length - 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); e.preventDefault(); }
    else if (e.key === 'Enter') { const a = links[Math.max(sel, 0)]; if (a) { location.hash = a.getAttribute('href'); close(); q.value = ''; q.blur(); } }
    else if (e.key === 'Escape') { close(); q.blur(); }
    links.forEach((a, i) => a.classList.toggle('sel', i === sel));
  });
  q.addEventListener('blur', () => setTimeout(close, 150));
}

boot().catch(fail);
