// Edit dialogs. Every save goes through op() → applied directly or queued for approval by the server.
import { S, T, P, F, h, api, op, modal, tx, trText, field, dateInput, formData, personPicker, toast, fail, opDone, confirmBox, modeNote,
  personName, years, avatar, loadTree, render, icon, gedToInput, familyLabel, chip, $, spouseIn } from './core.js';

import { commentsBox } from './comments.js';
import { cropImage, shrinkImage } from './cropper.js';

export async function refresh() { await loadTree(true); await render(); }

const sexSelect = v => h('select', { name: 'sex' }, [['U', T('Ismeretlen')], ['M', T('Férfi')], ['F', T('Nő')]].map(([k, l]) => h('option', { value: k, selected: v === k }, l)));

/** rel: {type:'child'|'parent'|'spouse', of, family_id?, other?} for new persons. */
export function editPerson(id, rel = null, detail = null) {
  const p = id ? P(id) : null;
  const d = detail || {};
  const spouseKids = rel?.type === 'spouse' ? kidPicker(singleParentKids(rel.of), T('Közös gyermekeik')) : { el: null, get: () => [] };
  // a new parent of someone who has siblings with the same (single) known parent: theirs too? (ticked = yes)
  const sibFam = rel?.type === 'parent' ? (P(rel.of)?.fc || []).map(F).find(f => f && (!!f.h !== !!f.w)) : null;
  // the second parent of someone: the two parents form one family, so they become a couple – say so, and ask for the wedding
  const partnerOf = sibFam ? (sibFam.h || sibFam.w) : null;
  const marrBox = h('div', null,
    h('div', { class: 'grid2' }, field(T('Házasságkötés dátuma'), dateInput('marriage_date', '')), field(T('Helye'), h('input', { type: 'text', name: 'marriage_place' }))),
    h('p', { class: 'hint' }, T('Nem kötelező; ha nem voltak házasok, hagyd üresen.')));
  const coupleCb = h('input', { type: 'checkbox', name: 'couple', checked: true, onchange: () => { marrBox.hidden = !coupleCb.checked; } });
  const partnerBox = partnerOf ? h('div', { class: 'partner-line' }, icon('rings'), h('div', null,
    h('label', { class: 'check' }, coupleCb, h('span', null, h('b', null, T('{0} házastársa / párja', personName(P(partnerOf)))))),
    h('p', { class: 'hint' }, T('Így ők ketten lesznek {0} közös szülei, egy családban.', personName(P(rel.of), { short: true }))),
    marrBox)) : null;
  const sibKids = sibFam ? kidPicker(sibFam.c.filter(c => c !== rel.of), T('A testvéreknek is szülője?'), true, T('Akiket kiveszel, azoknál ez a szülő továbbra is ismeretlen marad.')) : { el: null, get: () => [] };
  const form = h('form', { onsubmit: e => e.preventDefault() },
    modeNote(id ? d.modes?.update : null),
    partnerBox,
    h('div', { class: 'grid2' },
      field(T('Vezetéknév'), h('input', { type: 'text', name: 'surname', value: p?.s || (rel?.type === 'child' && P(rel.of)?.sx === 'M' ? P(rel.of).s : '') || '' })),
      field(T('Keresztnév(ek)'), h('input', { type: 'text', name: 'given', value: p?.g || '' }))),
    h('div', { class: 'grid3' },
      field(T('Előtag'), h('input', { type: 'text', name: 'title', value: p?.t || '', placeholder: T('Dr., id., ifj.') })),
      field(T('Becenév'), h('input', { type: 'text', name: 'nickname', value: p?.n || '' })),
      field(T('Nem'), sexSelect(p?.sx || rel?.sex || (rel?.type === 'spouse' ? (P(rel.of)?.sx === 'M' ? 'F' : P(rel.of)?.sx === 'F' ? 'M' : 'U') : partnerOf ? (P(partnerOf)?.sx === 'M' ? 'F' : P(partnerOf)?.sx === 'F' ? 'M' : 'U') : 'U')))),
    field(T('Asszonynév / más névváltozat'), h('input', { type: 'text', name: 'married_name', value: d.married_name || '' }), T('Pl. Csurgay Péterné')),
    h('div', { class: 'grid2' },
      field(T('Születés dátuma'), dateInput('birth_date', p ? findRaw(d, 'BIRT') : '')),
      field(T('Születés helye'), h('input', { type: 'text', name: 'birth_place', value: p?.bp || '' }))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'deceased', checked: !!(p?.dec) }), h('span', null, T('Elhunyt'))),
    h('div', { class: 'grid2' },
      field(T('Halál dátuma'), dateInput('death_date', p ? findRaw(d, 'DEAT') : '')),
      field(T('Halál helye'), h('input', { type: 'text', name: 'death_place', value: p?.dp || '' }))),
    rel?.type === 'spouse' ? h('div', { class: 'grid2' }, field(T('Házasságkötés dátuma'), dateInput('marriage_date', '')), field(T('Helye'), h('input', { type: 'text', name: 'marriage_place' }))) : null,
    spouseKids.el, sibKids.el,
    field(T('Életrajz, jegyzetek'), h('textarea', { name: 'notes' }, d.notes || '')),
  );
  const relTitle = rel ? { child: T('Új gyermek'), parent: rel.sex === 'M' ? T('Apa') : rel.sex === 'F' ? T('Anya') : T('Új szülő'), spouse: T('Új házastárs') }[rel.type] + ' – ' + personName(P(rel.of) || (rel.family_id ? P(F(rel.family_id)?.h || F(rel.family_id)?.w) : null), { short: true }) : T('Új személy');
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
      const payload = { ...v, rel: rel ? { ...rel, marriage_date: v.marriage_date, marriage_place: v.marriage_place, ...(rel.type === 'spouse' ? { children: spouseKids.get() } : {}), ...(sibKids.el ? { siblings: sibKids.get() } : {}), ...(partnerOf ? { couple: coupleCb.checked } : {}) } : null };
      const r = await op('person.create', payload);
      if (!rel) { if (opDone(r, T('Hozzáadva.'))) { await loadTree(true); location.hash = '#/person/' + r.id; } return; }
      // a relative: stay where you are (the next parent / child is added from here too), offer a link to the new one
      if (r?.queued) return opDone(r);
      await refresh();
      toast(h('span', null, T('Hozzáadva: {0}', P(r.id) ? personName(P(r.id)) : [v.surname, v.given].join(' ')), ' · ', h('a', { href: '#/person/' + r.id }, T('megnyitás'))));
    }
  } });
  modal({ title: id ? T('Személy szerkesztése') : relTitle, body: form, actions });
}
function findRaw(d, type) { return (d.events || []).find(e => e.type === type)?.raw || ''; }

// ---------------------------------------------------------------- adding relatives: ask how they belong together
/** A person's families (as spouse), each with the spouse id (null = unknown other parent). */
const famsAsSpouse = id => (P(id)?.fs || []).map(F).filter(Boolean).map(f => ({ f, sp: spouseIn(f, id) }));
/** Children of `id` for whom so far only `id` is recorded as parent – candidates for "common child" with a new spouse. */
function singleParentKids(id) {
  const out = [];
  for (const { f, sp } of famsAsSpouse(id)) if (!sp) for (const c of f.c || []) if (!out.includes(c)) out.push(c);
  return out;
}
/** Checkbox list of children; returns { el, get() }. */
function kidPicker(kids, label, checked = false, hint = null) {
  if (!kids.length) return { el: null, get: () => [] };
  const boxes = kids.map(c => h('input', { type: 'checkbox', value: c, checked }));
  const el = h('div', { class: 'field kid-pick' }, h('span', { class: 'lbl' }, label),
    kids.map((c, i) => h('label', { class: 'check' }, boxes[i], h('span', null, personName(P(c)), ' ', h('span', { class: 'hint' }, years(P(c)))))),
    h('p', { class: 'hint' }, hint || T('Akiket bejelölsz, azoknál ő lesz a másik szülő.')));
  return { el, get: () => boxes.filter(b => b.checked).map(b => +b.value) };
}
/** A one-question dialog with a list of choices; resolves to the chosen value or null (cancelled). */
function choose(title, text, options, okLabel = T('Tovább')) {
  return new Promise(res => {
    let val = null, done = false;
    const name = 'ch' + Math.random().toString(36).slice(2);
    const list = h('div', { class: 'choice-list' }, options.map((o, i) => h('label', { class: 'check choice' },
      h('input', { type: 'radio', name, checked: i === 0, onchange: () => { val = o.value; } }), h('span', null, o.label, o.hint ? h('span', { class: 'hint' }, ' ' + o.hint) : null))));
    val = options[0]?.value ?? null;
    modal({ title, body: h('div', null, text ? h('p', { class: 'muted' }, text) : null, list),
      actions: [{ label: T('Mégse') }, { label: okLabel, cls: 'btn-primary', onClick: () => { done = true; setTimeout(() => res(val), 30); } }],
      onClose: () => { if (!done) res(null); } });
  });
}
const NEW = '__new', EXISTING = '__existing', NONE = '__none';

/** Which of the parent's spouses is the other parent? Offered when the child has exactly one recorded parent. */
async function otherParentChoice(childId, sex = null) {
  const fam = (P(childId)?.fc || []).map(F).find(f => f && (!!f.h !== !!f.w));
  if (!fam) return { fam: null };
  const known = fam.h || fam.w;
  const spouses = famsAsSpouse(known).filter(x => x.sp && x.f.id !== fam.id && (!sex || !P(x.sp)?.sx || P(x.sp).sx === 'U' || P(x.sp).sx === sex));
  if (!spouses.length) return { fam };
  const v = await choose(T('Ki a másik szülő?'), T('{0} szülője eddig csak {1}. {1} házastársai közül:', personName(P(childId)), personName(P(known))),
    [...spouses.map(x => ({ value: x.f.id, label: personName(P(x.sp)), hint: years(P(x.sp)) })),
      { value: NEW, label: T('Egyik sem – új személyt veszek fel') }, { value: EXISTING, label: T('Egyik sem – meglévő személyt választok') }]);
  return { fam, choice: v };
}

export async function addRelative(id, type, sex = null) {
  if (type === 'child') {
    const fams = famsAsSpouse(id);
    if (fams.some(x => x.sp)) {
      const v = await choose(T('Melyik házastárssal közös gyermek?'), null,
        [...fams.map(x => ({ value: x.f.id, label: x.sp ? personName(P(x.sp)) : T('Ismeretlen másik szülő'), hint: x.sp ? years(P(x.sp)) : '' })),
          ...(fams.some(x => !x.sp) ? [] : [{ value: NONE, label: T('Más / ismeretlen másik szülővel') }])]);
      if (v === null) return;
      return editPerson(null, v === NONE ? { type: 'child', of: id } : { type: 'child', family_id: v, of: id });
    }
    return editPerson(null, fams.length ? { type: 'child', family_id: fams[0].f.id, of: id } : { type: 'child', of: id });
  }
  if (type === 'parent') {
    const { choice } = await otherParentChoice(id, sex);
    if (choice === null) return;
    if (choice === EXISTING) return linkExisting(id, 'parent');
    if (!choice || choice === NEW) return editPerson(null, { type, of: id, ...(sex ? { sex } : {}) });
    if (choice && choice !== NEW) {
      const r = await op('family.child_move', { person_id: id, family_id: choice });
      if (opDone(r, T('Kész: a szülők most egy családban vannak.'))) await refresh();
      return;
    }
  }
  editPerson(null, { type, of: id });
}

/** Link two existing persons (spouse / child / parent). */
export function linkExisting(id, preset = 'spouse') {
  const kind = h('select', null, h('option', { value: 'spouse' }, T('házastársa')), h('option', { value: 'child' }, T('gyermeke')), h('option', { value: 'parent' }, T('szülője')));
  kind.value = preset;
  const pk = personPicker({ filter: p => p.id !== id });
  const kids = kidPicker(singleParentKids(id), T('Közös gyermekeik'));
  const kidWrap = h('div', null, kids.el);
  const sync = () => { kidWrap.hidden = kind.value !== 'spouse'; };
  kind.addEventListener('change', sync); sync();
  const body = h('div', null, h('p', { class: 'muted' }, T("Már szereplő személy kapcsolása ehhez: {0}", personName(P(id)))), field(T('Kapcsolat'), kind), field(T('Személy'), pk.el), kidWrap);
  modal({ title: T('Meglévő személy kapcsolása'), body, actions: [{ label: T('Mégse') }, { label: T('Kapcsolás'), cls: 'btn-primary', onClick: async () => {
    const other = pk.get(); if (!other) throw new Error(T('Válassz személyt.'));
    const me = P(id), o = P(other);
    let r;
    if (kind.value === 'spouse') {
      r = await op('family.create', { ...(me.sx === 'F' || o.sx === 'M' ? { husband_id: other, wife_id: id } : { husband_id: id, wife_id: other }), children: kids.get() });
    } else if (kind.value === 'child') {
      // which of my families: ask when I have a known spouse
      const fams = famsAsSpouse(id);
      let fid = fams.length === 1 && !fams[0].sp ? fams[0].f.id : null;
      if (fams.some(x => x.sp)) {
        setTimeout(async () => {
          const v = await choose(T('Melyik házastárssal közös gyermek?'), personName(o),
            [...fams.map(x => ({ value: x.f.id, label: x.sp ? personName(P(x.sp)) : T('Ismeretlen másik szülő') })), ...(fams.some(x => !x.sp) ? [] : [{ value: NONE, label: T('Más / ismeretlen másik szülővel') }])]);
          if (v === null) return;
          try {
            let f2 = v === NONE ? null : v;
            if (!f2) { const c = await op('family.create', me.sx === 'F' ? { wife_id: id } : { husband_id: id }); if (c.queued) return opDone(c); f2 = c.id; }
            const rr = await op('family.child_add', { family_id: f2, person_id: other });
            if (opDone(rr, T('Összekapcsolva.'))) await refresh();
          } catch (e) { fail(e); }
        }, 50);
        return;
      }
      if (!fid) { const c = await op('family.create', me.sx === 'F' ? { wife_id: id } : { husband_id: id }); if (c.queued) return opDone(c); fid = c.id; }
      r = await op('family.child_add', { family_id: fid, person_id: other });
    } else {
      // `other` becomes a parent of me
      const fam = (me.fc || []).map(F).find(Boolean);
      if (fam) {
        const known = fam.h || fam.w;
        const slot = o.sx === 'F' ? 'wife_id' : o.sx === 'M' ? 'husband_id' : (fam.h ? 'wife_id' : 'husband_id');
        if (fam.h && fam.w) throw new Error(T('Ennek a személynek már megvan mindkét szülője.'));
        if ((slot === 'wife_id' ? fam.w : fam.h)) throw new Error(T('Ennek a személynek már megvan ez a szülője.'));
        // the two parents may already be a couple: then the child simply moves into their family
        const shared = famsAsSpouse(known).find(x => x.sp === other);
        r = shared ? await op('family.child_move', { person_id: id, family_id: shared.f.id }) : await op('family.update', { id: fam.id, [slot]: other });
      } else {
        // no parent yet: is one of the new parent's spouses the other parent?
        const sps = famsAsSpouse(other);
        if (sps.length) {
          setTimeout(async () => {
            const v = await choose(T('Ki a másik szülő?'), T('{0} házastársai közül:', personName(o)),
              [...sps.map(x => ({ value: x.f.id, label: x.sp ? personName(P(x.sp)) : T('Ismeretlen másik szülő') })), ...(sps.some(x => !x.sp) ? [] : [{ value: NONE, label: T('Egyik sem / ismeretlen') }])]);
            if (v === null) return;
            try {
              let f2 = v === NONE ? null : v;
              if (!f2) { const c = await op('family.create', o.sx === 'F' ? { wife_id: other } : { husband_id: other }); if (c.queued) return opDone(c); f2 = c.id; }
              const rr = await op('family.child_add', { family_id: f2, person_id: id });
              if (opDone(rr, T('Összekapcsolva.'))) await refresh();
            } catch (e) { fail(e); }
          }, 50);
          return;
        }
        const c = await op('family.create', o.sx === 'F' ? { wife_id: other } : { husband_id: other }); if (c.queued) return opDone(c);
        r = await op('family.child_add', { family_id: c.id, person_id: id });
      }
    }
    if (opDone(r, T('Összekapcsolva.'))) await refresh();
  } }] });
}

/**
 * In the family dialog: for each child, whose child it is – both parents', only the father's / mother's, or (in a
 * one-parent family) the common child of that parent and one of their spouses. Returns { el, changes() }.
 */
function familyKidRows(f) {
  if (!f.c?.length) return { el: null, changes: () => [] };
  const both = f.h && f.w;
  const one = f.h || f.w;
  const sels = f.c.map(cid => {
    const opts = both
      ? [['both', T('Közös gyermekük')], ['only:' + f.h, T('Csak {0} gyermeke', personName(P(f.h)))], ['only:' + f.w, T('Csak {0} gyermeke', personName(P(f.w)))]]
      : [['both', T('Csak {0} gyermeke', personName(P(one)))],
        ...famsAsSpouse(one).filter(x => x.sp && x.f.id !== f.id).map(x => ['move:' + x.f.id, T('{0} és {1} közös gyermeke', personName(P(one)), personName(P(x.sp)))])];
    opts.push(['out', T('Kivétel ebből a családból')]);
    return h('select', { name: 'kid_' + cid, 'data-cid': cid }, opts.map(([v, l]) => h('option', { value: v }, l)));
  });
  const el = h('div', { class: 'field kid-rows' }, h('span', { class: 'lbl' }, T('Gyermekek')),
    f.c.map((cid, i) => h('div', { class: 'kid-row' }, h('span', null, personName(P(cid)), ' ', h('span', { class: 'hint' }, years(P(cid)))), sels[i])),
    h('p', { class: 'hint' }, T('Ha egy gyermek csak az egyik szülőé (pl. előző kapcsolatból), itt állíthatod át.')));
  return { el, changes: () => sels.filter(s => s.value !== 'both').map(s => [+s.dataset.cid, s.value]) };
}

export function editFamily(fid, detail = {}) {
  const f = F(fid);
  const marr = (detail.events || []).find(e => e.type === 'MARR');
  const div = (detail.events || []).find(e => e.type === 'DIV');
  const hp = personPicker({ value: f.h }), wp = personPicker({ value: f.w });
  const kidRows = familyKidRows(f);
  const form = h('form', { onsubmit: e => e.preventDefault() },
    modeNote(detail.modes?.update),
    h('div', { class: 'grid2' }, field(T('Férj / apa'), hp.el), field(T('Feleség / anya'), wp.el)),
    h('div', { class: 'grid2' }, field(T('Házasságkötés'), dateInput('marriage_date', marr?.raw || '')), field(T('Helye'), h('input', { type: 'text', name: 'marriage_place', value: marr?.place || '' }))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'divorced', checked: !!div }), h('span', null, T('Elváltak'))),
    field(T('Válás dátuma'), dateInput('divorce_date', div?.raw || '')),
    field(T('Jegyzet a családról'), h('textarea', { name: 'notes' }, detail.notes || '')),
    kidRows.el);
  modal({ title: T('Család szerkesztése'), body: form, actions: [
    { label: T('Család törlése'), cls: 'btn-danger left', onClick: async () => {
      if (!await confirmBox(T('Család törlése'), T('A család (házasság és a gyermekek hozzárendelése) megszűnik, a személyek megmaradnak.'), T('Törlés'))) return false;
      if (opDone(await op('family.delete', { id: fid }), T('Törölve.'))) await refresh(); } },
    { label: T('Mégse') },
    { label: T('Mentés'), cls: 'btn-primary', onClick: async () => {
      const v = formData(form);
      for (const k of Object.keys(v)) if (k.startsWith('kid_')) delete v[k];
      const r = await op('family.update', { id: fid, husband_id: hp.get(), wife_id: wp.get(), ...v });
      if (!opDone(r)) return;
      // children whose parents were set differently
      for (const [cid, choice] of kidRows.changes()) {
        if (choice === 'out') await op('family.child_remove', { family_id: fid, person_id: cid });
        else if (choice.startsWith('only:')) await op('family.child_single', { family_id: fid, person_id: cid, parent_id: +choice.slice(5) });
        else if (choice.startsWith('move:')) await op('family.child_move', { person_id: cid, family_id: +choice.slice(5) });
      }
      await refresh();
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
  const zone = h('label', { class: 'dropzone' }, inp, icon('photo'), (matchMedia('(pointer: coarse)').matches ? h('div', null, h('b', null, T('Koppints ide')), T(' a fotók kiválasztásához a galériából')) : h('div', null, h('b', null, T('Húzd ide a fotókat')), T(' vagy kattints a kiválasztáshoz'))),
    h('div', { class: 'hint' }, T("JPEG, PNG, WebP · legfeljebb {0} MB fájlonként", S.settings.upload_max_mb)));
  const title = h('input', { type: 'text', placeholder: T('Pl. Nagyszülők esküvője') });
  const date = dateInput('date', '');
  const primary = target.person_id ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !P(target.person_id)?.ph }), h('span', null, T('Legyen ez a fő portré'))) : null;
  // portraits are stored at most 800 px, group photos (several people) at most 1600 px
  const pxOne = +S.settings.photo_portrait_px || 800, pxGroup = +S.settings.photo_group_px || 1600;
  const groupBox = h('input', { type: 'checkbox', checked: !target.person_id });
  const group = h('label', { class: 'check' }, groupBox, h('span', null, T('Csoportkép, több emberrel (nagyobb felbontás: {0} px)', pxGroup)));
  const maxPx = () => (groupBox.checked ? pxGroup : pxOne);
  let files = [];
  const crop = async (i, shape) => {
    const f = files[i];
    try {
      const c = await cropImage(f.orig, { max: maxPx(), shape });
      if (!c) return;
      c.orig = f.orig; c._el = f._el; files[i] = c;
      f._el.querySelector('img').src = URL.createObjectURL(c);
      f._el.querySelector('.st').textContent = T('kivágva');
    } catch (e) { fail(e); }
  };
  const add = fl => {
    const added = [];
    for (const f of fl) if (f.type.startsWith('image/')) {
      f.orig = f;
      const i = files.length;
      files.push(f);
      const it = h('div', { class: 'it' }, h('img', { src: URL.createObjectURL(f), alt: '' }), h('div', { class: 'st' }, T('várakozik')),
        h('button', { type: 'button', class: 'btn btn-sm crop-btn', onclick: () => crop(i, target.person_id ? '1:1' : 'free') }, '✂ ', T('Kivágás')));
      f._el = it; list.append(it); added.push(i);
    }
    // a portrait: offer cutting out the face straight away
    if (target.person_id && added.length === 1 && files.length === 1) crop(added[0], '1:1');
  };
  inp.addEventListener('change', () => add(inp.files));
  // phones: take a picture right away (opens the camera instead of the gallery)
  const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  cam.addEventListener('change', () => { add(cam.files); cam.value = ''; });
  const camBtn = matchMedia('(pointer: coarse)').matches ? h('button', { type: 'button', class: 'btn', style: 'width:100%;margin-top:10px', onclick: () => cam.click() }, icon('photo'), T('Fénykép készítése')) : null;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); add(e.dataTransfer.files); });
  const tl = target.person_id ? personName(P(target.person_id)) : target.family_id ? familyLabel(F(target.family_id)) : target.story_id ? T('a sztorihoz') : T('az albumba');
  const body = h('div', null, h('p', { class: 'muted' }, T('Feltöltés: '), h('b', null, tl)), zone, cam, camBtn, list,
    h('div', { class: 'grid2', style: 'margin-top:14px' }, field(T('Cím (nem kötelező)'), title), field(T('Dátum (nem kötelező)'), date)), primary, group,
    h('p', { class: 'hint' }, T('A túl nagy képeket feltöltés előtt kicsinyítjük (portré: legfeljebb {0} px, csoportkép: {1} px, JPEG {2}%).', pxOne, pxGroup, +S.settings.photo_quality || 80)));
  modal({ title: T('Fotók feltöltése'), body, actions: [{ label: T('Mégse') }, { label: T('Feltöltés'), cls: 'btn-primary', onClick: async () => {
    if (!files.length) throw new Error(T('Válassz legalább egy képet.'));
    let ok = 0, queued = 0, lastId = null;
    for (const [i, f] of files.entries()) {
      f._el.querySelector('.st').textContent = T('feltöltés…');
      const fd = new FormData();
      const small = await shrinkImage(f, maxPx());
      fd.append('file', small, small.name || f.name || 'foto.jpg');
      fd.append('group', groupBox.checked ? '1' : '0');
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
  const close = () => { wrap.remove(); document.removeEventListener('keydown', key); window.removeEventListener('hashchange', close); };
  const key = e => {
    if (wrap.nextElementSibling) return;              // a dialog opened from the viewer is on top: it gets the keys
    if (e.key === 'Escape') return close();
    if (e.target.closest?.('textarea,input,select')) return; // arrows move the cursor while typing a comment
    if (e.key === 'ArrowRight') show(i + 1); if (e.key === 'ArrowLeft') show(i - 1);
  };
  document.addEventListener('keydown', key);
  // following a link (a person, a family…) leaves the viewer – the page behind it changes
  window.addEventListener('hashchange', close);
  side.addEventListener('click', e => { const a = e.target.closest('a[href^="#/"]'); if (a) close(); });
  // in the same layer as the dialogs: whatever opens later (e.g. "Adatok", "Törlés") comes on top of the viewer
  (document.getElementById('modal-root') || document.body).append(wrap);
  let focusFor = null; // person id whose face point is being set

  async function show(n) {
    if (n < 0 || n >= list.length) return;
    i = n;
    let ph;
    try { ph = await api('photo', null, { query: { id: list[i].id } }); } catch (e) { fail(e); return; }
    const img = h('img', { src: ph.file, alt: tx(ph, 'title') || T('Fotó') });
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
      ph.title ? trText(ph, 'title', 'h2') : h('h2', null, T('Fotó')),
      ph.status === 'pending' ? h('p', null, h('span', { class: 'badge pend' }, T('Jóváhagyásra vár'))) : null,
      ph.date ? h('p', { class: 'muted' }, ph.date) : null,
      ph.descr ? trText(ph, 'descr', 'p', { style: 'white-space:pre-wrap' }) : null,
      h('h4', { style: 'margin-top:18px' }, T('A képen')),
      people.length ? h('div', null, people.map(l => h('div', { class: 'tagged' }, chip(l.person_id),
        canTag ? h('span', { class: 'tag-acts' },
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
          try { const done = opDone(await op('photo.delete', { id: ph.id }), T('Törölve.')); close(); if (done) await refresh(); } catch (e) { fail(e); } } }, icon('trash'), T('Törlés')) : null),
      ph.uploader ? h('p', { class: 'hint', style: 'margin-top:16px' }, T('Feltöltötte: '), ph.uploader) : null,
      ph.status === 'ok' ? commentsBox('photo', ph.id, { compact: true }) : null);
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
