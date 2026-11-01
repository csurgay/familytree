// Admin area behind the gear: settings, users, branch heads, approvals, import/export, log, self-tests.
import { S, P, h, api, icon, setTitle, loadTree, personName, personPicker, field, toast, fail, modal, formData, confirmBox, go, render, chip, years, familyLabel, F } from './core.js';
import { runClientTests } from './tests.js';

const TABS = [['settings', 'Beállítások'], ['changes', 'Jóváhagyások'], ['users', 'Felhasználók'], ['branches', 'Családfők és ágak'], ['import', 'Import / export'], ['log', 'Napló'], ['tests', 'Autotesztek'], ['system', 'Rendszer']];

export async function viewAdmin(tab = 'settings', qs) {
  if (S.user?.role !== 'admin') { go('#/login'); return null; }
  await loadTree();
  setTitle('Admin');
  const nav = h('nav', { class: 'admin-nav', 'aria-label': 'Admin' }, TABS.map(([k, l]) => h('a', { href: '#/admin/' + k, class: k === tab ? 'active' : '' }, l,
    k === 'changes' && S.boot.pendingChanges ? h('span', { class: 'badge pend' }, S.boot.pendingChanges) : null,
    k === 'users' && S.boot.pendingUsers ? h('span', { class: 'badge pend' }, S.boot.pendingUsers) : null)));
  const body = h('div');
  const fn = { settings: settingsTab, users: usersTab, branches: branchesTab, changes: changesTab, import: importTab, log: logTab, tests: testsTab, system: systemTab }[tab] || settingsTab;
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
    const sec = h('section', { class: 'settings-group' }, h('h2', null, g));
    for (const [, key, type, def, label, help, opt] of list) {
      const v = S.settings[key] ?? def;
      let ctl;
      if (type === 'bool') { ctl = h('input', { type: 'checkbox', checked: !!v, style: 'width:20px;height:20px;accent-color:var(--cover)' }); getters[key] = () => ctl.checked; }
      else if (type === 'int') { ctl = h('input', { type: 'number', value: v, min: opt?.[0], max: opt?.[1] }); getters[key] = () => ctl.value; }
      else if (type === 'select') { ctl = h('select', null, Object.entries(opt).map(([k, l]) => h('option', { value: k, selected: k === v }, l))); getters[key] = () => ctl.value; }
      else if (type === 'color') { ctl = h('input', { type: 'color', value: v }); getters[key] = () => ctl.value; }
      else if (type === 'multi') {
        const boxes = Object.entries(opt).map(([k, l]) => { const c = h('input', { type: 'checkbox', value: k, checked: (v || []).includes(k) }); return [c, h('label', null, c, l)]; });
        ctl = h('div', { class: 'multi' }, boxes.map(b => b[1])); getters[key] = () => boxes.filter(b => b[0].checked).map(b => b[0].value);
      } else if (type === 'person') { const pk = personPicker({ value: v || null }); ctl = pk.el; getters[key] = () => pk.get() || 0; }
      else { ctl = h('input', { type: 'text', value: v ?? '' }); getters[key] = () => ctl.value; }
      sec.append(h('div', { class: 'setting' }, h('div', { class: 'l' }, h('b', null, label), help ? h('small', null, help) : null), ctl));
    }
    form.append(sec);
  }
  const save = h('button', { class: 'btn btn-primary', onclick: async () => {
    const values = Object.fromEntries(Object.entries(getters).map(([k, g]) => [k, g()]));
    save.disabled = true;
    try { await api('admin.settings', { values }); toast('Beállítások mentve.'); setTimeout(() => location.reload(), 500); } catch (e) { fail(e); save.disabled = false; }
  } }, icon('save'), 'Beállítások mentése');
  return h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Beállítások'), h('p', null, 'Az app minden paramétere. A mentés után az oldal újratöltődik.')), save), form,
    h('div', { style: 'position:sticky;bottom:12px;text-align:right;padding-top:10px' }, (() => { const b2 = h('button', { class: 'btn btn-primary', onclick: () => save.click() }, icon('save'), 'Beállítások mentése'); return b2; })()));
}

// ------------------------------------------------------------------ users
/** Editable list of branch roots (persons) – the subtrees a family head may edit. */
function branchEditor(initial = []) {
  let ids = initial.slice();
  const list = h('div', { class: 'tags' });
  const draw = () => list.replaceChildren(...ids.map(id => h('span', { class: 'tag' }, personName(P(id)), P(id)?.b ? h('small', { class: 'muted' }, ' ' + P(id).b) : null,
    h('button', { type: 'button', 'aria-label': 'Eltávolítás', onclick: () => { ids = ids.filter(x => x !== id); draw(); } }, '×'))));
  const pk = personPicker({ placeholder: 'Ág kezdő személye (pl. a nagypapa)…', onPick: id => { if (id && !ids.includes(id)) { ids.push(id); draw(); } pk.set(null); } });
  draw();
  return { el: h('div', null, pk.el, list), get: () => ids };
}

async function usersTab() {
  const users = await api('admin.users');
  const roleL = { admin: 'Admin', head: 'Családfő', member: 'Családtag' };
  const pending = users.filter(u => u.status === 'pending');
  const others = users.filter(u => u.status !== 'pending');
  const edit = u => {
    const pk = personPicker({ value: u?.person_id || null, placeholder: 'Melyik személy ő a fában? (nem kötelező)' });
    const br = branchEditor(u?.branches || []);
    const form = h('form', { onsubmit: e => e.preventDefault() },
      h('div', { class: 'grid2' }, field('Név', h('input', { type: 'text', name: 'name', value: u?.name || '' })), field('E-mail', h('input', { type: 'email', name: 'email', value: u?.email || '' }))),
      field('Szerep', h('select', { name: 'role' }, Object.entries(roleL).map(([k, l]) => h('option', { value: k, selected: (u?.role || 'member') === k }, l))),
        'Családfő: a hozzárendelt ágán új adatot azonnal felvehet, módosítás/törlés jóváhagyással. Családtag: csak javasolhat.'),
      field('Ő a fában', pk.el),
      field('Szerkeszthető ágak', br.el, 'A kezdő személy leszármazottai és házastársaik. Ha adsz meg ágat, a családtagból családfő lesz.'),
      field(u ? 'Új jelszó (üresen hagyva marad a régi)' : 'Kezdő jelszó', h('input', { type: 'text', name: 'password', autocomplete: 'new-password', placeholder: 'legalább 8 karakter' })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'active', checked: u ? !!+u.active : true }), h('span', null, 'Aktív (beléphet)')),
      u?.intro ? h('div', { class: 'hint' }, 'Bemutatkozás a regisztrációnál: ', u.intro) : null);
    const actions = [{ label: 'Mégse' }, { label: 'Mentés', cls: 'btn-primary', onClick: async () => {
      const r = await api('admin.user.save', { id: u?.id, ...formData(form), person_id: pk.get() });
      await api('admin.user.branches', { user_id: r.id, person_ids: br.get() });
      toast('Felhasználó mentve.'); render();
    } }];
    if (u && u.id !== S.user.id) actions.unshift({ label: 'Törlés', cls: 'btn-danger left', onClick: async () => { if (!await confirmBox('Felhasználó törlése', `Törlöd: ${u.name}?`, 'Törlés')) return false; await api('admin.user.delete', { id: u.id }); render(); } });
    modal({ title: u ? 'Felhasználó szerkesztése' : 'Új felhasználó', body: form, actions });
  };
  const approve = u => {
    const pk = personPicker({ placeholder: 'Ki ő a fában? (nem kötelező)' });
    const br = branchEditor([]);
    const role = h('select', null, h('option', { value: 'member' }, 'Családtag – nézhet, javasolhat'), h('option', { value: 'head' }, 'Családfő – a megadott ágakat szerkesztheti'), h('option', { value: 'admin' }, 'Admin – mindent'));
    modal({ title: 'Regisztráció jóváhagyása', body: h('div', null,
      h('p', null, h('b', null, u.name), ' · ', u.email), u.intro ? h('blockquote', { class: 'intro' }, u.intro) : h('p', { class: 'hint' }, 'Nem írt bemutatkozást.'),
      field('Hozzáférés', role), field('Ő a fában', pk.el),
      field('Szerkeszthető ágak (nem kötelező)', br.el, 'Ha megadsz ágat, családfő lesz: azon az ágon új adatot azonnal felvehet, a módosításait te hagyod jóvá.')),
      actions: [{ label: 'Mégse' }, { label: 'Jóváhagyás', cls: 'btn-primary', onClick: async () => {
        const r = await api('admin.user.approve', { id: u.id, role: role.value, person_id: pk.get(), branch_ids: br.get() });
        toast(`${u.name} jóváhagyva (${roleL[r.role]}).`); S.boot.pending = Math.max(0, S.boot.pending - 1); S.boot.pendingUsers = Math.max(0, (S.boot.pendingUsers || 1) - 1); render();
      } }] });
  };
  const reject = async u => {
    if (!await confirmBox('Regisztráció elutasítása', `Elutasítod és törlöd ${u.name} (${u.email}) regisztrációját?`, 'Elutasítás')) return;
    try { await api('admin.user.delete', { id: u.id }); toast('Elutasítva.'); S.boot.pending = Math.max(0, S.boot.pending - 1); S.boot.pendingUsers = Math.max(0, (S.boot.pendingUsers || 1) - 1); render(); } catch (e) { fail(e); }
  };
  return h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Felhasználók'), h('p', null, S.settings.allow_register ? 'Bárki regisztrálhat; az új fiókok itt várnak a jóváhagyásodra. Családfő úgy lesz valakiből, hogy szerkeszthető ágat rendelsz hozzá.' : 'A regisztráció ki van kapcsolva (Beállítások → Hozzáférés); új családtagot itt vehetsz fel kezdő jelszóval.')),
      h('button', { class: 'btn btn-primary', onclick: () => edit(null) }, icon('plus'), 'Új felhasználó')),
    pending.length ? h('section', { class: 'section' }, h('h2', null, 'Jóváhagyásra vár (' + pending.length + ')'),
      pending.map(u => h('div', { class: 'change' },
        h('div', { class: 'hd' }, h('b', null, u.name), h('span', null, u.email), h('span', { class: 'hint' }, 'regisztrált: ' + (u.created || '').slice(0, 16))),
        u.intro ? h('p', { style: 'margin:8px 0 0;white-space:pre-wrap' }, u.intro) : null,
        h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn btn-danger', onclick: () => reject(u) }, 'Elutasítás'), h('button', { class: 'btn btn-primary', onclick: () => approve(u) }, icon('check'), 'Jóváhagyás…'))))) : null,
    h('table', { class: 'tbl' }, h('tr', null, ['Név', 'E-mail', 'Szerep', 'Ő a fában', 'Ágak', 'Utolsó belépés', ''].map(t => h('th', null, t))),
      others.map(u => h('tr', null, h('td', null, u.name, +u.active ? null : h('span', { class: 'badge bad', style: 'margin-left:6px' }, 'tiltva')), h('td', null, u.email), h('td', null, roleL[u.role] || u.role),
        h('td', null, u.person_id && P(u.person_id) ? h('a', { href: '#/person/' + u.person_id }, personName(P(u.person_id))) : '—'),
        h('td', null, u.branches?.length ? u.branches.map(id => personName(P(id), { short: true })).join(', ') : '—'),
        h('td', null, u.last_login?.slice(0, 16) || '—'), h('td', null, h('button', { class: 'btn btn-sm', onclick: () => edit(u) }, 'Szerkesztés'))))));
}

// ------------------------------------------------------------------ branches
async function branchesTab() {
  const [rows, users] = await Promise.all([api('admin.branches'), api('admin.users')]);
  const usel = h('select', null, users.filter(u => u.role !== 'admin').map(u => h('option', { value: u.id }, `${u.name} (${u.email})`)));
  const pk = personPicker({ placeholder: 'Az ág kezdő személye (pl. a nagypapa)…' });
  return h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Családfők és ágak'), h('p', null, 'Egy családfőhöz egy vagy több személyt rendelhetsz: az ő leszármazottai (és házastársaik) alkotják a családfő ágát. Ott a családfő azonnal felvehet új személyt, fotót, eseményt, sztorit; módosítani és törölni a te jóváhagyásoddal tud.'))),
    users.some(u => u.role !== 'admin') ? h('div', { class: 'panel', style: 'margin-bottom:24px' }, h('h3', null, 'Ág hozzárendelése'),
      h('div', { class: 'grid2' }, field('Családfő', usel), field('Az ág kezdete', pk.el)),
      h('button', { class: 'btn btn-primary', onclick: async () => { if (!pk.get()) return toast('Válassz személyt.', 'bad'); try { await api('admin.branch.save', { user_id: +usel.value, person_id: pk.get() }); toast('Ág hozzárendelve.'); render(); } catch (e) { fail(e); } } }, 'Hozzárendelés'))
      : h('p', { class: 'empty' }, 'Előbb vegyél fel egy nem-admin felhasználót a Felhasználók fülön.'),
    rows.length ? h('table', { class: 'tbl' }, h('tr', null, ['Családfő', 'Az ág kezdete', 'Az ág mérete', ''].map(t => h('th', null, t))),
      rows.map(r => h('tr', null, h('td', null, r.user_name), h('td', null, chip(r.person_id)), h('td', null, r.size + ' személy'),
        h('td', null, h('button', { class: 'btn btn-sm btn-danger', onclick: async () => { await api('admin.branch.delete', { id: r.id }); render(); } }, 'Eltávolítás')))))
      : h('p', { class: 'empty' }, 'Még nincs ág hozzárendelve.'));
}

// ------------------------------------------------------------------ approvals
const FIELD_L = { given: 'Keresztnév', surname: 'Vezetéknév', title: 'Előtag', nickname: 'Becenév', married_name: 'Asszonynév', sex: 'Nem', deceased: 'Elhunyt', notes: 'Életrajz',
  birth_date: 'Születés', birth_place: 'Születés helye', death_date: 'Halál', death_place: 'Halál helye', type: 'Típus', label: 'Megnevezés', date: 'Dátum', place: 'Hely', note: 'Jegyzet',
  title_: 'Cím', descr: 'Leírás', body: 'Szöveg', husband_id: 'Férj', wife_id: 'Feleség', marriage_date: 'Házasság', marriage_place: 'Házasság helye', divorced: 'Elváltak', person_ids: 'Szereplők' };
function fmtVal(k, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'husband_id' || k === 'wife_id' || k === 'person_id') return personName(P(v));
  if (k === 'person_ids') return (v || []).map(x => personName(P(x), { short: true })).join(', ') || '—';
  if (typeof v === 'boolean') return v ? 'igen' : 'nem';
  if (k === 'sex') return { M: 'férfi', F: 'nő', U: 'ismeretlen' }[v] || v;
  const s = String(v); return s.length > 160 ? s.slice(0, 160) + '…' : s;
}
async function changesTab(qs) {
  const status = qs?.get('status') || 'pending';
  const rows = await api('admin.changes', null, { query: { status } });
  const tabs = h('div', { class: 'tabs' }, [['pending', 'Várakozó'], ['approved', 'Elfogadott'], ['rejected', 'Elutasított']].map(([k, l]) => h('button', { class: k === status ? 'on' : '', onclick: () => go('#/admin/changes?status=' + k) }, l)));
  const card = c => {
    const note = h('input', { type: 'text', placeholder: 'Megjegyzés a beküldőnek (nem kötelező)' });
    const p = c.payload || {}, b = c.before || {};
    const keys = Object.keys(p).filter(k => !['id', 'rel', 'links', 'family_ids'].includes(k));
    const diff = keys.length && c.status === 'pending' ? h('div', { class: 'diff' }, keys.flatMap(k => {
      const ov = k === 'date' ? b.date_raw : b[k];
      const changed = c.before ? String(ov ?? '') !== String(p[k] ?? '') : true;
      if (!changed) return [];
      return [h('span', { class: 'k' }, FIELD_L[k] || k), h('span', { class: c.before ? 'old' : 'muted' }, c.before ? fmtVal(k, ov) : ''), h('span', { class: 'new' }, fmtVal(k, p[k]))];
    })) : null;
    const target = c.entity === 'person' && c.entity_id && P(c.entity_id) ? h('a', { href: '#/person/' + c.entity_id }, personName(P(c.entity_id))) : null;
    return h('div', { class: 'change' },
      h('div', { class: 'hd' }, h('b', null, c.summary), target, h('span', { class: 'hint' }, `${c.user_name || '?'} · ${c.created?.slice(0, 16)}`)),
      c.photo ? h('img', { src: c.photo.thumb, alt: '', style: 'max-height:160px;border-radius:6px;margin:10px 0' }) : null,
      diff,
      p.rel ? h('p', { class: 'hint' }, 'Kapcsolat: ', { child: 'gyermeke', parent: 'szülője', spouse: 'házastársa' }[p.rel.type] || '', ' → ', p.rel.of ? personName(P(p.rel.of)) : p.rel.family_id ? familyLabel(F(p.rel.family_id)) : '') : null,
      c.status === 'pending' ? h('div', { class: 'row', style: 'margin-top:10px' }, h('div', { class: 'grow' }, note),
        h('button', { class: 'btn btn-danger', onclick: async () => { try { await api('admin.review', { id: c.id, approve: false, note: note.value }); toast('Elutasítva.'); S.boot.pending--; render(); } catch (e) { fail(e); } } }, 'Elutasítás'),
        h('button', { class: 'btn btn-primary', onclick: async () => { try { await api('admin.review', { id: c.id, approve: true, note: note.value }); toast('Elfogadva és alkalmazva.'); S.boot.pending--; await loadTree(true); render(); } catch (e) { fail(e); } } }, icon('check'), 'Elfogadás'))
        : h('p', { class: 'hint', style: 'margin:6px 0 0' }, (c.status === 'approved' ? 'Elfogadva ' : 'Elutasítva ') + (c.reviewed?.slice(0, 16) || ''), c.review_note ? ' · „' + c.review_note + '”' : ''));
  };
  return h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Jóváhagyások'), h('p', null, 'A családfők és családtagok módosításai, törlései és javaslatai itt várnak rád.'))), tabs,
    rows.length ? rows.map(card) : h('p', { class: 'empty' }, status === 'pending' ? 'Nincs várakozó kérés.' : 'Nincs ilyen kérés.'));
}

// ------------------------------------------------------------------ import / export
async function importTab() {
  const file = h('input', { type: 'file', accept: '.ged,text/plain' });
  const zipIn = h('input', { type: 'file', accept: '.zip,application/zip' });
  const zipOut = h('div', { style: 'margin-top:10px' });
  const minIn = h('input', { type: 'number', min: 1, max: 5000, value: S.settings.notes_story_min || 80, style: 'width:90px;display:inline-block' });
  const forceIn = h('input', { type: 'checkbox' });
  const mode = h('select', null, h('option', { value: 'add' }, 'Hozzáadás – a már meglévő GEDCOM-azonosítókat kihagyja'), h('option', { value: 'replace' }, 'Csere – a teljes családfát lecseréli'));
  const run = async source => {
    if (mode.value === 'replace' && !await confirmBox('A családfa lecserélése', 'Minden személy, család és esemény törlődik, és a fájl tartalma kerül a helyükre. A fotók megmaradnak, de a jelölések elvesznek. Folytatod?', 'Csere')) return;
    const fd = new FormData();
    fd.append('mode', mode.value);
    if (source === 'upload') { if (!file.files[0]) return toast('Válassz fájlt.', 'bad'); fd.append('file', file.files[0]); }
    try { const r = await api('admin.import', fd); toast(`Import kész: ${r.persons} személy, ${r.families} család, ${r.events} esemény${r.skipped ? `, ${r.skipped} kihagyva` : ''}.`); await loadTree(true); }
    catch (e) { fail(e); }
  };
  return h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Import és export'), h('p', null, 'GEDCOM 5.5 formátum – a legtöbb családfa-program (MyHeritage, Ancestry, Gramps, TribalPages) ezt használja.'))),
    h('section', { class: 'section panel' }, h('h2', null, 'Export'), h('p', null, 'A teljes családfa letöltése GEDCOM fájlként, a fotók hivatkozásaival együtt.'),
      h('a', { class: 'btn btn-primary', href: 'api.php?a=export' }, icon('download'), 'GEDCOM letöltése')),
    h('section', { class: 'section panel' }, h('h2', null, 'Import'), field('Mód', mode),
      h('div', { class: 'row' }, file, h('button', { class: 'btn', onclick: () => run('upload') }, 'Feltöltött fájl importálása')),
      h('p', { class: 'hint', style: 'margin-top:12px' }, 'Vagy a repo gyökerében lévő .ged fájl (pl. csurgay.ged):'),
      h('button', { class: 'btn', onclick: () => run('repo') }, 'Repo-beli GEDCOM importálása')),
    h('section', { class: 'section panel' }, h('h2', null, 'Életrajzok átvétele sztorinak'),
      h('p', null, 'A személyekhez írt hosszabb életrajzi jegyzetekből (GEDCOM NOTE) külön sztori lesz a személy nevével és életéveivel, hozzá kötve. Az életrajz a személy lapján is megmarad; ami már átkerült, azt nem hozza létre újra.'),
      h('div', { class: 'row' }, h('label', null, 'Legalább ', minIn, ' karakteres jegyzetekből '), h('button', { class: 'btn btn-primary', onclick: async e => {
        const b = e.currentTarget; b.disabled = true;
        try { const r = await api('admin.notes2stories', { min: +minIn.value }); toast(`${r.created} új sztori, ${r.skipped} már megvolt, ${r.short} jegyzet rövidebb a határnál.`); } catch (er) { fail(er); }
        b.disabled = false;
      } }, 'Sztorik létrehozása'))),
    h('section', { class: 'section panel' }, h('h2', null, 'Sztorik fordítása'),
      h('p', null, S.boot.translator ? `Minden sztorit lefordít a bekapcsolt nyelvekre (${(S.boot.langs || []).map(l => l.name).join(', ')}) a DeepL-lel. A már lefordított és azóta nem változott szövegeket nem küldi el újra.` : 'A fordításhoz DeepL kulcs kell a config.php-be: \'deepl_key\' => \'…\'. Most nincs beállítva.'),
      h('div', { class: 'row' }, h('label', { class: 'check', style: 'margin:0' }, forceIn, h('span', null, 'Mindent újrafordít')), h('button', { class: 'btn btn-primary', disabled: !S.boot.translator, onclick: async e => {
        const b = e.currentTarget; b.disabled = true; let tot = 0;
        try {
          for (let i = 0; i < 50; i++) {
            b.textContent = 'Fordítás… ' + (tot ? `(${tot} kész)` : '');
            const r = await api('admin.translate', { force: forceIn.checked && i === 0 });
            tot += r.translations;
            if (!r.left) break;
          }
          toast(tot ? `${tot} fordítás elkészült.` : 'Minden sztori le van fordítva.');
        } catch (er) { fail(er); }
        b.disabled = false; b.textContent = 'Fordítás indítása';
      } }, 'Fordítás indítása'))),
    h('section', { class: 'section panel' }, h('h2', null, 'Fotócsomag importálása'),
      h('p', null, 'ZIP fájl képekkel és manifest.json leírással (pl. a TribalPages-ről mentett fotók). A képek a GEDCOM-azonosító alapján a megfelelő személyhez kerülnek; ami már bent van, azt kihagyja, így többször is futtatható.'),
      h('div', { class: 'row' }, zipIn, h('button', { class: 'btn btn-primary', onclick: async e => {
        if (!zipIn.files[0]) return toast('Válassz ZIP fájlt.', 'bad');
        const b = e.currentTarget; b.disabled = true; b.textContent = 'Importálás…';
        const fd = new FormData(); fd.append('file', zipIn.files[0]);
        try {
          const r = await api('admin.photoimport', fd);
          toast(`${r.imported} fotó importálva, ${r.linked} személyhez kötve${r.skipped ? `, ${r.skipped} már bent volt` : ''}.`);
          zipOut.replaceChildren(h('p', null, `Importálva: ${r.imported} · személyhez kötve: ${r.linked} · kihagyva (már bent volt): ${r.skipped}`),
            r.unmatched.length ? h('p', { class: 'hint' }, 'Nem talált személy ezekhez a GEDCOM-azonosítókhoz: ' + r.unmatched.join(', ')) : null,
            r.errors.length ? h('pre', null, r.errors.join('\n')) : null);
          await loadTree(true);
        } catch (er) { fail(er); }
        b.disabled = false; b.textContent = 'Fotók importálása';
      } }, 'Fotók importálása')), zipOut));
}

// ------------------------------------------------------------------ log
async function logTab() {
  const rows = await api('admin.audit', null, { query: { limit: 400 } });
  return h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Napló'), h('p', null, 'Az utolsó 400 művelet: ki, mikor, mit változtatott.'))),
    h('table', { class: 'tbl' }, h('tr', null, ['Időpont', 'Ki', 'Művelet', 'Részletek'].map(t => h('th', null, t))),
      rows.map(r => h('tr', null, h('td', { style: 'white-space:nowrap' }, r.created?.slice(0, 16)), h('td', null, r.user_name || '—'), h('td', null, r.action), h('td', null, String(r.summary || '').slice(0, 200))))));
}

// ------------------------------------------------------------------ tests
async function testsTab() {
  const out = h('div');
  const show = (title, res) => {
    const pass = res.filter(r => r.status === 'pass').length, failN = res.filter(r => r.status === 'fail').length, skip = res.filter(r => r.status === 'skip').length;
    out.append(h('section', { class: 'section' }, h('h2', null, title),
      h('div', { class: 'test-sum' }, h('span', null, h('b', { style: 'color:var(--ok)' }, pass), ' sikeres'), h('span', null, h('b', { style: `color:${failN ? 'var(--bad)' : 'var(--muted)'}` }, failN), ' hibás'), skip ? h('span', null, h('b', { style: 'color:var(--warn)' }, skip), ' kihagyva') : null,
        h('span', { class: 'hint' }, Math.round(res.reduce((s, r) => s + (r.ms || 0), 0)) + ' ms')),
      res.map(r => h('div', { class: 'test-row ' + r.status }, h('span', { class: 'st' }, r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '–'), h('span', null, r.name), h('span', { class: 'ms' }, (r.ms ?? 0).toFixed(1) + ' ms'), r.msg ? h('div', { class: 'msg' }, r.msg) : null))));
  };
  const server = async () => { const r = await api('admin.tests', {}); show('Szerver tesztek (PHP)', r.results); if (r.note) out.append(h('p', { class: 'hint' }, r.note)); };
  const client = async () => show('Böngésző tesztek (JS)', await runClientTests());
  const btn = (label, fn) => { const b = h('button', { class: 'btn', onclick: async () => { b.disabled = true; out.replaceChildren(h('p', { class: 'muted' }, 'Futnak a tesztek…')); try { out.replaceChildren(); await fn(); } catch (e) { fail(e); } b.disabled = false; } }, label); return b; };
  return h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Autotesztek'), h('p', null, 'A szerver tesztek egy külön, memóriában létrehozott adatbázison futnak, az éles adatokat nem érintik. A böngésző tesztek a betöltött családfán, csak olvasva dolgoznak.'))),
    h('div', { class: 'row' }, btn('Mindegyik futtatása', async () => { await server(); await client(); }), btn('Csak szerver', server), btn('Csak böngésző', client)), out);
}

async function systemTab() {
  const s = await api('admin.stats');
  const yes = v => v ? h('span', { class: 'badge ok' }, 'rendben') : h('span', { class: 'badge bad' }, 'hiányzik');
  return h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Rendszer'))),
    h('dl', { class: 'facts' },
      h('dt', null, 'Verzió'), h('dd', null, S.boot.version),
      h('dt', null, 'Adatbázis'), h('dd', null, s.driver + ' · tábla-előtag: ' + s.prefix + ' · forrás: ' + s.config),
      h('dt', null, 'PHP'), h('dd', null, s.php),
      h('dt', null, 'GD képkezelés'), h('dd', null, yes(s.gd)),
      h('dt', null, 'SQLite (a tesztekhez)'), h('dd', null, yes(s.sqlite)),
      h('dt', null, 'uploads írható'), h('dd', null, yes(s.uploads_writable)),
      h('dt', null, 'DeepL kulcs (fordítás)'), h('dd', null, yes(s.deepl), s.deepl && !s.curl ? h('span', { class: 'hint' }, ' (cURL nincs, fopen-nel próbálja)') : null),
      h('dt', null, 'E-mail küldés (mail)'), h('dd', null, yes(s.mail)),
      h('dt', null, 'Feltöltési korlát'), h('dd', null, `upload_max_filesize ${s.upload_max}, post_max_size ${s.post_max}`)),
    h('h2', { style: 'margin-top:26px' }, 'Rekordok'),
    h('table', { class: 'tbl', style: 'max-width:420px' }, Object.entries(s.counts).map(([k, v]) => h('tr', null, h('td', null, k), h('td', { style: 'text-align:right' }, v)))));
}
