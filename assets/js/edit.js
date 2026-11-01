// Edit dialogs. Every save goes through op() → applied directly or queued for approval by the server.
import { S, T, P, F, h, api, op, modal, field, dateInput, formData, personPicker, toast, fail, opDone, confirmBox, modeNote,
  personName, years, avatar, loadTree, render, icon, gedToInput, familyLabel, chip, $, spouseIn } from './core.js';

export async function refresh() { await loadTree(true); await render(); }

const sexSelect = v => h('select', { name: 'sex' }, [['U', T('Ismeretlen')], ['M', T('Férfi')], ['F', T('Nő')]].map(([k, l]) => h('option', { value: k, selected: v === k }, l)));

/** rel: {type:'child'|'parent'|'spouse', of, family_id?, other?} for new persons. */
export function editPerson(id, rel = null, detail = null) {
  const p = id ? P(id) : null;
  const d = detail || {};
  const form = h('form', { onsubmit: e => e.preventDefault() },
    modeNote(id ? d.modes?.update : null),
    h('div', { class: 'grid2' },
      field(T('Vezetéknév'), h('input', { type: 'text', name: 'surname', value: p?.s || (rel?.type === 'child' && P(rel.of)?.sx === 'M' ? P(rel.of).s : '') || '' })),
      field(T('Keresztnév(ek)'), h('input', { type: 'text', name: 'given', value: p?.g || '' }))),
    h('div', { class: 'grid3' },
      field(T('Előtag'), h('input', { type: 'text', name: 'title', value: p?.t || '', placeholder: T('Dr., id., ifj.') })),
      field(T('Becenév'), h('input', { type: 'text', name: 'nickname', value: p?.n || '' })),
      field(T('Nem'), sexSelect(p?.sx || (rel?.type === 'spouse' ? (P(rel.of)?.sx === 'M' ? 'F' : P(rel.of)?.sx === 'F' ? 'M' : 'U') : 'U')))),
    field(T('Asszonynév / más névváltozat'), h('input', { type: 'text', name: 'married_name', value: d.married_name || '' }), T('Pl. Csurgay Péterné')),
    h('div', { class: 'grid2' },
      field(T('Születés dátuma'), dateInput('birth_date', p ? findRaw(d, 'BIRT') : '')),
      field(T('Születés helye'), h('input', { type: 'text', name: 'birth_place', value: p?.bp || '' }))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'deceased', checked: !!(p?.dec) }), h('span', null, T('Elhunyt'))),
    h('div', { class: 'grid2' },
      field(T('Halál dátuma'), dateInput('death_date', p ? findRaw(d, 'DEAT') : '')),
      field(T('Halál helye'), h('input', { type: 'text', name: 'death_place', value: p?.dp || '' }))),
    rel?.type === 'spouse' ? h('div', { class: 'grid2' }, field(T('Házasságkötés dátuma'), dateInput('marriage_date', '')), field(T('Helye'), h('input', { type: 'text', name: 'marriage_place' }))) : null,
    field(T('Életrajz, jegyzetek'), h('textarea', { name: 'notes' }, d.notes || '')),
  );
  const relTitle = rel ? { child: T('Új gyermek'), parent: T('Új szülő'), spouse: T('Új házastárs') }[rel.type] + ' – ' + personName(P(rel.of) || (rel.family_id ? P(F(rel.family_id)?.h || F(rel.family_id)?.w) : null), { short: true }) : T('Új személy');
  const actions = [{ label: T('Mégse') }];
  if (id) actions.unshift({ label: T('Törlés'), cls: 'btn-danger left', onClick: async () => {
    if (!await confirmBox(T('Személy törlése'), T("Biztosan törlöd: {0}? A kapcsolatai (családok, fotójelölések) is megszűnnek.", personName(p)), T('Törlés'))) return false;
    const r = await op('person.delete', { id }); if (opDone(r, T('Törölve.'))) { await loadTree(true); location.hash = '#/'; } } });
  actions.push({ label: id ? T('Mentés') : T('Létrehozás'), cls: 'btn-primary', onClick: async () => {
    const v = formData(form);
    if (id) {
      const r = await op('person.update', { id, ...v });
      if (opDone(r)) await refresh();
    } else {
      const payload = { ...v, rel: rel ? { ...rel, marriage_date: v.marriage_date, marriage_place: v.marriage_place } : null };
      const r = await op('person.create', payload);
      if (opDone(r, T('Hozzáadva.'))) { await loadTree(true); location.hash = '#/person/' + r.id; }
    }
  } });
  modal({ title: id ? T('Személy szerkesztése') : relTitle, body: form, actions });
}
function findRaw(d, type) { return (d.events || []).find(e => e.type === type)?.raw || ''; }

export function addRelative(id, type) {
  if (type === 'child') {
    const fams = (P(id)?.fs || []).map(F).filter(Boolean);
    if (fams.length > 1) {
      const sel = h('select', null, fams.map(f => h('option', { value: f.id }, T('Közös gyermek: ') + (spouseIn(f, id) ? personName(P(spouseIn(f, id))) : T('ismeretlen másik szülő')))), h('option', { value: '' }, T('Más / ismeretlen másik szülővel')));
      return modal({ title: T('Melyik családba?'), body: field(T('Szülők'), sel), actions: [{ label: T('Mégse') }, { label: T('Tovább'), cls: 'btn-primary', onClick: () => { setTimeout(() => editPerson(null, sel.value ? { type: 'child', family_id: +sel.value, of: id } : { type: 'child', of: id }), 50); } }] });
    }
    return editPerson(null, fams.length ? { type: 'child', family_id: fams[0].id, of: id } : { type: 'child', of: id });
  }
  editPerson(null, { type, of: id });
}

/** Link two existing persons (spouse / child / parent). */
export function linkExisting(id) {
  const kind = h('select', null, h('option', { value: 'spouse' }, T('házastársa')), h('option', { value: 'child' }, T('gyermeke')), h('option', { value: 'parent' }, T('szülője')));
  const pk = personPicker({ filter: p => p.id !== id });
  const body = h('div', null, h('p', { class: 'muted' }, T("Már szereplő személy kapcsolása ehhez: {0}", personName(P(id)))), field(T('Kapcsolat'), kind), field(T('Személy'), pk.el));
  modal({ title: T('Meglévő személy kapcsolása'), body, actions: [{ label: T('Mégse') }, { label: T('Kapcsolás'), cls: 'btn-primary', onClick: async () => {
    const other = pk.get(); if (!other) throw new Error(T('Válassz személyt.'));
    let r;
    const me = P(id), o = P(other);
    if (kind.value === 'spouse') r = await op('family.create', me.sx === 'F' || o.sx === 'M' ? { husband_id: other, wife_id: id } : { husband_id: id, wife_id: other });
    else if (kind.value === 'child') {
      let fid = me.fs?.[0];
      if (!fid) { const c = await op('family.create', me.sx === 'F' ? { wife_id: id } : { husband_id: id }); if (c.queued) return opDone(c); fid = c.id; }
      r = await op('family.child_add', { family_id: fid, person_id: other });
    } else {
      let fid = me.fc?.[0];
      if (fid) {
        const f = F(fid); const slot = o.sx === 'F' ? 'wife_id' : 'husband_id';
        if ((slot === 'wife_id' ? f.w : f.h)) throw new Error(T('Ennek a személynek már megvan ez a szülője.'));
        r = await op('family.update', { id: fid, [slot]: other });
      } else {
        const c = await op('family.create', o.sx === 'F' ? { wife_id: other } : { husband_id: other }); if (c.queued) return opDone(c);
        r = await op('family.child_add', { family_id: c.id, person_id: id });
      }
    }
    if (opDone(r, T('Összekapcsolva.'))) await refresh();
  } }] });
}

export function editFamily(fid, detail = {}) {
  const f = F(fid);
  const marr = (detail.events || []).find(e => e.type === 'MARR');
  const div = (detail.events || []).find(e => e.type === 'DIV');
  const hp = personPicker({ value: f.h }), wp = personPicker({ value: f.w });
  const form = h('form', { onsubmit: e => e.preventDefault() },
    modeNote(detail.modes?.update),
    h('div', { class: 'grid2' }, field(T('Férj / apa'), hp.el), field(T('Feleség / anya'), wp.el)),
    h('div', { class: 'grid2' }, field(T('Házasságkötés'), dateInput('marriage_date', marr?.raw || '')), field(T('Helye'), h('input', { type: 'text', name: 'marriage_place', value: marr?.place || '' }))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'divorced', checked: !!div }), h('span', null, T('Elváltak'))),
    field(T('Válás dátuma'), dateInput('divorce_date', div?.raw || '')),
    field(T('Jegyzet a családról'), h('textarea', { name: 'notes' }, detail.notes || '')));
  modal({ title: T('Család szerkesztése'), body: form, actions: [
    { label: T('Család törlése'), cls: 'btn-danger left', onClick: async () => {
      if (!await confirmBox(T('Család törlése'), T('A család (házasság és a gyermekek hozzárendelése) megszűnik, a személyek megmaradnak.'), T('Törlés'))) return false;
      if (opDone(await op('family.delete', { id: fid }), T('Törölve.'))) await refresh(); } },
    { label: T('Mégse') },
    { label: T('Mentés'), cls: 'btn-primary', onClick: async () => {
      const v = formData(form);
      if (opDone(await op('family.update', { id: fid, husband_id: hp.get(), wife_id: wp.get(), ...v }))) await refresh();
    } }] });
}

export function editEvent(ev, { person_id = null, family_id = null, mode = null } = {}) {
  const types = S.boot.eventTypes;
  const famTypes = ['MARR', 'ENGA', 'DIV', 'MARB', 'MARC', 'ANUL', 'DIVF', 'EVEN'];
  const allowed = Object.keys(types).filter(t => (family_id || ev?.family_id) ? famTypes.includes(t) : !['MARR', 'ENGA', 'DIV', 'MARB', 'MARC', 'ANUL', 'DIVF'].includes(t));
  const form = h('form', { onsubmit: e => e.preventDefault() },
    modeNote(ev ? mode : null),
    field(T('Esemény'), h('select', { name: 'type' }, allowed.map(t => h('option', { value: t, selected: (ev?.type || (family_id ? 'MARR' : 'CHR')) === t }, T(types[t]))))),
    field(T('Megnevezés'), h('input', { type: 'text', name: 'label', value: ev?.label || '', placeholder: T('Pl. foglalkozás, iskola neve, egyéb esemény típusa') })),
    h('div', { class: 'grid2' }, field(T('Dátum'), dateInput('date', ev?.raw || '')), field(T('Hely'), h('input', { type: 'text', name: 'place', value: ev?.place || '' }))),
    field(T('Jegyzet'), h('textarea', { name: 'note' }, ev?.note || '')));
  const actions = [{ label: T('Mégse') }, { label: T('Mentés'), cls: 'btn-primary', onClick: async () => {
    const v = formData(form);
    const r = ev ? await op('event.update', { id: ev.id, ...v }) : await op('event.create', { ...v, person_id, family_id });
    if (opDone(r)) await refresh();
  } }];
  if (ev) actions.unshift({ label: T('Törlés'), cls: 'btn-danger left', onClick: async () => {
    if (!await confirmBox(T('Esemény törlése'), T('Biztosan törlöd ezt az eseményt?'), T('Törlés'))) return false;
    if (opDone(await op('event.delete', { id: ev.id }), T('Törölve.'))) await refresh(); } });
  modal({ title: ev ? T('Esemény szerkesztése') : T('Új esemény'), body: form, actions });
}

// ------------------------------------------------------------------ photos
export function uploadPhotos(target = {}, onDone) {
  const list = h('div', { class: 'upl-list' });
  const inp = h('input', { type: 'file', accept: 'image/*', multiple: true });
  const zone = h('label', { class: 'dropzone' }, inp, icon('photo'), h('div', null, h('b', null, T('Húzd ide a fotókat')), T(' vagy kattints a kiválasztáshoz')),
    h('div', { class: 'hint' }, T("JPEG, PNG, WebP · legfeljebb {0} MB fájlonként", S.settings.upload_max_mb)));
  const title = h('input', { type: 'text', placeholder: T('Pl. Nagyszülők esküvője') });
  const date = dateInput('date', '');
  const primary = target.person_id ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !P(target.person_id)?.ph }), h('span', null, T('Legyen ez a fő portré'))) : null;
  let files = [];
  const add = fl => { for (const f of fl) if (f.type.startsWith('image/')) { files.push(f); const it = h('div', { class: 'it' }, h('img', { src: URL.createObjectURL(f), alt: '' }), h('div', { class: 'st' }, T('várakozik'))); f._el = it; list.append(it); } };
  inp.addEventListener('change', () => add(inp.files));
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); add(e.dataTransfer.files); });
  const tl = target.person_id ? personName(P(target.person_id)) : target.family_id ? familyLabel(F(target.family_id)) : target.story_id ? T('a sztorihoz') : T('az albumba');
  const body = h('div', null, h('p', { class: 'muted' }, T('Feltöltés: '), h('b', null, tl)), zone, list,
    h('div', { class: 'grid2', style: 'margin-top:14px' }, field(T('Cím (nem kötelező)'), title), field(T('Dátum (nem kötelező)'), date)), primary);
  modal({ title: T('Fotók feltöltése'), body, actions: [{ label: T('Mégse') }, { label: T('Feltöltés'), cls: 'btn-primary', onClick: async () => {
    if (!files.length) throw new Error(T('Válassz legalább egy képet.'));
    let ok = 0, queued = 0, lastId = null;
    for (const [i, f] of files.entries()) {
      f._el.querySelector('.st').textContent = T('feltöltés…');
      const fd = new FormData();
      fd.append('file', f);
      for (const [k, v] of Object.entries(target)) if (v) fd.append(k, v);
      fd.append('title', title.value || (files.length > 1 ? '' : ''));
      fd.append('date', date.querySelector('input').value);
      if (primary && i === 0 && primary.querySelector('input').checked) fd.append('primary', '1');
      try { const r = await api('upload', fd); lastId = r.id; r.queued ? queued++ : ok++; f._el.querySelector('.st').textContent = r.queued ? T('jóváhagyásra vár') : T('kész'); }
      catch (e) { f._el.querySelector('.st').textContent = T('hiba'); toast(f.name + ': ' + e.message, 'bad'); }
    }
    if (ok) toast(T("{0} fotó feltöltve.", ok));
    if (queued) toast(T("{0} fotó jóváhagyásra vár.", queued), 'pend');
    if (onDone) onDone(lastId); else await refresh();
  } }] });
}

/** Full-screen photo viewer with tagging, focus point, edit, delete, pin. */
export async function photoViewer(list, index = 0) {
  let i = index;
  const wrap = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': T('Fotó') });
  const stage = h('div', { class: 'stage' });
  const side = h('div', { class: 'side' });
  wrap.append(stage, side);
  const close = () => { wrap.remove(); document.removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') show(i + 1); if (e.key === 'ArrowLeft') show(i - 1); };
  document.addEventListener('keydown', key);
  document.body.append(wrap);
  let focusFor = null; // person id whose face point is being set

  async function show(n) {
    if (n < 0 || n >= list.length) return;
    i = n;
    let ph;
    try { ph = await api('photo', null, { query: { id: list[i].id } }); } catch (e) { fail(e); return; }
    const img = h('img', { src: ph.file, alt: ph.title || T('Fotó') });
    const dots = h('div', { style: 'position:absolute;inset:0;pointer-events:none' });
    const holder = h('div', { style: 'position:relative;display:inline-block;max-width:100%' }, img, dots);
    const drawDots = () => {
      dots.replaceChildren();
      if (!img.complete) return;
      for (const l of ph.links) if (l.person_id && (focusFor === l.person_id || focusFor === -1)) dots.append(h('div', { class: 'focus-dot', style: `left:${l.fx * 100}%;top:${l.fy * 100}%` }));
    };
    img.addEventListener('load', drawDots);
    img.addEventListener('click', async e => {
      if (!focusFor || focusFor === -1) return;
      const r = img.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      try { const res = await op('photo.tag', { photo_id: ph.id, person_id: focusFor, fx, fy }); opDone(res, T('Arc helye mentve.')); focusFor = null; await loadTree(true); show(i); } catch (er) { fail(er); }
    });
    stage.replaceChildren(holder,
      h('button', { class: 'btn close', onclick: close }, icon('close'), T('Bezárás')),
      list.length > 1 ? h('button', { class: 'btn nav prev', 'aria-label': T('Előző'), onclick: () => show(i - 1), disabled: i === 0 }, icon('left')) : null,
      list.length > 1 ? h('button', { class: 'btn nav next', 'aria-label': T('Következő'), onclick: () => show(i + 1), disabled: i === list.length - 1 }, icon('right')) : null);
    const people = ph.links.filter(l => l.person_id && P(l.person_id));
    const fams = ph.links.filter(l => l.family_id && F(l.family_id));
    const canTag = !!S.user && ph.modes?.create !== 'deny';
    side.replaceChildren(
      h('h2', null, ph.title || T('Fotó')),
      ph.status === 'pending' ? h('p', null, h('span', { class: 'badge pend' }, T('Jóváhagyásra vár'))) : null,
      ph.date ? h('p', { class: 'muted' }, ph.date) : null,
      ph.descr ? h('p', { style: 'white-space:pre-wrap' }, ph.descr) : null,
      h('h4', { style: 'margin-top:18px' }, T('A képen')),
      people.length ? h('div', null, people.map(l => h('div', { class: 'row', style: 'justify-content:space-between' }, chip(l.person_id),
        canTag ? h('span', null,
          h('button', { class: 'icon-btn', title: T('Arc helyének megjelölése'), onclick: () => { focusFor = l.person_id; toast(T('Kattints az arcára a képen.')); drawDots(); } }, icon('user')),
          h('button', { class: 'icon-btn', title: T('Legyen a fő portréja'), onclick: async () => { try { opDone(await op('photo.primary', { photo_id: ph.id, person_id: l.person_id }), T('Fő portré beállítva.')); await loadTree(true); } catch (e) { fail(e); } } }, icon('star')),
          h('button', { class: 'icon-btn', title: T('Jelölés levétele'), onclick: async () => { try { opDone(await op('photo.untag', { photo_id: ph.id, person_id: l.person_id }), T('Jelölés levéve.')); await loadTree(true); show(i); } catch (e) { fail(e); } } }, icon('close'))) : null))) : h('p', { class: 'muted' }, T('Még senki nincs megjelölve.')),
      fams.length ? h('div', null, fams.map(l => h('p', null, h('a', { href: '#/family/' + l.family_id, onclick: close }, familyLabel(F(l.family_id)))))) : null,
      canTag ? (() => {
        const pk = personPicker({ placeholder: T('Személy megjelölése…'), onPick: async id => { if (!id) return; try { opDone(await op('photo.tag', { photo_id: ph.id, person_id: id }), T('Megjelölve.')); await loadTree(true); focusFor = id; show(i); toast(T('Most kattints az arcára a képen.')); } catch (e) { fail(e); } } });
        return h('div', { style: 'margin-top:8px' }, pk.el);
      })() : null,
      h('div', { class: 'row', style: 'margin-top:20px' },
        h('a', { class: 'btn btn-sm', href: ph.file, download: '' }, icon('download'), T('Letöltés')),
        S.user && ph.modes?.update !== 'deny' ? h('button', { class: 'btn btn-sm', onclick: () => editPhoto(ph, () => show(i)) }, icon('edit'), T('Adatok')) : null,
        S.user?.role === 'admin' ? h('button', { class: 'btn btn-sm', onclick: async () => { try { await api('pin', { kind: 'photo', ref_id: ph.id, replace: true }); toast(T('Kitűzve a kezdőlapra.')); } catch (e) { fail(e); } } }, icon('pin'), T('Kitűzés')) : null,
        S.user && ph.modes?.delete !== 'deny' ? h('button', { class: 'btn btn-sm btn-danger', onclick: async () => {
          if (!await confirmBox(T('Fotó törlése'), T('Biztosan törlöd ezt a fotót?'), T('Törlés'))) return;
          try { if (opDone(await op('photo.delete', { id: ph.id }), T('Törölve.'))) { list.splice(i, 1); if (!list.length) { close(); await refresh(); } else show(Math.min(i, list.length - 1)); } } catch (e) { fail(e); } } }, icon('trash'), T('Törlés')) : null),
      ph.uploader ? h('p', { class: 'hint', style: 'margin-top:16px' }, T('Feltöltötte: '), ph.uploader) : null);
  }
  show(i);
}

function editPhoto(ph, after) {
  const form = h('form', { onsubmit: e => e.preventDefault() },
    modeNote(ph.modes?.update),
    field(T('Cím'), h('input', { type: 'text', name: 'title', value: ph.title || '' })),
    field(T('Dátum'), dateInput('date', ph.raw || '')),
    field(T('Leírás'), h('textarea', { name: 'descr' }, ph.descr || '')));
  modal({ title: T('Fotó adatai'), body: form, actions: [{ label: T('Mégse') }, { label: T('Mentés'), cls: 'btn-primary', onClick: async () => { if (opDone(await op('photo.update', { id: ph.id, ...formData(form) }))) after && after(); } }] });
}

// ------------------------------------------------------------------ stories
export function editStory(st = null, preset = {}) {
  if (st && st.raw_body !== undefined) st = { ...st, title: st.raw_title, body: st.raw_body };
  let persons = st?.person_ids?.slice() || preset.person_ids || [];
  let families = st?.family_ids?.slice() || preset.family_ids || [];
  const tagsEl = h('div', { class: 'tags' });
  const drawTags = () => tagsEl.replaceChildren(...persons.map(id => h('span', { class: 'tag' }, personName(P(id)), h('button', { type: 'button', 'aria-label': T('Eltávolítás'), onclick: () => { persons = persons.filter(x => x !== id); drawTags(); } }, '×'))),
    ...families.map(id => h('span', { class: 'tag' }, familyLabel(F(id)), h('button', { type: 'button', onclick: () => { families = families.filter(x => x !== id); drawTags(); } }, '×'))));
  drawTags();
  const pk = personPicker({ placeholder: T('Szereplő hozzáadása…'), onPick: id => { if (id && !persons.includes(id)) { persons.push(id); drawTags(); } pk.set(null); } });
  const cover = h('select', { name: 'cover_photo_id' }, h('option', { value: '' }, T('Nincs borítókép')), (st?.photos || []).map(p => h('option', { value: p.id, selected: st?.cover && p.file === st.cover.file }, p.title || T('Fotó #') + p.id)));
  const form = h('form', { onsubmit: e => e.preventDefault() },
    modeNote(st ? st.modes?.update : null),
    field(T('Cím'), h('input', { type: 'text', name: 'title', value: st?.title || '' })),
    h('div', { class: 'grid2' },
      field(T('Mikor történt?'), dateInput('date', st?.raw || ''), T('Nem kötelező. Pl. 1944, kb. 1920, 1956. 10.')),
      (S.boot.langs || []).length > 1 ? field(T('A sztori nyelve'), h('select', { name: 'lang' }, S.boot.langs.map(l => h('option', { value: l.code, selected: (st?.lang || 'hu') === l.code }, l.name))), T('A többi nyelvre automatikusan lefordítjuk.')) : null),
    field(T('A történet'), h('textarea', { name: 'body', class: 'tall', placeholder: T('Írd le a saját szavaiddal. Új bekezdéshez hagyj üres sort.') }, st?.body || ''),
      T('Formázás: **félkövér**, *dőlt*, ## alcím, > idézet, [link szövege](#/person/12)')),
    field(T('Kikről szól?'), h('div', null, pk.el, tagsEl)),
    st?.photos?.length ? field(T('Borítókép'), cover) : null);
  const actions = [{ label: T('Mégse') }, { label: st ? T('Mentés') : T('Közzététel'), cls: 'btn-primary', onClick: async () => {
    const v = formData(form);
    const payload = { ...v, person_ids: persons, family_ids: families };
    const r = st ? await op('story.update', { id: st.id, ...payload }) : await op('story.create', payload);
    if (opDone(r, st ? T('Mentve.') : T('Közzétéve.'))) location.hash = '#/story/' + (st?.id || r.id) + '?r=' + Date.now();
  } }];
  if (st) actions.unshift({ label: T('Törlés'), cls: 'btn-danger left', onClick: async () => {
    if (!await confirmBox(T('Sztori törlése'), T("Biztosan törlöd: „{0}”?", st.title), T('Törlés'))) return false;
    if (opDone(await op('story.delete', { id: st.id }), T('Törölve.'))) location.hash = '#/stories'; } });
  modal({ title: st ? T('Sztori szerkesztése') : T('Új családi sztori'), body: form, actions, wide: true });
}
