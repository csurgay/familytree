// Admin area behind the gear: settings, users, branch heads, approvals, import/export, log, self-tests.
import { S, T, P, h, api, icon, setTitle, loadTree, personName, personPicker, field, toast, fail, modal, formData, confirmBox, go, render, chip, years, familyLabel, F, parentsOf } from './core.js';
import { runClientTests } from './tests.js';
import { uploadPhotos, photoViewer } from './edit.js';

const TABS = [['settings', 'Beállítások'], ['changes', 'Jóváhagyások'], ['users', 'Felhasználók'], ['branches', 'Családfők és ágak'], ['nophoto', 'Fénykép nélkül'], ['import', 'Import / export'], ['log', 'Napló'], ['tests', 'Autotesztek'], ['system', 'Rendszer']];

export async function viewAdmin(tab = 'settings', qs) {
  if (S.user?.role !== 'admin') { go('#/login'); return null; }
  await loadTree();
  setTitle(T('Admin'));
  const nav = h('nav', { class: 'admin-nav', 'aria-label': T('Admin') }, TABS.map(([k, l]) => h('a', { href: '#/admin/' + k, class: k === tab ? 'active' : '' }, T(l),
    k === 'changes' && S.boot.pendingChanges ? h('span', { class: 'badge pend' }, S.boot.pendingChanges) : null,
    k === 'users' && S.boot.pendingUsers ? h('span', { class: 'badge pend' }, S.boot.pendingUsers) : null)));
  const body = h('div');
  const fn = { settings: settingsTab, users: usersTab, branches: branchesTab, changes: changesTab, nophoto: noPhotoTab, import: importTab, log: logTab, tests: testsTab, system: systemTab }[tab] || settingsTab;
  body.append(await fn(qs));
  return h('div', { class: 'admin' }, nav, body);
}

// ------------------------------------------------------------------ settings
async function settingsTab() {
  const defs = S.boot.settingsDef;
  const groups = {};
  for (const d of defs) (groups[d[0]] ||= []).push(d);
  const getters = {};
  const form = h('form', { onsubmit: e => e.preventDefault() });
  for (const [g, list] of Object.entries(groups)) {
    const sec = h('section', { class: 'settings-group' }, h('h2', null, T(g)));
    for (const [, key, type, def, label, help, opt] of list) {
      const v = S.settings[key] ?? def;
      let ctl;
      if (type === 'bool') { ctl = h('input', { type: 'checkbox', checked: !!v, style: 'width:20px;height:20px;accent-color:var(--cover)' }); getters[key] = () => ctl.checked; }
      else if (type === 'int') { ctl = h('input', { type: 'number', value: v, min: opt?.[0], max: opt?.[1] }); getters[key] = () => ctl.value; }
      else if (type === 'select') { ctl = h('select', null, Object.entries(opt).map(([k, l]) => h('option', { value: k, selected: k === v }, T(l)))); getters[key] = () => ctl.value; }
      else if (type === 'color') { ctl = h('input', { type: 'color', value: v }); getters[key] = () => ctl.value; }
      else if (type === 'multi') {
        const boxes = Object.entries(opt).map(([k, l]) => { const c = h('input', { type: 'checkbox', value: k, checked: (v || []).includes(k) }); return [c, h('label', null, c, T(l))]; });
        ctl = h('div', { class: 'multi' }, boxes.map(b => b[1])); getters[key] = () => boxes.filter(b => b[0].checked).map(b => b[0].value);
      } else if (type === 'person') { const pk = personPicker({ value: v || null }); ctl = pk.el; getters[key] = () => pk.get() || 0; }
      else { ctl = h('input', { type: 'text', value: v ?? '' }); getters[key] = () => ctl.value; }
      sec.append(h('div', { class: 'setting' }, h('div', { class: 'l' }, h('b', null, T(label)), help ? h('small', null, T(help)) : null), ctl));
    }
    form.append(sec);
  }
  const save = h('button', { class: 'btn btn-primary', onclick: async () => {
    const values = Object.fromEntries(Object.entries(getters).map(([k, g]) => [k, g()]));
    save.disabled = true;
    try { await api('admin.settings', { values }); toast(T('Beállítások mentve.')); setTimeout(() => location.reload(), 500); } catch (e) { fail(e); save.disabled = false; }
  } }, icon('save'), T('Beállítások mentése'));
  return h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, T('Beállítások')), h('p', null, T('Az app minden paramétere. A mentés után az oldal újratöltődik.'))), save), form,
    h('div', { style: 'position:sticky;bottom:12px;text-align:right;padding-top:10px' }, (() => { const b2 = h('button', { class: 'btn btn-primary', onclick: () => save.click() }, icon('save'), T('Beállítások mentése')); return b2; })()));
}

// ------------------------------------------------------------------ users
/** Editable list of branch roots (persons) – the subtrees a family head may edit. */
function branchEditor(initial = []) {
  let ids = initial.slice();
  const list = h('div', { class: 'tags' });
  const draw = () => list.replaceChildren(...ids.map(id => h('span', { class: 'tag' }, personName(P(id)), P(id)?.b ? h('small', { class: 'muted' }, ' ' + P(id).b) : null,
    h('button', { type: 'button', 'aria-label': T('Eltávolítás'), onclick: () => { ids = ids.filter(x => x !== id); draw(); } }, '×'))));
  const pk = personPicker({ placeholder: T('Ág kezdő személye (pl. a nagypapa)…'), onPick: id => { if (id && !ids.includes(id)) { ids.push(id); draw(); } pk.set(null); } });
  draw();
  return { el: h('div', null, pk.el, list), get: () => ids };
}

async function usersTab() {
  const users = await api('admin.users');
  const roleL = { admin: T('Admin'), head: T('Családfő'), member: T('Családtag') };
  const pending = users.filter(u => u.status === 'pending');
  const others = users.filter(u => u.status !== 'pending');
  const edit = u => {
    const pk = personPicker({ value: u?.person_id || null, placeholder: T('Melyik személy ő a fában? (nem kötelező)') });
    const br = branchEditor(u?.branches || []);
    const form = h('form', { onsubmit: e => e.preventDefault() },
      h('div', { class: 'grid2' }, field(T('Név'), h('input', { type: 'text', name: 'name', value: u?.name || '' })), field(T('E-mail'), h('input', { type: 'email', name: 'email', value: u?.email || '' }))),
      field(T('Szerep'), h('select', { name: 'role' }, Object.entries(roleL).map(([k, l]) => h('option', { value: k, selected: (u?.role || 'member') === k }, l))),
        T('Családfő: a hozzárendelt ágán új adatot azonnal felvehet, módosítás/törlés jóváhagyással. Családtag: csak javasolhat.')),
      field(T('Ő a fában'), pk.el),
      field(T('Szerkeszthető ágak'), br.el, T('A kezdő személy leszármazottai és házastársaik. Ha adsz meg ágat, a családtagból családfő lesz.')),
      field(u ? T('Új jelszó (üresen hagyva marad a régi)') : T('Kezdő jelszó'), h('input', { type: 'text', name: 'password', autocomplete: 'new-password', placeholder: T('legalább 8 karakter') })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'active', checked: u ? !!+u.active : true }), h('span', null, T('Aktív (beléphet)'))),
      u?.intro ? h('div', { class: 'hint' }, T('Bemutatkozás a regisztrációnál: '), u.intro) : null);
    const actions = [{ label: T('Mégse') }, { label: T('Mentés'), cls: 'btn-primary', onClick: async () => {
      const r = await api('admin.user.save', { id: u?.id, ...formData(form), person_id: pk.get() });
      await api('admin.user.branches', { user_id: r.id, person_ids: br.get() });
      toast(T('Felhasználó mentve.')); render();
    } }];
    if (u && u.id !== S.user.id) actions.unshift({ label: T('Törlés'), cls: 'btn-danger left', onClick: async () => { if (!await confirmBox(T('Felhasználó törlése'), T("Törlöd: {0}?", u.name), T('Törlés'))) return false; await api('admin.user.delete', { id: u.id }); render(); } });
    modal({ title: u ? T('Felhasználó szerkesztése') : T('Új felhasználó'), body: form, actions });
  };
  const approve = u => {
    const pk = personPicker({ placeholder: T('Ki ő a fában? (nem kötelező)') });
    const br = branchEditor([]);
    const role = h('select', null, h('option', { value: 'member' }, T('Családtag – nézhet, javasolhat')), h('option', { value: 'head' }, T('Családfő – a megadott ágakat szerkesztheti')), h('option', { value: 'admin' }, T('Admin – mindent')));
    modal({ title: T('Regisztráció jóváhagyása'), body: h('div', null,
      h('p', null, h('b', null, u.name), ' · ', u.email), u.intro ? h('blockquote', { class: 'intro' }, u.intro) : h('p', { class: 'hint' }, T('Nem írt bemutatkozást.')),
      field(T('Hozzáférés'), role), field(T('Ő a fában'), pk.el),
      field(T('Szerkeszthető ágak (nem kötelező)'), br.el, T('Ha megadsz ágat, családfő lesz: azon az ágon új adatot azonnal felvehet, a módosításait te hagyod jóvá.'))),
      actions: [{ label: T('Mégse') }, { label: T('Jóváhagyás'), cls: 'btn-primary', onClick: async () => {
        const r = await api('admin.user.approve', { id: u.id, role: role.value, person_id: pk.get(), branch_ids: br.get() });
        toast(T("{0} jóváhagyva ({1}).", u.name, roleL[r.role])); S.boot.pending = Math.max(0, S.boot.pending - 1); S.boot.pendingUsers = Math.max(0, (S.boot.pendingUsers || 1) - 1); render();
      } }] });
  };
  const reject = async u => {
    if (!await confirmBox(T('Regisztráció elutasítása'), T("Elutasítod és törlöd {0} ({1}) regisztrációját?", u.name, u.email), T('Elutasítás'))) return;
    try { await api('admin.user.delete', { id: u.id }); toast(T('Elutasítva.')); S.boot.pending = Math.max(0, S.boot.pending - 1); S.boot.pendingUsers = Math.max(0, (S.boot.pendingUsers || 1) - 1); render(); } catch (e) { fail(e); }
  };
  return h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, T('Felhasználók')), h('p', null, S.settings.allow_register ? T('Bárki regisztrálhat; az új fiókok itt várnak a jóváhagyásodra. Családfő úgy lesz valakiből, hogy szerkeszthető ágat rendelsz hozzá.') : T('A regisztráció ki van kapcsolva (Beállítások → Hozzáférés); új családtagot itt vehetsz fel kezdő jelszóval.'))),
      h('button', { class: 'btn btn-primary', onclick: () => edit(null) }, icon('plus'), T('Új felhasználó'))),
    pending.length ? h('section', { class: 'section' }, h('h2', null, T('Jóváhagyásra vár (') + pending.length + ')'),
      pending.map(u => h('div', { class: 'change' },
        h('div', { class: 'hd' }, h('b', null, u.name), h('span', null, u.email), (u.logins || []).map(p => h('span', { class: 'badge' }, p === 'google' ? 'Google' : 'Facebook')), h('span', { class: 'hint' }, T('regisztrált: ') + (u.created || '').slice(0, 16))),
        u.intro ? h('p', { style: 'margin:8px 0 0;white-space:pre-wrap' }, u.intro) : null,
        h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn btn-danger', onclick: () => reject(u) }, T('Elutasítás')), h('button', { class: 'btn btn-primary', onclick: () => approve(u) }, icon('check'), T('Jóváhagyás…')))))) : null,
    h('table', { class: 'tbl' }, h('tr', null, [T('Név'), T('E-mail'), T('Szerep'), T('Ő a fában'), T('Ágak'), T('Utolsó belépés'), ''].map(t => h('th', null, t))),
      others.map(u => h('tr', null, h('td', null, u.name, +u.active ? null : h('span', { class: 'badge bad', style: 'margin-left:6px' }, T('tiltva'))), h('td', null, u.email, (u.logins || []).map(p => h('span', { class: 'badge', style: 'margin-left:6px', title: T('Ezzel is be tud lépni') }, p === 'google' ? 'Google' : 'Facebook'))), h('td', null, roleL[u.role] || u.role),
        h('td', null, u.person_id && P(u.person_id) ? h('a', { href: '#/person/' + u.person_id }, personName(P(u.person_id))) : '—'),
        h('td', null, u.branches?.length ? u.branches.map(id => personName(P(id), { short: true })).join(', ') : '—'),
        h('td', null, u.last_login?.slice(0, 16) || '—'), h('td', null, h('button', { class: 'btn btn-sm', onclick: () => edit(u) }, T('Szerkesztés')))))));
}

// ------------------------------------------------------------------ branches
async function branchesTab() {
  const [rows, users] = await Promise.all([api('admin.branches'), api('admin.users')]);
  const usel = h('select', null, users.filter(u => u.role !== 'admin').map(u => h('option', { value: u.id }, `${u.name} (${u.email})`)));
  const pk = personPicker({ placeholder: T('Az ág kezdő személye (pl. a nagypapa)…') });
  return h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, T('Családfők és ágak')), h('p', null, T('Egy családfőhöz egy vagy több személyt rendelhetsz: az ő leszármazottai (és házastársaik) alkotják a családfő ágát. Ott a családfő azonnal felvehet új személyt, fotót, eseményt, sztorit; módosítani és törölni a te jóváhagyásoddal tud.')))),
    users.some(u => u.role !== 'admin') ? h('div', { class: 'panel', style: 'margin-bottom:24px' }, h('h3', null, T('Ág hozzárendelése')),
      h('div', { class: 'grid2' }, field(T('Családfő'), usel), field(T('Az ág kezdete'), pk.el)),
      h('button', { class: 'btn btn-primary', onclick: async () => { if (!pk.get()) return toast(T('Válassz személyt.'), 'bad'); try { await api('admin.branch.save', { user_id: +usel.value, person_id: pk.get() }); toast(T('Ág hozzárendelve.')); render(); } catch (e) { fail(e); } } }, T('Hozzárendelés')))
      : h('p', { class: 'empty' }, T('Előbb vegyél fel egy nem-admin felhasználót a Felhasználók fülön.')),
    rows.length ? h('table', { class: 'tbl' }, h('tr', null, [T('Családfő'), T('Az ág kezdete'), T('Az ág mérete'), ''].map(t => h('th', null, t))),
      rows.map(r => h('tr', null, h('td', null, r.user_name), h('td', null, chip(r.person_id)), h('td', null, r.size + T(' személy')),
        h('td', null, h('button', { class: 'btn btn-sm btn-danger', onclick: async () => { await api('admin.branch.delete', { id: r.id }); render(); } }, T('Eltávolítás'))))))
      : h('p', { class: 'empty' }, T('Még nincs ág hozzárendelve.')));
}

// ------------------------------------------------------------------ approvals
const FIELD_L = { given: 'Keresztnév', surname: 'Vezetéknév', title: 'Előtag', nickname: 'Becenév', married_name: 'Asszonynév', sex: 'Nem', deceased: 'Elhunyt', notes: 'Életrajz',
  birth_date: 'Születés', birth_place: 'Születés helye', death_date: 'Halál', death_place: 'Halál helye', type: 'Típus', label: 'Megnevezés', date: 'Dátum', place: 'Hely', note: 'Jegyzet',
  title_: 'Cím', descr: 'Leírás', body: 'Szöveg', husband_id: 'Férj', wife_id: 'Feleség', marriage_date: 'Házasság', marriage_place: 'Házasság helye', divorced: 'Elváltak', person_ids: 'Szereplők' };
function fmtVal(k, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'husband_id' || k === 'wife_id' || k === 'person_id') return personName(P(v));
  if (k === 'person_ids') return (v || []).map(x => personName(P(x), { short: true })).join(', ') || '—';
  if (typeof v === 'boolean') return v ? T('igen') : T('nem');
  if (k === 'sex') return { M: T('férfi'), F: T('nő'), U: T('ismeretlen') }[v] || v;
  const s = String(v); return s.length > 160 ? s.slice(0, 160) + '…' : s;
}
async function changesTab(qs) {
  const status = qs?.get('status') || 'pending';
  const rows = await api('admin.changes', null, { query: { status } });
  const tabs = h('div', { class: 'tabs' }, [['pending', T('Várakozó')], ['approved', T('Elfogadott')], ['rejected', T('Elutasított')]].map(([k, l]) => h('button', { class: k === status ? 'on' : '', onclick: () => go('#/admin/changes?status=' + k) }, l)));
  const card = c => {
    const note = h('input', { type: 'text', placeholder: T('Megjegyzés a beküldőnek (nem kötelező)') });
    const p = c.payload || {}, b = c.before || {};
    const keys = Object.keys(p).filter(k => !['id', 'rel', 'links', 'family_ids'].includes(k));
    const diff = keys.length && c.status === 'pending' ? h('div', { class: 'diff' }, keys.flatMap(k => {
      const ov = k === 'date' ? b.date_raw : b[k];
      const changed = c.before ? String(ov ?? '') !== String(p[k] ?? '') : true;
      if (!changed) return [];
      return [h('span', { class: 'k' }, T(FIELD_L[k] || k)), h('span', { class: c.before ? 'old' : 'muted' }, c.before ? fmtVal(k, ov) : ''), h('span', { class: 'new' }, fmtVal(k, p[k]))];
    })) : null;
    const target = c.entity === 'person' && c.entity_id && P(c.entity_id) ? h('a', { href: '#/person/' + c.entity_id }, personName(P(c.entity_id))) : null;
    return h('div', { class: 'change' },
      h('div', { class: 'hd' }, h('b', null, c.summary), target, h('span', { class: 'hint' }, `${c.user_name || '?'} · ${c.created?.slice(0, 16)}`)),
      c.photo ? h('img', { src: c.photo.thumb, alt: '', style: 'max-height:160px;border-radius:6px;margin:10px 0' }) : null,
      diff,
      p.rel ? h('p', { class: 'hint' }, T('Kapcsolat: '), (() => { const who = p.rel.of ? personName(P(p.rel.of)) : p.rel.family_id ? familyLabel(F(p.rel.family_id)) : '?'; return ({ child: T('{0} gyermeke', who), parent: T('{0} szülője', who), spouse: T('{0} házastársa', who) })[p.rel.type] || who; })()) : null,
      c.status === 'pending' ? h('div', { class: 'row', style: 'margin-top:10px' }, h('div', { class: 'grow' }, note),
        h('button', { class: 'btn btn-danger', onclick: async () => { try { await api('admin.review', { id: c.id, approve: false, note: note.value }); toast(T('Elutasítva.')); S.boot.pending--; render(); } catch (e) { fail(e); } } }, T('Elutasítás')),
        h('button', { class: 'btn btn-primary', onclick: async () => { try { await api('admin.review', { id: c.id, approve: true, note: note.value }); toast(T('Elfogadva és alkalmazva.')); S.boot.pending--; await loadTree(true); render(); } catch (e) { fail(e); } } }, icon('check'), T('Elfogadás')))
        : h('p', { class: 'hint', style: 'margin:6px 0 0' }, (c.status === 'approved' ? T('Elfogadva ') : T('Elutasítva ')) + (c.reviewed?.slice(0, 16) || ''), c.review_note ? ' · „' + c.review_note + '”' : ''));
  };
  return h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, T('Jóváhagyások')), h('p', null, T('A családfők és családtagok módosításai, törlései és javaslatai itt várnak rád.')))), tabs,
    rows.length ? rows.map(card) : h('p', { class: 'empty' }, status === 'pending' ? T('Nincs várakozó kérés.') : T('Nincs ilyen kérés.')));
}

// ------------------------------------------------------------------ import / export
// ------------------------------------------------------------------ photo hunting
/** Steps from one person to everyone (parents, children, spouses = 1 step each). */
function kinDistance(from) {
  const dist = new Map();
  if (!from || !P(from)) return dist;
  dist.set(from, 0);
  const queue = [from];
  while (queue.length) {
    const id = queue.shift(), p = P(id), d = dist.get(id) + 1;
    const next = [];
    for (const fid of p.fc || []) { const f = F(fid); if (f) next.push(f.h, f.w); }
    for (const fid of p.fs || []) { const f = F(fid); if (f) next.push(f.h, f.w, ...(f.c || [])); }
    for (const n of next) if (n && !dist.has(n) && P(n)) { dist.set(n, d); queue.push(n); }
  }
  return dist;
}

async function noPhotoTab(qs) {
  const box = h('div');
  let data;
  try { data = await api('admin.nophoto'); } catch (e) { return h('p', { class: 'hint' }, e.message); }
  const me = S.user.person_id || null;
  const dist = kinDistance(me || S.tree.home || null);
  const st = { q: qs?.get('q') || '', kind: qs?.get('kind') || 'none', life: qs?.get('life') || 'all', sort: qs?.get('sort') || (dist.size ? 'kin' : 'birth'), limit: 150 };
  const q = h('input', { type: 'search', placeholder: T('Szűrés névre, évre…'), value: st.q });
  const sel = (key, opts) => h('select', { onchange: e => { st[key] = e.target.value; st.limit = 150; draw(); } }, opts.map(([v, l]) => h('option', { value: v, selected: st[key] === v }, T(l))));
  const listEl = h('div');
  const summary = h('p');
  const reload = async () => { await loadTree(true); data = await api('admin.nophoto'); draw(); };
  const draw = () => {
    const all = data.list.filter(r => P(r.id));
    const none = all.filter(r => !r.photos.length).length;
    summary.replaceChildren(T('{0} családtagnak nincs portréja ({1} személyből).', all.length, data.total), ' ',
      all.length - none ? T('Közülük {0} már szerepel megjelölve valamelyik fotón – nekik elég portrét választani.', all.length - none) : '');
    const words = st.q ? st.q.toLocaleLowerCase('hu').normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean) : [];
    let rows = all.filter(r => {
      const p = P(r.id);
      if (st.kind === 'none' && r.photos.length) return false;
      if (st.kind === 'tagged' && !r.photos.length) return false;
      if (st.life === 'dead' && p.liv) return false;
      if (st.life === 'living' && !p.liv) return false;
      if (!words.length) return true;
      const t = (personName(p) + ' ' + (p.n || '') + ' ' + (p.b || '')).toLocaleLowerCase('hu').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return words.every(w => t.includes(w));
    });
    const by = p => p.b || p.bs || 9999;
    if (st.sort === 'kin') rows.sort((a, b) => (dist.get(a.id) ?? 999) - (dist.get(b.id) ?? 999) || by(P(a.id)) - by(P(b.id)));
    else if (st.sort === 'birth') rows.sort((a, b) => by(P(a.id)) - by(P(b.id)));
    else rows.sort((a, b) => personName(P(a.id)).localeCompare(personName(P(b.id)), 'hu'));
    const shown = rows.slice(0, st.limit);
    listEl.replaceChildren(
      h('p', { class: 'hint' }, T('{0} találat', rows.length)),
      shown.length ? h('table', { class: 'tbl nophoto' }, shown.map(r => {
        const p = P(r.id);
        const par = parentsOf(r.id).map(id => personName(P(id), { short: true })).join(' és ');
        return h('tr', null,
          h('td', null, chip(r.id), par ? h('div', { class: 'hint' }, T('Szülei: {0}', par)) : null),
          h('td', { class: 'hint', style: 'white-space:nowrap' }, st.sort === 'kin' && dist.has(r.id) ? T('{0} lépés', dist.get(r.id)) : ''),
          h('td', { class: 'np-act' },
            r.photos.length ? h('button', { class: 'btn btn-sm', title: T('A csillaggal választhatsz portrét'), onclick: () => {
              photoViewer(r.photos.map(id => ({ id })));
              // when the viewer closes, the list follows (a portrait may have been chosen)
              const mo = new MutationObserver(() => { if (!document.querySelector('.lightbox')) { mo.disconnect(); reload().catch(fail); } });
              mo.observe(document.getElementById('modal-root') || document.body, { childList: true });
            } }, icon('photo'), T('{0} fotón szerepel', r.photos.length)) : null,
            h('button', { class: 'btn btn-sm btn-primary', onclick: () => uploadPhotos({ person_id: r.id }, () => reload().catch(fail)) }, icon('photo'), T('Fotó feltöltése'))));
      })) : h('p', { class: 'empty' }, T('Nincs ilyen családtag.')),
      rows.length > shown.length ? h('button', { class: 'btn', onclick: () => { st.limit += 300; draw(); } }, T('Továbbiak ({0})', rows.length - shown.length)) : null);
  };
  let tmr;
  q.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => { st.q = q.value.trim(); draw(); }, 150); });
  box.append(h('h1', null, T('Fénykép nélkül')),
    h('p', { class: 'muted' }, T('Vadássz fotókat: ezeknek a családtagoknak még nincs portréja a fán.')),
    summary,
    h('div', { class: 'tools' }, q,
      sel('kind', [['none', 'Semmilyen fotón nem szerepel'], ['tagged', 'Fotón szerepel, de nincs portréja'], ['all', 'Mindenki portré nélkül']]),
      sel('life', [['all', 'Élők és elhunytak'], ['dead', 'Csak elhunytak'], ['living', 'Csak élők']]),
      sel('sort', [...(dist.size ? [['kin', me ? 'Hozzám legközelebbiek elöl' : 'A kezdőlap gyökeréhez legközelebbiek elöl']] : []), ['birth', 'Születési év szerint'], ['name', 'Név szerint']])),
    listEl);
  draw();
  return box;
}

// ------------------------------------------------------------------ full backup / restore
const fmtBytes = b => b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' kB';
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** api() with a few retries – a long job must survive a flaky connection. */
async function apiRetry(action, data, tries = 5) {
  for (let i = 0; ; i++) {
    try { return await api(action, data); }
    catch (e) { if (i >= tries - 1 || (e.status && e.status < 500 && e.status !== 408 && e.status !== 429)) throw e; await sleep(1500 * (i + 1)); }
  }
}

function backupSection() {
  const box = h('section', { class: 'section panel backup' });
  const bar = h('progress', { max: 1, value: 0 });
  const barTxt = h('span', { class: 'hint' });
  const prog = h('div', { class: 'bk-prog', hidden: true }, bar, barTxt);
  const setProg = (txt, v, max) => { prog.hidden = false; barTxt.textContent = txt; if (max) { bar.max = max; bar.value = v; } else bar.removeAttribute('value'); };
  const listEl = h('div', null, h('p', { class: 'hint' }, T('Betöltés…')));
  const fileIn = h('input', { type: 'file', accept: '.zip,application/zip' });
  let busy = false, info = null;
  const lock = on => { busy = on; box.querySelectorAll('button').forEach(b => { if (!b.dataset.free) b.disabled = on; }); };

  /** Drive a running backup or restore job to the end. */
  const runJob = async (st, label) => {
    while (!st.done) {
      const what = st.kind === 'backup' ? T('Mentés: fotók becsomagolása') : st.stage === 'db' ? T('Visszaállítás: adatbázis cseréje') : T('Visszaállítás: fotók kicsomagolása és ellenőrzése');
      setProg(`${label || what} – ${st.i} / ${st.n}`, st.i, Math.max(1, st.n));
      st = await apiRetry('admin.backup.step', {});
    }
    return st;
  };
  const makeBackup = async () => {
    setProg(T('Mentés: adatbázis kiírása…'));
    const r = await runJob(await api('admin.backup.start', {}));
    toast(T('A mentés elkészült ({0}).', fmtBytes(r.size)) + (r.missing ? ' ' + T('{0} fájl közben eltűnt, kimaradt.', r.missing) : ''));
    return r;
  };

  const restore = async b => {
    const ins = await api('admin.backup.inspect', { name: b.name });
    const m = ins.manifest, t = m.tables || {};
    const safety = h('input', { type: 'checkbox', checked: true });
    const proceed = await new Promise(res => {
      let ok = false;
      modal({ title: T('Visszaállítás mentésből'), wide: true, onClose: () => res(ok),
        body: h('div', null,
          h('p', null, h('b', null, T('A mostani adatok mind lecserélődnek a mentés tartalmára:')), ' ', T('személyek, családok, események, fotók, sztorik, hozzászólások, felhasználók és jelszavaik, családfők, beállítások, napló.')),
          h('table', { class: 'tbl bk-sum' },
            h('tr', null, h('th', null, T('Készült')), h('td', null, (m.created || '').replace('T', ' ').slice(0, 16), m.source ? ' · ' + m.source : '')),
            h('tr', null, h('th', null, T('Tartalom')), h('td', null, T('{0} személy, {1} család, {2} fotó, {3} sztori, {4} felhasználó', t.persons ?? 0, t.families ?? 0, t.photos ?? 0, t.stories ?? 0, t.users ?? 0))),
            h('tr', null, h('th', null, T('Fájlok')), h('td', null, T('{0} kép, {1}', ins.files, fmtBytes(ins.bytes)))),
            h('tr', null, h('th', null, T('Programváltozat')), h('td', null, (m.app_version || '?') + ' · ' + T('adatbázis-szerkezet: {0}', m.schema)))),
          ins.problems.length ? h('div', { class: 'bk-warn' }, ins.problems.map(p => h('p', null, '⚠ ', T(p)))) : null,
          h('label', { class: 'check' }, safety, h('span', null, T('Előtte teljes mentés a mostani állapotról (ajánlott – így vissza lehet lépni)'))),
          h('p', { class: 'hint' }, T('Utána mindenkit kiléptetünk. A mentésben lévő fiókokkal és jelszavakkal lehet belépni – a te mostani fiókod is csak akkor marad, ha a mentésben benne van.'))),
        actions: [{ label: T('Mégse') }, ins.blocking ? null : { label: T('Visszaállítás'), cls: 'btn-danger', onClick: () => { ok = true; } }].filter(Boolean) });
    });
    if (!proceed) return;
    lock(true);
    try {
      if (safety.checked) await makeBackup();
      setProg(T('Visszaállítás indítása…'));
      const r = await runJob(await api('admin.restore.start', { name: b.name }));
      prog.hidden = true;
      await new Promise(res => modal({ title: T('A visszaállítás kész'), onClose: res,
        body: h('div', null, h('p', null, T('Visszaállítva: {0} személy, {1} fotó ({2} képfájl), {3} felhasználó.', r.persons, r.photos, r.files, r.users)),
          h('p', null, T('Mindenkit kiléptettünk. Lépj be a mentésben lévő fiókoddal.'))),
        actions: [{ label: T('Belépés'), cls: 'btn-primary' }] }));
      location.hash = '#/login'; location.reload();
    } catch (e) { fail(e); prog.hidden = true; lock(false); load(); }
  };

  const upload = async () => {
    const f = fileIn.files[0];
    if (!f) return toast(T('Válassz egy mentésfájlt (.zip).'), 'bad');
    lock(true);
    const id = [...crypto.getRandomValues(new Uint8Array(12))].map(x => x.toString(16).padStart(2, '0')).join('');
    const cs = info?.chunk || 2 * 1048576;
    let off = 0, r = null;
    try {
      while (true) {
        setProg(T('Feltöltés: {0} / {1}', fmtBytes(off), fmtBytes(f.size)), off, f.size);
        const fd = new FormData();
        fd.append('id', id); fd.append('offset', off); fd.append('total', f.size); fd.append('name', f.name);
        fd.append('chunk', f.slice(off, off + cs), 'chunk');
        r = await apiRetry('admin.backup.upload', fd);
        if (r.done) break;
        off = r.have;
      }
      toast(T('A mentés feltöltve és ellenőrizve. Most visszaállíthatod.'));
      fileIn.value = '';
    } catch (e) { fail(e); }
    prog.hidden = true; lock(false); load();
  };

  const load = async () => {
    try { info = await api('admin.backups'); } catch (e) { listEl.replaceChildren(h('p', { class: 'hint' }, e.message)); return; }
    const rows = info.backups;
    listEl.replaceChildren(
      rows.length ? h('table', { class: 'tbl bk-list' },
        h('tr', null, [T('Készült'), T('Tartalom'), T('Méret'), ''].map(x => h('th', null, x))),
        rows.map(b => {
          const m = b.manifest, t = m?.tables || {};
          return h('tr', null,
            h('td', null, (m?.created || b.mtime).replace('T', ' ').slice(0, 16), h('div', { class: 'hint' }, b.uploaded ? T('feltöltött') : T('itt készült'), m?.source && b.uploaded ? ' · ' + m.source.replace(/^https?:\/\//, '') : '')),
            h('td', null, b.error ? h('span', { class: 'bad' }, T(b.error)) : T('{0} személy, {1} fotó, {2} felhasználó', t.persons ?? 0, t.photos ?? 0, t.users ?? 0),
              b.problems?.length ? h('div', { class: 'hint bad' }, '⚠ ', b.problems.map(T).join(' ')) : null),
            h('td', { style: 'white-space:nowrap' }, fmtBytes(b.size)),
            h('td', { class: 'bk-act' },
              h('a', { class: 'btn btn-sm', href: 'api.php?a=backup.download&name=' + encodeURIComponent(b.name), download: b.name }, icon('download'), T('Letöltés')),
              b.error ? null : h('button', { class: 'btn btn-sm', onclick: () => restore(b).catch(fail) }, T('Visszaállítás')),
              h('button', { class: 'icon-btn', title: T('Törlés'), onclick: async () => {
                if (!await confirmBox(T('Mentés törlése'), T('Törlöd a szerverről ezt a mentést? ({0})', b.name), T('Törlés'))) return;
                try { await api('admin.backup.delete', { name: b.name }); load(); } catch (e) { fail(e); }
              } }, icon('trash'))));
        })) : h('p', { class: 'hint' }, T('Még nincs mentés a szerveren.')),
      h('p', { class: 'hint' }, T('Szabad hely a tárhelyen: {0}. A szerveren a legutóbbi {1} saját mentés marad meg (fogaskerék → Beállítások).', info.free == null ? '?' : fmtBytes(info.free), info.keep)));
    if (info.job && !busy) {
      // a job left running (closed tab, lost connection): continue or drop it
      listEl.prepend(h('div', { class: 'bk-warn' }, h('p', null, info.job.kind === 'backup' ? T('Félbemaradt mentés.') : T('Félbemaradt visszaállítás – eddig semmi nem változott.')),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-sm btn-primary', onclick: async () => {
            lock(true);
            try { const r = await runJob(info.job); if (r.kind === 'restore') { location.hash = '#/login'; location.reload(); return; } toast(T('Kész.')); } catch (e) { fail(e); }
            prog.hidden = true; lock(false); load();
          } }, T('Folytatás')),
          h('button', { class: 'btn btn-sm', onclick: async () => { await api('admin.backup.cancel', {}); load(); } }, T('Megszakítás')))));
    }
  };

  box.append(h('h2', null, T('Teljes mentés és visszaállítás')),
    h('p', null, T('Egyetlen ZIP fájlban minden: személyek, családok, események, fotók és bélyegképek, sztorik és fordításaik, hozzászólások, mentett diagramok, felhasználók (jelszavuk titkosítva), családfők és ágak, beállítások, jóváhagyások, napló. Nincs benne a config.php (adatbázis-jelszó, DeepL kulcs).')),
    h('p', { class: 'hint' }, T('Visszaállítani ugyanitt lehet, akár egy másik tárhelyen is: ott telepítsd a programot, lépj be, töltsd fel a mentést, majd „Visszaállítás”. A fájlt kezeld bizalmasan: élő családtagok adatait tartalmazza.')),
    h('div', { class: 'row', style: 'margin:12px 0' },
      h('button', { class: 'btn btn-primary', onclick: async () => { lock(true); try { await makeBackup(); } catch (e) { fail(e); } prog.hidden = true; lock(false); load(); } }, icon('save'), T('Mentés készítése most'))),
    prog, listEl,
    h('h3', { style: 'margin-top:18px' }, T('Mentés feltöltése (pl. visszaállításhoz egy másik tárhelyen)')),
    h('div', { class: 'row' }, fileIn, h('button', { class: 'btn', onclick: upload }, T('Feltöltés'))),
    h('p', { class: 'hint' }, T('Nagy fájl is mehet: darabokban töltődik fel, megszakadt kapcsolat után folytatja.')));
  load();
  return box;
}

async function importTab() {
  const file = h('input', { type: 'file', accept: '.ged,text/plain' });
  const zipIn = h('input', { type: 'file', accept: '.zip,application/zip' });
  const zipOut = h('div', { style: 'margin-top:10px' });
  const forceIn = h('input', { type: 'checkbox' });
  const mode = h('select', null, h('option', { value: 'add' }, T('Hozzáadás – a már meglévő GEDCOM-azonosítókat kihagyja')), h('option', { value: 'replace' }, T('Csere – a teljes családfát lecseréli')));
  const run = async source => {
    if (mode.value === 'replace' && !await confirmBox(T('A családfa lecserélése'), T('Minden személy, család és esemény törlődik, és a fájl tartalma kerül a helyükre. A fotók megmaradnak, de a jelölések elvesznek. Folytatod?'), T('Csere'))) return;
    const fd = new FormData();
    fd.append('mode', mode.value);
    if (source === 'upload') { if (!file.files[0]) return toast(T('Válassz fájlt.'), 'bad'); fd.append('file', file.files[0]); }
    try { const r = await api('admin.import', fd); toast(T("Import kész: {0} személy, {1} család, {2} esemény{3}.", r.persons, r.families, r.events, r.skipped ? `, ${r.skipped} kihagyva` : '')); await loadTree(true); }
    catch (e) { fail(e); }
  };
  return h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, T('Import és export')), h('p', null, T('Teljes mentés és visszaállítás, GEDCOM csere más családfa-programokkal, fotócsomagok, fordítás.')))),
    backupSection(),
    h('section', { class: 'section panel' }, h('h2', null, T('GEDCOM export')), h('p', null, T('A családfa letöltése GEDCOM 5.5 fájlként, a fotók hivatkozásaival – ezt a legtöbb családfa-program (MyHeritage, Ancestry, Gramps, TribalPages) be tudja olvasni. Ez nem teljes mentés: felhasználók, hozzászólások, beállítások nincsenek benne.')),
      h('a', { class: 'btn btn-primary', href: 'api.php?a=export' }, icon('download'), T('GEDCOM letöltése'))),
    h('section', { class: 'section panel' }, h('h2', null, T('GEDCOM import')), field(T('Mód'), mode),
      h('div', { class: 'row' }, file, h('button', { class: 'btn', onclick: () => run('upload') }, T('Feltöltött fájl importálása'))),
      h('p', { class: 'hint', style: 'margin-top:12px' }, T('Vagy a repo gyökerében lévő .ged fájl (pl. csurgay.ged):')),
      h('button', { class: 'btn', onclick: () => run('repo') }, T('Repo-beli GEDCOM importálása'))),
    h('section', { class: 'section panel' }, h('h2', null, T('Sztorik fordítása')),
      h('p', null, S.boot.translator ? T("Minden sztorit lefordít a bekapcsolt nyelvekre ({0}) a DeepL-lel. A már lefordított és azóta nem változott szövegeket nem küldi el újra.", (S.boot.langs || []).map(l => l.name).join(', ')) : T('A fordításhoz DeepL kulcs kell a config.php-be. Most nincs beállítva.')),
      h('div', { class: 'row' }, h('label', { class: 'check', style: 'margin:0' }, forceIn, h('span', null, T('Mindent újrafordít'))), h('button', { class: 'btn btn-primary', disabled: !S.boot.translator, onclick: async e => {
        const b = e.currentTarget; b.disabled = true; let tot = 0;
        try {
          for (let i = 0; i < 50; i++) {
            b.textContent = T('Fordítás… ') + (tot ? T("({0} kész)", tot) : '');
            const r = await api('admin.translate', { force: forceIn.checked && i === 0 });
            tot += r.translations;
            if (!r.left) break;
          }
          toast(tot ? T("{0} fordítás elkészült.", tot) : T('Minden sztori le van fordítva.'));
        } catch (er) { fail(er); }
        b.disabled = false; b.textContent = T('Fordítás indítása');
      } }, T('Fordítás indítása')))),
    textTrSection(),
    h('section', { class: 'section panel' }, h('h2', null, T('Fotócsomag importálása')),
      h('p', null, T('ZIP fájl képekkel és manifest.json leírással (pl. a TribalPages-ről mentett fotók). A képek a GEDCOM-azonosító alapján a megfelelő személyhez kerülnek; ami már bent van, azt kihagyja, így többször is futtatható.')),
      h('div', { class: 'row' }, zipIn, h('button', { class: 'btn btn-primary', onclick: async e => {
        if (!zipIn.files[0]) return toast(T('Válassz ZIP fájlt.'), 'bad');
        const b = e.currentTarget; b.disabled = true; b.textContent = T('Importálás…');
        const fd = new FormData(); fd.append('file', zipIn.files[0]);
        try {
          const r = await api('admin.photoimport', fd);
          toast(T("{0} fotó importálva, {1} személyhez kötve{2}.", r.imported, r.linked, r.skipped ? `, ${r.skipped} már bent volt` : ''));
          zipOut.replaceChildren(h('p', null, T("Importálva: {0} · személyhez kötve: {1} · kihagyva (már bent volt): {2}", r.imported, r.linked, r.skipped)),
            r.unmatched.length ? h('p', { class: 'hint' }, T('Nem talált személy ezekhez a GEDCOM-azonosítókhoz: ') + r.unmatched.join(', ')) : null,
            r.errors.length ? h('pre', null, r.errors.join('\n')) : null);
          await loadTree(true);
        } catch (er) { fail(er); }
        b.disabled = false; b.textContent = T('Fotók importálása');
      } }, T('Fotók importálása'))), zipOut));
}

// ------------------------------------------------------------------ log
async function logTab() {
  const rows = await api('admin.audit', null, { query: { limit: 400 } });
  return h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, T('Napló')), h('p', null, T('Az utolsó 400 művelet: ki, mikor, mit változtatott.')))),
    h('table', { class: 'tbl' }, h('tr', null, [T('Időpont'), 'Ki', T('Művelet'), T('Részletek')].map(t => h('th', null, t))),
      rows.map(r => h('tr', null, h('td', { style: 'white-space:nowrap' }, r.created?.slice(0, 16)), h('td', null, r.user_name || '—'), h('td', null, r.action), h('td', null, String(r.summary || '').slice(0, 200))))));
}

// ------------------------------------------------------------------ tests
async function testsTab() {
  const out = h('div');
  const show = (title, res) => {
    const pass = res.filter(r => r.status === 'pass').length, failN = res.filter(r => r.status === 'fail').length, skip = res.filter(r => r.status === 'skip').length;
    out.append(h('section', { class: 'section' }, h('h2', null, title),
      h('div', { class: 'test-sum' }, h('span', null, h('b', { style: 'color:var(--ok)' }, pass), T(' sikeres')), h('span', null, h('b', { style: `color:${failN ? 'var(--bad)' : 'var(--muted)'}` }, failN), T(' hibás')), skip ? h('span', null, h('b', { style: 'color:var(--warn)' }, skip), T(' kihagyva')) : null,
        h('span', { class: 'hint' }, Math.round(res.reduce((s, r) => s + (r.ms || 0), 0)) + ' ms')),
      res.map(r => h('div', { class: 'test-row ' + r.status }, h('span', { class: 'st' }, r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '–'), h('span', null, r.name), h('span', { class: 'ms' }, (r.ms ?? 0).toFixed(1) + ' ms'), r.msg ? h('div', { class: 'msg' }, r.msg) : null))));
  };
  const server = async () => { const r = await api('admin.tests', {}); show(T('Szerver tesztek (PHP)'), r.results); if (r.note) out.append(h('p', { class: 'hint' }, r.note)); };
  const client = async () => show(T('Böngésző tesztek (JS)'), await runClientTests());
  const btn = (label, fn) => { const b = h('button', { class: 'btn', onclick: async () => { b.disabled = true; out.replaceChildren(h('p', { class: 'muted' }, T('Futnak a tesztek…'))); try { out.replaceChildren(); await fn(); } catch (e) { fail(e); } b.disabled = false; } }, label); return b; };
  return h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, T('Autotesztek')), h('p', null, T('A szerver tesztek egy külön, memóriában létrehozott adatbázison futnak, az éles adatokat nem érintik. A böngésző tesztek a betöltött családfán, csak olvasva dolgoznak.')))),
    h('div', { class: 'row' }, btn(T('Mindegyik futtatása'), async () => { await server(); await client(); }), btn(T('Csak szerver'), server), btn(T('Csak böngésző'), client)), out);
}

async function systemTab() {
  const s = await api('admin.stats');
  const yes = v => v ? h('span', { class: 'badge ok' }, T('rendben')) : h('span', { class: 'badge bad' }, T('hiányzik'));
  return h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, T('Rendszer')))),
    h('dl', { class: 'facts' },
      h('dt', null, T('Verzió')), h('dd', null, S.boot.version),
      h('dt', null, T('Adatbázis')), h('dd', null, s.driver + T(' · tábla-előtag: ') + s.prefix + T(' · forrás: ') + s.config),
      h('dt', null, 'PHP'), h('dd', null, s.php),
      h('dt', null, T('GD képkezelés')), h('dd', null, yes(s.gd)),
      h('dt', null, T('SQLite (a tesztekhez)')), h('dd', null, yes(s.sqlite)),
      h('dt', null, T('uploads írható')), h('dd', null, yes(s.uploads_writable)),
      h('dt', null, T('DeepL kulcs (fordítás)')), h('dd', null, yes(s.deepl), s.deepl && !s.curl ? h('span', { class: 'hint' }, T(' (cURL nincs, fopen-nel próbálja)')) : null),
      h('dt', null, T('Munkamenet (belépés)')), h('dd', null, s.session || ''),
      h('dt', null, T('E-mail küldés (mail)')), h('dd', null, yes(s.mail)),
      h('dt', null, T('Feltöltési korlát')), h('dd', null, `upload_max_filesize ${s.upload_max}, post_max_size ${s.post_max}`)),
    h('h2', { style: 'margin-top:26px' }, T('Rekordok')),
    h('table', { class: 'tbl', style: 'max-width:420px' }, Object.entries(s.counts).map(([k, v]) => h('tr', null, h('td', null, k), h('td', { style: 'text-align:right' }, v)))));
}

// everything people wrote (biographies, event texts, photo titles, comments, pin captions), in every language
function textTrSection() {
  const info = h('p', { class: 'hint' }, T('Számolás…'));
  const btn = h('button', { class: 'btn btn-primary', disabled: true }, T('Mindent lefordít most'));
  const langName = l => (S.boot.langs || []).find(x => x.code === l)?.name || l;
  const show = st => {
    const parts = Object.entries(st.left).filter(([, m]) => m.n).map(([l, m]) => T('{0}: {1} szöveg, kb. {2} karakter', langName(l), m.n, m.chars.toLocaleString()));
    info.textContent = parts.length ? T('Még nincs lefordítva – ') + parts.join('; ') + '.' : T('Minden szöveg le van fordítva minden bekapcsolt nyelvre.');
    btn.disabled = !st.ready || !parts.length;
  };
  api('admin.tr_status').then(st => {
    if (!st.ready) { info.textContent = T('A fordításhoz DeepL kulcs kell a config.php-be. Most nincs beállítva.'); return; }
    show(st);
  }).catch(e => { info.textContent = e.message; });
  btn.onclick = async () => {
    btn.disabled = true; let tot = 0;
    try {
      for (let i = 0; i < 200; i++) {
        btn.textContent = T('Fordítás… ') + (tot ? T("({0} kész)", tot) : '');
        const r = await api('admin.tr_step', {});
        tot += r.done; show({ ready: true, left: r.left });
        if (!Object.values(r.left).some(m => m.n) || !r.done) break;
      }
      toast(tot ? T("{0} fordítás elkészült.", tot) : T('Nem volt mit fordítani.'));
    } catch (er) { fail(er); }
    btn.textContent = T('Mindent lefordít most');
  };
  return h('section', { class: 'section panel' }, h('h2', null, T('Életrajzok, hozzászólások, képcímek fordítása')),
    h('p', null, T('Bármelyik nyelven írták, a többi bekapcsolt nyelvre is lefordul: életrajzok, a családokról szóló jegyzetek, események megnevezése és jegyzete, fotók címe és leírása, hozzászólások, a kitűzött elemek felirata. Magától is lefordul, amikor valaki először megnézi más nyelven; ezzel előre el lehet készíteni mindet. A DeepL havi keretébe a karakterek számítanak.')),
    info, h('div', { class: 'row' }, btn));
}
