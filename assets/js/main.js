import { S, api, h, $, icon, route, render, go, loadTree, personName, years, avatar, norm, fail } from './core.js';
import { viewHome, viewPerson, viewFamily, viewPeople, viewStories, viewStory, viewTree, viewCharts, viewLogin, viewInstall, viewAccount, viewEvents } from './views.js';
import { viewQuiz } from './quiz.js';
import { viewAdmin } from './admin.js';

async function boot() {
  let b;
  try { b = await api('boot'); }
  catch (e) { $('#main').replaceChildren(h('div', { class: 'empty' }, h('h2', null, 'A szerver nem érhető el'), h('p', null, e.message))); return; }
  S.boot = b; S.user = b.user; S.settings = b.settings; S.csrf = b.csrf;
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
  route('/stories', gate(viewStories), { nav: 'stories' });
  route('/story/:id', gate(viewStory), { nav: 'stories' });
  route('/tree', gate(qs => viewTree(null, qs)), { nav: 'tree', full: true });
  route('/tree/:id', gate(viewTree), { nav: 'tree', full: true });
  route('/charts', gate(viewCharts), { nav: 'charts' });
  route('/quiz', gate(viewQuiz), { nav: 'quiz' });
  route('/login', qs => viewLogin(qs));
  route('/account', () => viewAccount());
  route('/admin', qs => viewAdmin('settings', qs));
  route('/admin/:tab', viewAdmin);
  window.addEventListener('hashchange', render);
  render();
}

function drawUserbox() {
  const box = $('#userbox');
  if (!S.user) { box.replaceChildren(h('a', { class: 'btn btn-sm btn-ghost', href: '#/login' }, 'Belépés')); return; }
  const gear = S.user.role === 'admin' ? h('a', { class: 'gear', href: '#/admin', title: 'Admin beállítások', 'aria-label': 'Admin beállítások' }, icon('gear'), S.boot.pending ? h('span', { class: 'dot' }, S.boot.pending) : null) : null;
  box.replaceChildren(gear, h('a', { class: 'gear', href: '#/account', title: S.user.name + ' – fiókom', 'aria-label': 'Fiókom' }, icon('user'), S.boot.myPending ? h('span', { class: 'dot' }, S.boot.myPending) : null));
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
      : [h('div', { class: 'hint', style: 'padding:8px' }, 'Nincs ilyen nevű családtag.')]));
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
