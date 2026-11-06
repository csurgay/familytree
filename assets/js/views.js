import { S, T, P, F, h, api, op, icon, LANG_NAMES, personName, years, avatar, chip, personLink, parentsOf, childrenOf, siblingsOf, spouseIn, familyLabel,
  loadTree, setTitle, md, fmtDate, splitDate, toast, fail, opDone, personPicker, field, go, norm, huCmp, photoStyle, modal, formData, render, confirmBox, pwInput } from './core.js';
import { renderChart, exportChart, CHART_KINDS, chartOrient, cardShape } from './charts.js';
import { editPerson, addRelative, linkExisting, editFamily, editEvent, uploadPhotos, photoViewer, editStory, refresh } from './edit.js';
import { commentsBox, recentComments } from './comments.js';

const isAdmin = () => S.user?.role === 'admin';
const canTry = mode => !!S.user && mode && mode !== 'deny';
const EV_ICON = { BIRT: 'birth', DEAT: 'death', BURI: 'death', MARR: 'rings', ENGA: 'rings', CHR: 'water', BAPM: 'water' };

function evSubject(e) {
  if (e.person_id) return personLink(e.person_id);
  if (e.family_id) { const f = F(e.family_id); return f ? h('a', { href: '#/family/' + f.id }, familyLabel(f)) : '—'; }
  return '';
}
function evVerb(e) {
  const p = e.person_id ? P(e.person_id) : null;
  const fem = p?.sx === 'F';
  return { BIRT: T('megszületett'), DEAT: T('elhunyt'), MARR: T('összeházasodott'), CHR: T('megkeresztelték'), BAPM: T('megkeresztelték'), ENGA: T('eljegyezték egymást'), BURI: T('eltemették'), GRAD: T('diplomát szerzett'), DIV: T('elváltak') }[e.type] || T(e.tl).toLowerCase();
}
function whenCell(e) {
  const [y, rest] = splitDate(e.raw ? fmtDate(e.raw) : e.date);
  return h('div', { class: 'when' }, y, rest ? h('small', null, rest) : null);
}
function pinBtn(kind, ref_id, label = T('Kitűzés a kezdőlapra')) {
  if (!isAdmin()) return null;
  return h('button', { class: 'icon-btn act', title: label, 'aria-label': label, onclick: async e => { e.preventDefault(); try { await api('pin', { kind, ref_id, replace: kind !== 'story' }); toast(T('Kitűzve a kezdőlapra.')); } catch (er) { fail(er); } } }, icon('pin'));
}
function timeline(events, { withSubject = true, editable = null } = {}) {
  return h('ul', { class: 'timeline' }, events.map(e => h('li', null, whenCell(e), h('span', { class: 'ico ' + e.type }, icon(EV_ICON[e.type] || 'star')),
    h('div', { class: 'what' },
      h('div', { class: 't' }, withSubject ? [evSubject(e), ' ', evVerb(e)] : [T(e.tl), e.label ? ': ' + e.label : '']),
      h('div', { class: 's' }, [withSubject && e.label ? e.label : null, e.place].filter(Boolean).join(' · ')),
      e.note ? h('div', { class: 's', style: 'white-space:pre-wrap' }, e.note) : null),
    h('div', { class: 'tl-act' },
      editable ? h('button', { class: 'icon-btn act', title: T('Szerkesztés'), onclick: () => editable(e) }, icon('edit')) : null, pinBtn('event', e.id)))));
}

// ======================================================================= HOME
export async function viewHome() {
  setTitle('');
  const [home] = await Promise.all([api('home', null, { query: { lang: S.lang } }), loadTree()]);
  const s = S.settings, st = home.stats;
  const treePin = home.pins.find(p => p.kind === 'tree');
  const evPin = home.pins.find(p => p.kind === 'event');
  const storyPins = home.pins.filter(p => p.kind === 'story');
  const photoPin = home.pins.find(p => p.kind === 'photo');
  const rootId = treePin?.ref_id || S.tree.home;
  const tp = treePin?.params || {};
  const kind = tp.kind || s.home_tree_kind;
  const facts = [];
  if (st.persons) facts.push(h('b', null, st.persons + T(' családtag')));
  if (st.generations > 1) facts.push(h('b', null, st.generations + T(' nemzedék')));
  if (st.photos) facts.push(h('b', null, st.photos + T(' fotó')));
  const factLine = facts.length ? [facts.reduce((a, f, i) => [...a, i ? (i === facts.length - 1 ? T(' és ') : ', ') : '', f], []), st.since ? [T('. A legkorábbi feljegyzés: '), h('b', null, st.since), '.'] : '.'] : T('Még üres a családfa.');

  const host = h('div', { class: 'chart-host' });
  const capText = h('span', null, treePin?.caption || (T(CHART_KINDS[kind]?.label) + ': ' + personName(P(rootId))));
  const oq = tp.orient ? `&orient=${tp.orient}` : '';
  const openBtn = h('a', { class: 'btn btn-sm', href: `#/tree/${rootId}?kind=${kind}${oq}` }, T('Megnyitás a fa-böngészőben'));
  const hero = h('section', { class: 'home-hero' },
    h('div', { class: 'hero-title' }, h('div', null, h('h1', null, s.site_title), h('p', null, s.site_subtitle)), h('p', { class: 'hero-facts' }, factLine)),
    rootId ? h('div', { class: 'hero-tree' }, host,
      h('div', { class: 'hero-tree-cap' },
        treePin ? h('span', { class: 'pin-mark' }, icon('pin')) : null,
        capText,
        openBtn)) : h('div', { style: 'padding:30px 0 40px' }, emptyTree()));

  const heroEv = evPin?.event || null;
  const left = h('div', null,
    heroEv ? pinnedEvent(evPin) : null,
    h('section', { class: 'section' }, h('h2', null, home.recentMode === 'window' ? T('Friss események') : T('Legutóbbi események'), h('a', { href: '#/events' }, T('Összes esemény'))),
      home.recentMode === 'latest' && home.recent.length ? h('p', { class: 'hint' }, T("Az elmúlt {0} napból nincs új esemény, ezért a családfa legutóbbi eseményei látszanak.", s.recent_days)) : null,
      home.recent.length ? timeline(home.recent) : h('p', { class: 'empty' }, T('Még nincs rögzített esemény.'))),
    h('section', { class: 'section' }, h('h2', null, T('Családi történetek'), h('a', { href: '#/stories' }, T('Mind'))),
      storyPins.map(p => storyTeaser(p.story, true)), home.stories.filter(x => !storyPins.some(p => p.ref_id === x.id)).map(x => storyTeaser(x)),
      !home.stories.length && !storyPins.length ? h('div', { class: 'empty' }, T('Még nincs sztori. Ki emlékszik valamire a nagyszülőkről?'), S.user ? h('div', null, h('button', { class: 'btn', onclick: () => editStory() }, icon('plus'), T('Sztori írása'))) : null) : null));

  const right = h('div', null,
    recentComments(home.comments, photoViewer),
    photoPin ? h('section', { class: 'section' }, h('h2', null, T('Kitűzött fotó')), h('a', { href: '#', onclick: e => { e.preventDefault(); photoViewer([photoPin.photo]); } }, h('img', { src: photoPin.photo.file, alt: photoPin.photo.title || '', style: 'border-radius:8px' })), photoPin.photo.title ? h('p', { class: 'muted', style: 'margin-top:6px' }, photoPin.photo.title) : null) : null,
    s.anniversaries ? h('section', { class: 'section' }, h('h2', null, T('Évfordulók')),
      home.anniversaries.length ? home.anniversaries.slice(0, 8).map(a => h('div', { class: 'ann' },
        h('div', { class: 'n' }, a.years, h('small', null, a.type === 'MARR' ? T('éve házasok') : P(a.person_id)?.dec ? T('éve született') : T('éves lesz'))),
        h('div', null, h('div', null, evSubject(a)), h('div', { class: 'hint' }, a.in_days === 0 ? 'ma' : a.in_days === 1 ? T('holnap') : T("{0} nap múlva", a.in_days), ' · ', a.date))))
        : h('p', { class: 'empty' }, T("A következő {0} napban nincs évforduló.", s.anniversary_days))) : null,
    home.newPhotos.length ? h('section', { class: 'section' }, h('h2', null, T('Új fotók'), h('a', { href: '#/people?tab=photos' }, T('Album'))),
      h('div', { class: 'thumbs' }, home.newPhotos.map((p, i) => h('a', { href: '#', onclick: e => { e.preventDefault(); photoViewer(home.newPhotos, i); } }, h('img', { src: p.thumb, alt: p.title || '' }))))) : null,
    h('section', { class: 'section' }, h('h2', null, T('Ki kicsoda?')),
      h('p', null, T('Felismered a dédszülőket? A kvízben 4 hasonló korú családtag közül kell kiválasztani, ki van a képen.')),
      h('div', { class: 'row' }, h('a', { class: 'btn btn-primary', href: '#/quiz' }, icon('quiz'), T('Kvíz indítása')), h('a', { class: 'btn', href: '#/people' }, T('Arcképcsarnok')))));

  const page = h('div', null, hero, h('div', { class: 'home-body', style: 'padding:6px max(16px, calc((100vw - 1180px) / 2)) 60px' }, h('div', { class: 'cols' }, left, right), s.home_surnames !== false ? surnameIndex() : null));
  // double click / double tap re-centres the tree right here; the caption and the explorer link follow
  let homeCtrl = null;
  const drawHome = (root, first = false) => {
    homeCtrl?.destroy();
    homeCtrl = renderChart(host, {
      kind, root, up: tp.up || s.home_tree_gens, down: tp.down || s.home_tree_down || 2, photos: s.chart_photos, style: s.chart_style, orient: tp.orient,
      places: false, interactive: true, wheel: false, focus: true, fitWidth: true, padBottom: 52, padRight: 58, ...(cardShape({}) === 'tall' ? { minScale: host.clientWidth < 640 ? 0.5 : 0.56, focusShift: 215 } : { minScale: host.clientWidth < 640 ? 0.6 : 0.8, focusShift: 130 }),
      onRecenter: id => drawHome(id), onOpen: id => go('#/person/' + id),
      popActions: id => [
        { label: T('Középre'), primary: true, run: x => drawHome(x) },
        { label: T('Adatlap'), run: x => go('#/person/' + x) },
        { label: T('Fa-böngésző'), run: x => go(`#/tree/${x}?kind=${kind}${oq}`) },
      ],
    });
    if (!first) { capText.textContent = T(CHART_KINDS[kind]?.label) + ': ' + personName(P(root)); openBtn.setAttribute('href', `#/tree/${root}?kind=${kind}${oq}`); }
  };
  if (rootId) requestAnimationFrame(() => drawHome(rootId, true));
  return page;
}
/** All surnames A–Z in columns; the big family names in bold. */
function surnameIndex() {
  const cnt = new Map();
  const junk = /^(unknown|nn|n\.\s*n\.|ismeretlen|\?+|-+)$/i;
  for (const p of S.tree.P.values()) { const sn = (p.s || '').trim(); if (sn && !junk.test(sn)) cnt.set(sn, (cnt.get(sn) || 0) + 1); }
  if (!cnt.size) return null;
  const lc = x => String(x || '').trim().toLocaleLowerCase('hu');
  const bold = new Set(String(S.settings.home_surnames_bold || '').split(/[,;\n]/).map(lc).filter(Boolean));
  const min = +S.settings.home_surnames_min || 0;
  const names = [...cnt.keys()].sort(huCmp);
  return h('section', { class: 'section surnames' }, h('h2', null, T('Családnevek'), h('span', { class: 'hint' }, T('{0} családnév', names.length))),
    h('ul', { class: 'surname-cols' }, names.map(n => {
      const big = bold.has(lc(n)) || (min > 0 && cnt.get(n) >= min);
      return h('li', null, h('a', { href: '#/surname/' + encodeURIComponent(n), class: big ? 'big' : '' }, n), h('small', null, cnt.get(n)));
    })));
}

function emptyTree() {
  return h('div', { class: 'panel', style: 'color:var(--ink)' }, h('h2', null, T('Kezdjük el a családfát')),
    h('p', null, T('Vegyél fel egy első személyt, vagy importálj GEDCOM fájlt az admin felületen.')),
    S.user ? h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', onclick: () => editPerson(null) }, icon('plus'), T('Első személy')), isAdmin() ? h('a', { class: 'btn', href: '#/admin/import' }, T('GEDCOM import')) : null) : null);
}
function pinnedEvent(pin) {
  const e = pin.event;
  const subj = e.person_id ? P(e.person_id) : null;
  const ph = pin.photo?.thumb || subj?.ph;
  return h('article', { class: 'pinned-event' },
    h('div', { class: 'ph' }, ph ? h('img', { src: pin.photo?.file || subj?.pf || ph, alt: '', style: subj && !pin.photo ? photoStyle(subj) : '' }) : null),
    h('div', null,
      h('div', { class: 'kick' }, icon('pin'), pin.caption || T(e.tl)),
      h('h2', null, evSubject(e)),
      h('p', null, [e.date, e.place].filter(Boolean).join(', '), e.label ? ' — ' + e.label : ''),
      e.note ? h('p', { style: 'margin-top:6px' }, e.note) : null,
      isAdmin() ? h('button', { class: 'btn btn-sm btn-ghost', style: 'margin-top:8px', onclick: async () => { await api('unpin', { id: pin.id }); render(); } }, T('Levétel a kezdőlapról')) : null));
}
/** One story in a list; shows whom it is about (except the people of the page it is listed on). */
function storyTeaser(s, pinned = false, exclude = []) {
  const ids = (s.person_ids || []).filter(id => P(id) && !exclude.includes(id));
  const fams = ids.length ? [] : (s.family_ids || []).filter(fid => F(fid) && !exclude.includes('f' + fid));
  const who = ids.length || fams.length ? h('div', { class: 'st-who' },
    ids.slice(0, 4).map(id => {
      const p = P(id), nm = personName(p, { short: true });
      // the name already is the title (imported life stories): say where they belong in the family instead
      const pa = parentsOf(id).map(x => personName(P(x), { short: true }));
      const rel = pa.length ? (p.sx === 'F' ? T('{0} lánya', pa.join(T(' és '))) : p.sx === 'M' ? T('{0} fia', pa.join(T(' és '))) : T('{0} gyermeke', pa.join(T(' és ')))) : '';
      const inTitle = norm(s.title).includes(norm(nm));
      return h('span', { class: 'st-p' }, avatar(p, 22), inTitle ? (rel || nm) : (rel && ids.length === 1 ? [nm, h('span', { class: 'hint' }, ' · ' + rel)] : nm));
    }),
    ids.length > 4 ? h('span', { class: 'hint' }, T('+{0} további', ids.length - 4)) : null,
    fams.map(fid => h('span', { class: 'st-p' }, icon('family'), familyLabel(F(fid))))) : null;
  return h('a', { class: 'story-teaser', href: '#/story/' + s.id },
    h('h3', null, pinned ? h('span', { style: 'color:var(--accent);margin-right:6px' }, icon('pin')) : null, s.title),
    who,
    h('p', null, [s.date, s.excerpt].filter(Boolean).join(' — ')));
}

// ======================================================================= EVENTS
export async function viewEvents(qs) {
  setTitle(T('Események'));
  await loadTree();
  const type = qs.get('type') || '';
  const evs = await api('events', null, { query: type ? { type } : {} });
  const sel = h('select', { style: 'width:auto', onchange: e => go('#/events' + (e.target.value ? '?type=' + e.target.value : '')) },
    h('option', { value: '' }, T('Minden esemény')), Object.entries(S.boot.eventTypes).map(([k, l]) => h('option', { value: k, selected: k === type }, T(l))));
  const byDecade = {};
  for (const e of evs) (byDecade[Math.floor((e.y || 0) / 10) * 10] ||= []).push(e);
  return h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, T('Események')), h('p', null, T("{0} dátummal ellátott esemény, a legfrissebbtől visszafelé.", evs.length))), sel),
    Object.keys(byDecade).sort((a, b) => b - a).map(d => h('section', { class: 'section' }, h('h2', null, d + T('-as évek')), timeline(byDecade[d]))));
}

// ======================================================================= PERSON
export async function viewPerson(id) {
  id = +id;
  await loadTree();
  const d = await api('person', null, { query: { id } });
  const p = P(id) || d.person;
  setTitle(personName(p));
  const m = d.modes;
  const bf = p.fc?.length ? F(p.fc[0]) : null;
  const lineage = bf ? [bf.h ? personName(P(bf.h), { short: true }) : null, bf.w ? personName(P(bf.w), { short: true }) : null].filter(Boolean) : [];
  const birth = d.events.find(e => e.type === 'BIRT') || d.events.find(e => e.type === 'CHR' || e.type === 'BAPM');
  const death = d.events.find(e => e.type === 'DEAT') || d.events.find(e => e.type === 'BURI');

  const portrait = h('div', { class: 'portrait' }, p.pf ? h('a', { href: '#', onclick: e => { e.preventDefault(); const i = d.photos.findIndex(x => x.id === d.photo_id); photoViewer(d.photos, Math.max(0, i)); } }, h('img', { src: p.pf, alt: personName(p), style: photoStyle(p) }))
    : h('div', { class: 'ph-empty' }, icon('silhouette'), canTry(m.create) ? h('button', { class: 'btn btn-sm', onclick: () => uploadPhotos({ person_id: id }) }, T('Portré feltöltése')) : T('Nincs fotó')));

  const tools = S.user ? h('div', { class: 'row tools' },
    canTry(m.update) ? h('button', { class: 'btn btn-sm', onclick: () => editPerson(id, null, d) }, icon('edit'), T('Szerkesztés')) : null,
    canTry(m.create) ? h('button', { class: 'btn btn-sm', onclick: () => uploadPhotos({ person_id: id }) }, icon('photo'), T('Fotó')) : null,
    canTry(m.create) ? h('button', { class: 'btn btn-sm', onclick: () => editEvent(null, { person_id: id }) }, icon('plus'), T('Esemény')) : null,
    h('button', { class: 'btn btn-sm', onclick: () => editStory(null, { person_ids: [id] }) }, icon('book'), T('Sztori')),
    h('a', { class: 'btn btn-sm', href: `#/tree/${id}?kind=hourglass` }, icon('tree'), T('Diagram')),
    isAdmin() ? h('button', { class: 'btn btn-sm', onclick: () => pinTree(id) }, icon('pin'), T('Fa kitűzése')) : null) : h('div', { class: 'row tools' }, h('a', { class: 'btn btn-sm', href: `#/tree/${id}?kind=hourglass` }, icon('tree'), T('Diagram')));

  const head = h('div', { class: 'person-head' }, portrait, h('div', null,
    lineage.length ? h('div', { class: 'lineage' }, (p.sx === 'F' ? T('{0} lánya', lineage.join(T(' és '))) : p.sx === 'M' ? T('{0} fia', lineage.join(T(' és '))) : T('{0} gyermeke', lineage.join(T(' és '))))) : null,
    h('h1', null, personName(p)),
    p.n || d.married_name ? h('div', { class: 'muted', style: 'margin-bottom:6px' }, [p.n ? `„${p.n}”` : null, d.married_name].filter(Boolean).join(' · ')) : null,
    h('div', { class: 'life' }, p.masked ? h('span', null, T('Élő személy – a részletek csak bejelentkezve láthatók.')) : [
      birth ? h('div', null, h('span', null, birth.type === 'BIRT' ? T('Született ') : T('Keresztelték ')), birth.date || '?', birth.place ? ', ' + birth.place : '') : null,
      death ? h('div', null, h('span', null, death.type === 'DEAT' ? T('Elhunyt ') : T('Eltemették ')), death.date || '?', death.place ? ', ' + death.place : '') : (p.dec ? h('div', null, h('span', null, T('Elhunyt'))) : null)]),
    tools, d.heads?.length ? h('p', { class: 'hint', style: 'margin-top:8px' }, T('Családfő: '), d.heads.map(x => x.name).join(', ')) : null));

  // ---- family column
  const fam = h('div', { class: 'panel' });
  const parents = parentsOf(id);
  fam.append(h('div', { class: 'fam-block' }, h('h4', null, T('Szülők'), bf && S.user ? h('a', { href: '#/family/' + bf.id, class: 'hint', style: 'margin-left:auto' }, T('család')) : null),
    parents.length ? parents.map(x => chip(x)) : h('p', { class: 'hint' }, T('Nincsenek rögzítve.')),
    S.user && parents.length < 2 ? h('div', { class: 'row', style: 'gap:6px' },
      parents.some(x => P(x)?.sx === 'M') ? null : h('button', { class: 'btn btn-sm btn-ghost', onclick: () => addRelative(id, 'parent', 'M') }, icon('plus'), T('Apa hozzáadása')),
      parents.some(x => P(x)?.sx === 'F') ? null : h('button', { class: 'btn btn-sm btn-ghost', onclick: () => addRelative(id, 'parent', 'F') }, icon('plus'), T('Anya hozzáadása'))) : null));
  const sibs = siblingsOf(id);
  if (sibs.length) fam.append(h('div', { class: 'fam-block' }, h('h4', null, T('Testvérek')), sibs.map(x => chip(x))));
  for (const fid of p.fs || []) {
    const f = F(fid); if (!f) continue;
    const sp = spouseIn(f, id);
    const fd = d.families.find(x => x.id === fid);
    const marr = fd?.events.find(e => e.type === 'MARR');
    fam.append(h('div', { class: 'fam-block' },
      h('h4', null, f.dv ? T('Volt házastárs') : (p.sx === 'M' ? T('Feleség') : p.sx === 'F' ? T('Férj') : T('Házastárs')), marr?.date ? h('span', null, '· ' + marr.date) : null, h('a', { href: '#/family/' + fid, class: 'hint', style: 'margin-left:auto' }, T('család'))),
      sp ? chip(sp) : h('p', { class: 'hint' }, T('Ismeretlen')),
      f.c.length ? h('div', { class: 'kids' }, h('h4', null, T('Gyermekek')), f.c.map(c => chip(c))) : null));
  }
  if (S.user) fam.append(h('div', { class: 'row', style: 'margin-top:10px' },
    h('button', { class: 'btn btn-sm', onclick: () => addRelative(id, 'spouse') }, icon('plus'), T('Házastárs')),
    h('button', { class: 'btn btn-sm', onclick: () => addRelative(id, 'child') }, icon('plus'), T('Gyermek')),
    h('button', { class: 'btn btn-sm btn-ghost', onclick: () => linkExisting(id) }, icon('link'), T('Meglévő személy'))));

  const mini = h('div', { class: 'mini-chart' });
  const evEditable = canTry(m.update) || canTry(m.create) ? e => editEvent(e, { person_id: id, mode: m.update }) : null;
  const leftCol = h('div', null,
    d.notes ? h('section', { class: 'section' }, h('h2', null, T('Életrajz')), h('div', { class: 'bio' }, d.notes)) : null,
    d.events.length ? h('section', { class: 'section' }, h('h2', null, T('Életút')), timeline(d.events, { withSubject: false, editable: evEditable })) : null,
    h('section', { class: 'section' }, h('h2', null, T('Fotók'), canTry(m.create) ? h('button', { class: 'btn btn-sm side', onclick: () => uploadPhotos({ person_id: id }) }, icon('plus'), T('Feltöltés')) : null),
      d.photos.length ? photoGrid(d.photos) : h('p', { class: 'empty' }, p.masked ? T('Élő személy fotói csak bejelentkezve láthatók.') : T('Még nincs fotó róla.'))),
    h('section', { class: 'section' }, h('h2', null, T('Sztorik'), S.user ? h('button', { class: 'btn btn-sm side', onclick: () => editStory(null, { person_ids: [id] }) }, icon('plus'), T('Új sztori')) : null),
      d.stories.length ? d.stories.map(s => storyTeaser(s, false, [id])) : h('p', { class: 'empty' }, T('Még nincs róla történet.'))),
    d.extra?.length ? h('section', { class: 'section' }, h('h2', null, T('Egyéb adatok')), h('dl', { class: 'facts' }, d.extra.map(([k, v]) => [h('dt', null, { _PHOM: T('Telefon (otthon)'), _PMOB: T('Mobil'), _POFF: T('Telefon (munka)'), EMAIL: T('E-mail') }[k] || k), h('dd', null, v)]))) : null,
    commentsBox('person', id));
  const rightCol = h('div', null, h('section', { class: 'section' }, h('h2', null, T('Család')), fam),
    h('section', { class: 'section' }, h('h2', null, T('Homokóra'), h('a', { href: `#/tree/${id}?kind=hourglass` }, T('Nagyobban'))), mini));
  requestAnimationFrame(() => renderChart(mini, { kind: 'hourglass', root: id, up: 2, down: 1, photos: true, style: S.settings.chart_style, wheel: false, focus: true,
    onRecenter: nid => go('#/person/' + nid), popActions: personPop }));
  return h('div', null, head, h('div', { class: 'person-grid' }, leftCol, rightCol));
}
/** Quick-card buttons for charts that live on a person / family page. */
const personPop = id => [
  { label: T('Adatlap'), primary: true, run: x => go('#/person/' + x) },
  { label: T('Fa-böngésző'), run: x => go(`#/tree/${x}?kind=hourglass`) },
];
function pinTree(id) {
  const kind = h('select', null, Object.entries(CHART_KINDS).filter(([k]) => k !== 'relation').map(([k, v]) => h('option', { value: k, selected: k === 'hourglass' }, T(v.label))));
  const up = h('input', { type: 'number', min: 1, max: 6, value: 2 }), down = h('input', { type: 'number', min: 1, max: 6, value: 2 });
  const cap = h('input', { type: 'text', placeholder: T('Pl. A nagyszülők családja') });
  const orient = h('select', null, h('option', { value: '' }, T('Alapértelmezett')), h('option', { value: 'v' }, T('Függőlegesen (fentről lefelé)')), h('option', { value: 'h' }, T('Vízszintesen (balról jobbra)')));
  const orientF = field(T('Nemzedékek elrendezése'), orient);
  const syncO = () => { orientF.hidden = !CHART_KINDS[kind.value]?.orient; };
  kind.addEventListener('change', syncO); syncO();
  modal({ title: T('Családfarészlet kitűzése a kezdőlapra'), body: h('div', null, h('p', { class: 'muted' }, T('Középpontban: '), personName(P(id))), field(T('Diagram'), kind), orientF, h('div', { class: 'grid2' }, field(T('Felmenő nemzedékek'), up), field(T('Leszármazott nemzedékek'), down)), field(T('Felirat'), cap)),
    actions: [{ label: T('Mégse') }, { label: T('Kitűzés'), cls: 'btn-primary', onClick: async () => { await api('pin', { kind: 'tree', ref_id: id, replace: true, caption: cap.value, params: { kind: kind.value, up: +up.value, down: +down.value, ...(orient.value && CHART_KINDS[kind.value]?.orient ? { orient: orient.value } : {}) } }); toast(T('Kitűzve a kezdőlapra.')); } }] });
}
function photoGrid(photos) {
  return h('div', { class: 'photo-grid' }, photos.map((p, i) => h('a', { href: '#', onclick: e => { e.preventDefault(); photoViewer(photos, i); } },
    h('img', { src: p.thumb, alt: p.title || '', loading: 'lazy', width: p.w, height: p.h, style: 'height:auto' }),
    p.status === 'pending' ? h('span', { class: 'badge pend' }, T('jóváhagyásra vár')) : null,
    p.title || p.date ? h('div', { class: 'cap' }, [p.title, p.date].filter(Boolean).join(' · ')) : null)));
}

// ======================================================================= FAMILY
export async function viewFamily(id) {
  id = +id;
  await loadTree();
  const f = F(id);
  if (!f) throw new Error(T('Nincs ilyen család.'));
  const d = await api('family', null, { query: { id } });
  setTitle(familyLabel(f));
  const m = d.modes;
  const host = h('div', { class: 'mini-chart', style: 'height:420px' });
  const ph = d.photos.find(x => x.id === d.photo_id) || d.photos[0];
  const page = h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, familyLabel(f)), h('p', null, [d.events.find(e => e.type === 'MARR')?.date ? T('Házasságot kötöttek: ') + d.events.find(e => e.type === 'MARR').date : null, f.c.length ? f.c.length + T(' gyermek') : null].filter(Boolean).join(' · '))),
      S.user ? h('div', { class: 'row' },
        canTry(m.update) ? h('button', { class: 'btn btn-sm', onclick: () => editFamily(id, d) }, icon('edit'), T('Szerkesztés')) : null,
        canTry(m.create) ? h('button', { class: 'btn btn-sm', onclick: () => uploadPhotos({ family_id: id }) }, icon('photo'), T('Családi fotó')) : null,
        canTry(m.create) ? h('button', { class: 'btn btn-sm', onclick: () => editPerson(null, { type: 'child', family_id: id, of: f.h || f.w }) }, icon('plus'), T('Gyermek')) : null,
        canTry(m.create) ? h('button', { class: 'btn btn-sm', onclick: () => editEvent(null, { family_id: id }) }, icon('plus'), T('Esemény')) : null,
        h('button', { class: 'btn btn-sm', onclick: () => editStory(null, { family_ids: [id] }) }, icon('book'), T('Sztori'))) : null),
    h('div', { class: 'person-grid' },
      h('div', null,
        ph ? h('section', { class: 'section' }, h('a', { href: '#', onclick: e => { e.preventDefault(); photoViewer(d.photos, d.photos.indexOf(ph)); } }, h('img', { src: ph.file, alt: ph.title || '', style: 'border-radius:8px;max-height:520px;width:auto' }))) : null,
        d.notes ? h('section', { class: 'section' }, h('h2', null, T('A családról')), h('div', { class: 'bio' }, d.notes)) : null,
        d.events.length ? h('section', { class: 'section' }, h('h2', null, T('Események')), timeline(d.events, { withSubject: false, editable: S.user ? e => editEvent(e, { family_id: id, mode: m.update }) : null })) : null,
        h('section', { class: 'section' }, h('h2', null, T('Családi fotók')), d.photos.length ? photoGrid(d.photos) : h('p', { class: 'empty' }, T('Még nincs családi fotó.'))),
        d.stories.length ? h('section', { class: 'section' }, h('h2', null, T('Sztorik')), d.stories.map(s => storyTeaser(s, false, [f.h, f.w, 'f' + id].filter(Boolean)))) : null,
        commentsBox('family', id)),
      h('div', null,
        h('section', { class: 'section' }, h('h2', null, T('Szülők')), h('div', { class: 'panel' }, [f.h, f.w].filter(Boolean).map(x => chip(x)))),
        h('section', { class: 'section' }, h('h2', null, T('Gyermekek')), h('div', { class: 'panel' }, f.c.length ? f.c.map(x => chip(x)) : h('p', { class: 'hint' }, T('Nincsenek rögzítve.')))),
        h('section', { class: 'section' }, host))));
  requestAnimationFrame(() => renderChart(host, { kind: 'descendants', root: f.h || f.w, down: 2, photos: true, wheel: false, focus: true, onRecenter: nid => go('#/person/' + nid), popActions: personPop }));
  return page;
}

// ======================================================================= PEOPLE / GALLERY
export async function viewPeople(qs) {
  setTitle(T('Arcképcsarnok'));
  await loadTree();
  const tab = qs.get('tab') || 'portraits';
  const wrap = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist' },
    [['portraits', T('Arcképek')], ['all', T('Mindenki')], ['photos', T('Fotóalbum')]].map(([k, l]) => h('button', { class: tab === k ? 'on' : '', role: 'tab', onclick: () => go('#/people?tab=' + k) }, l)));
  const headline = h('div', { class: 'page-head' }, h('div', null, h('h1', null, T('Arcképcsarnok')), h('p', null, T('A család arcai nemzedékenként. Kattints egy arcra a részletekért.'))),
    h('div', { class: 'row' }, h('a', { class: 'btn btn-primary', href: '#/quiz' }, icon('quiz'), T('Ki kicsoda? kvíz')), S.user ? h('button', { class: 'btn', onclick: () => uploadPhotos({}) }, icon('photo'), T('Fotó feltöltése')) : null));
  wrap.append(headline, tabs);
  if (tab === 'photos') {
    const photos = await api('photos');
    wrap.append(photos.length ? photoGrid(photos) : h('p', { class: 'empty' }, T('Még nincs fotó az albumban.')));
    return wrap;
  }
  const all = [...S.tree.P.values()];
  const q = h('input', { type: 'search', placeholder: T('Szűrés névre, évre…'), value: qs.get('q') || '' });
  const surnames = [...new Set(all.map(p => p.s).filter(Boolean))].sort(huCmp);
  const sn = h('select', null, h('option', { value: '' }, T('Minden családnév')), surnames.map(s => h('option', { value: s }, s)));
  const sort = h('select', null, h('option', { value: 'gen' }, T('Nemzedékenként')), h('option', { value: 'name' }, T('Név szerint')), h('option', { value: 'born' }, T('Születés szerint')));
  const grid = h('div');
  const draw = () => {
    let list = all.filter(p => tab === 'all' || p.ph);
    const nq = norm(q.value);
    if (nq) list = list.filter(p => norm(personName(p) + ' ' + (p.n || '') + ' ' + (p.b || '') + ' ' + (p.bp || '')).includes(nq));
    if (sn.value) list = list.filter(p => p.s === sn.value);
    const card = p => h('a', { class: 'pcard', href: '#/person/' + p.id }, h('div', { class: 'img' }, p.ph ? h('img', { src: p.ph, alt: '', loading: 'lazy', style: photoStyle(p) }) : icon('silhouette')),
      h('div', { class: 'nm' }, personName(p)), h('div', { class: 'yr' }, years(p)));
    if (!list.length) { grid.replaceChildren(h('div', { class: 'empty' }, tab === 'portraits' ? [T('Még senkiről nincs portré. '), h('a', { href: '#/people?tab=all' }, T('Mindenki')), T(' fülön látod a teljes névsort, és a személyek oldalán tölthetsz fel képet.')] : T('Nincs találat.'))); return; }
    if (sort.value === 'gen') {
      const groups = {};
      for (const p of list) { const y = p.b || p.e; const k = y ? Math.floor(y / 25) * 25 : 'x'; (groups[k] ||= []).push(p); }
      const keys = Object.keys(groups).sort((a, b) => a === 'x' ? 1 : b === 'x' ? -1 : a - b);
      grid.replaceChildren(...keys.map(k => h('div', { class: 'gen-row' }, h('h3', null, k === 'x' ? T('Ismeretlen időszak') : T("Születtek {0}–{1} között", k, +k + 24)),
        h('div', { class: 'portrait-grid' }, groups[k].sort((a, b) => (a.b || a.e || 0) - (b.b || b.e || 0)).map(card)))));
    } else {
      list.sort(sort.value === 'name' ? (a, b) => huCmp(personName(a), personName(b)) : (a, b) => (a.b || a.e || 9999) - (b.b || b.e || 9999));
      grid.replaceChildren(h('div', { class: 'portrait-grid' }, list.map(card)));
    }
  };
  [q, sn, sort].forEach(el => el.addEventListener('input', draw));
  wrap.append(h('div', { class: 'gallery-tools' }, q, sn, sort, h('span', { class: 'hint' }, tab === 'portraits' ? T("{0} arckép, {1} családtag", all.filter(p => p.ph).length, all.length) : T("{0} családtag", all.length))), grid);
  draw();
  return wrap;
}

// ======================================================================= SURNAME
export async function viewSurname(name) {
  await loadTree();
  // accent variants (Szélig / Szelig) are usually the same family written two ways – list them together
  const key = norm(name);
  const list = [...S.tree.P.values()].filter(p => norm(p.s) === key);
  const variants = [...new Set(list.map(p => p.s.trim()))].sort(huCmp);
  const shown = variants.includes(name) ? name : (list[0]?.s || name);
  setTitle(shown);
  const byYear = (a, b) => (a.b || a.e || 9999) - (b.b || b.e || 9999) || huCmp(personName(a), personName(b));
  const sortSel = h('select', null, h('option', { value: 'born' }, T('Születés szerint')), h('option', { value: 'name' }, T('Név szerint')));
  const grid = h('div', { class: 'plist surname-list' });
  const draw = () => {
    const l = [...list].sort(sortSel.value === 'name' ? (a, b) => huCmp(personName(a), personName(b)) : byYear);
    grid.replaceChildren(l.map(p => {
      const pa = parentsOf(p.id).map(x => personName(P(x), { short: true }));
      const rel = pa.length ? (p.sx === 'F' ? T('{0} lánya', pa.join(T(' és '))) : p.sx === 'M' ? T('{0} fia', pa.join(T(' és '))) : T('{0} gyermeke', pa.join(T(' és ')))) : '';
      return chip(p.id, rel);
    }));
  };
  sortSel.addEventListener('input', draw);
  draw();
  return h('div', null,
    h('p', null, h('a', { href: '#/' }, T('← Kezdőlap'))),
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, shown), h('p', null, list.length ? T('{0} családtag ezen a néven', list.length) : T('Nincs ilyen nevű családtag.'), variants.length > 1 ? ' ' + T('({0} írásmóddal együtt)', variants.join(', ')) : '')),
      list.length > 1 ? h('div', { class: 'row' }, sortSel) : null),
    grid);
}

// ======================================================================= STORIES
// the Stories page lists the stories plus – the same texts, not copies – the longer biographies and the
// comments marked as memories; kinds: story | bio | fbio | comment
const STORY_KINDS = { story: 'Sztorik', bio: 'Életrajzok', comment: 'Emlékek a hozzászólásokból' };
const storyHref = s => '#/story/' + (s.kind === 'bio' ? 'bio-' : s.kind === 'fbio' ? 'fam-' : s.kind === 'comment' ? 'c-' : '') + s.id;
function storyMeta(s) {
  const who = [...s.person_ids.slice(0, 3).map(id => personName(P(id), { short: true })), ...(s.family_ids || []).slice(0, 2).map(fid => F(fid) ? familyLabel(F(fid)) : '')].filter(Boolean).join(', ');
  if (s.kind === 'bio') return [T('Életrajz'), s.person_ids.length ? null : who].filter(Boolean).join(' · ');
  if (s.kind === 'fbio') return T('A családról');
  if (s.kind === 'comment') return [T('Emlék') + (s.author ? ' – ' + s.author : ''), who && who !== s.title ? who : null].filter(Boolean).join(' · ');
  return [s.date, who].filter(Boolean).join(' · ');
}
export async function viewStories(qs) {
  setTitle(T('Történetek'));
  await loadTree();
  const list = await api('stories', null, { query: { lang: S.lang } });
  const kindOf = s => (s.kind === 'fbio' ? 'bio' : s.kind || 'story');
  const counts = {}; list.forEach(s => { counts[kindOf(s)] = (counts[kindOf(s)] || 0) + 1; });
  let cur = qs?.get?.('k') || 'all';
  if (cur !== 'all' && !counts[cur]) cur = 'all';
  const grid = h('div', { class: 'story-list' });
  const card = s => h('a', { class: 'story-card' + (s.kind && s.kind !== 'story' ? ' sc-' + kindOf(s) : ''), href: storyHref(s) },
    h('div', { class: 'cover' + (s.cover?.portrait ? ' portrait-cover' : '') }, s.cover ? h('img', { src: s.cover.thumb, alt: '' }) : h('span', { class: 'q' }, '„')),
    h('h3', null, s.title), h('div', { class: 'meta' }, storyMeta(s)),
    h('p', null, s.excerpt));
  const tabs = Object.keys(counts).length > 1 ? h('div', { class: 'tabs story-tabs' },
    [['all', T('Mind'), list.length], ...Object.entries(STORY_KINDS).filter(([k]) => counts[k]).map(([k, l]) => [k, T(l), counts[k]])].map(([k, l, n]) =>
      h('button', { type: 'button', class: k === cur ? 'on' : '', 'data-k': k, onclick: () => { cur = k; draw(); history.replaceState(null, '', '#/stories' + (k === 'all' ? '' : '?k=' + k)); } }, l, h('span', { class: 'c-count' }, n)))) : null;
  const draw = () => {
    grid.replaceChildren(...list.filter(s => cur === 'all' || kindOf(s) === cur).map(card));
    tabs?.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === cur));
  };
  draw();
  return h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, T('Családi történetek')), h('p', null, T('Anekdoták, emlékek, levelek – amit a dátumok nem mesélnek el.'))),
      S.user ? h('button', { class: 'btn btn-primary', onclick: () => editStory() }, icon('plus'), T('Új sztori')) : null),
    list.length ? [tabs, grid]
      : h('div', { class: 'empty' }, h('p', null, T('Még egy sztori sincs. Az első lehet egy nagymama-recept, egy háborús levél vagy egy nyaralás.')), S.user ? h('button', { class: 'btn btn-primary', onclick: () => editStory() }, T('Az első sztori megírása')) : null));
}
/** A biography or a comment-memory, read like a story. The text lives on the person/family page or in the comment. */
async function viewStoryExtra(kind, id) {
  const s = await api('story.extra', null, { query: { kind, id } });
  setTitle(s.title);
  const back = h('p', null, h('a', { href: '#/stories' }, T('← Minden történet')));
  const people = s.person_ids.length || s.family_ids.length ? h('section', { class: 'section' }, h('h2', null, T('Szereplők')),
    h('div', { class: 'plist' }, s.person_ids.map(x => chip(x)), s.family_ids.map(fid => h('a', { class: 'pchip', href: '#/family/' + fid }, familyLabel(F(fid)))))) : null;
  if (kind !== 'comment') {
    const home = kind === 'bio' ? '#/person/' + id : '#/family/' + id;
    return h('article', { class: 'story-page' }, back,
      h('h1', null, s.title),
      h('div', { class: 'meta' }, kind === 'bio' ? T('Életrajz – a személy lapjáról') : T('A családról – a család lapjáról')),
      S.lang !== 'hu' && (S.boot.langs || []).length > 1 ? h('p', { class: 'tr-note' }, T('Az életrajzok eredeti (magyar) nyelven látszanak.')) : null,
      s.cover ? h('img', { class: 'story-portrait', src: s.cover.file, alt: '' }) : null,
      h('div', { class: 'bio' }, s.body),
      kind === 'fbio' ? people : null,
      h('div', { class: 'row', style: 'margin-top:20px' },
        h('a', { class: 'btn', href: home }, icon(kind === 'bio' ? 'user' : 'family'), kind === 'bio' ? T('A személy lapja') : T('A család lapja')),
        S.user ? h('span', { class: 'hint' }, kind === 'bio' ? T('Az életrajzot a személy lapján, az Adatok szerkesztésével lehet javítani.') : T('A szöveget a család lapján lehet javítani.')) : null));
  }
  const tgtHref = { person: '#/person/', family: '#/family/', story: '#/story/' }[s.entity];
  const tgt = tgtHref ? h('a', { href: tgtHref + s.entity_id }, s.title) : h('span', null, s.title);
  return h('article', { class: 'story-page' }, back,
    h('h1', null, s.title),
    h('div', { class: 'meta' }, T('Emlék – lejegyezte: '), h('b', null, s.author || T('ismeretlen')), ' · ', fmtWhen(s.created)),
    s.photo ? h('div', { style: 'margin:14px 0' }, photoGrid([s.photo])) : s.cover?.portrait ? h('img', { class: 'story-portrait', src: s.cover.file, alt: '' }) : null,
    h('div', { class: 'bio' }, s.body),
    s.replies.length ? h('section', { class: 'section comments' }, h('h2', null, T('Válaszok')),
      s.replies.map(r => h('div', { class: 'c-item' }, h('div', { class: 'c-meta' }, h('b', null, r.author || T('ismeretlen')), h('span', null, fmtWhen(r.created))), h('div', { class: 'c-body' }, r.body)))) : null,
    h('p', { class: 'hint', style: 'margin-top:18px' }, T('Hozzászólásként született itt: '), tgt, T('. Válaszolni ott lehet.')),
    people);
}
function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(String(ts).replace(' ', 'T'));
  return isNaN(d) ? ts : d.toLocaleDateString({ hu: 'hu-HU', en: 'en-GB', de: 'de-DE' }[S.lang] || 'hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
}
export async function viewStory(id) {
  await loadTree();
  const xm = /^(bio|fam|c)-(\d+)$/.exec(String(id));
  if (xm) return viewStoryExtra({ bio: 'bio', fam: 'fbio', c: 'comment' }[xm[1]], +xm[2]);
  const s = await api('story', null, { query: { id, lang: S.lang } });
  setTitle(s.title);
  let showOrig = false;
  const titleEl = h('h1', null, s.title);
  const body = h('div', { class: 'prose', html: md(s.body) });
  const trNote = s.shown_lang ? h('p', { class: 'tr-note' }, T("Gépi fordítás (DeepL) {0} eredetiből. ", T(LANG_NAMES[s.lang] || s.lang)),
    h('button', { class: 'linkbtn', onclick: e => { showOrig = !showOrig; titleEl.textContent = showOrig ? s.orig_title : s.title; body.innerHTML = md(showOrig ? s.orig_body : s.body); e.target.textContent = showOrig ? T('Fordítás mutatása') : T('Eredeti mutatása'); } }, T('Eredeti mutatása')))
    : (S.lang !== s.lang && (S.boot.langs || []).length > 1 ? h('p', { class: 'tr-note' }, T("Ennek a sztorinak még nincs {0} fordítása, ezért az eredeti ({1}) szöveg látszik.", T(LANG_NAMES[S.lang] || S.lang), T(LANG_NAMES[s.lang] || s.lang))) : null);
  return h('article', { class: 'story-page' },
    h('p', null, h('a', { href: '#/stories' }, T('← Minden történet'))),
    titleEl,
    h('div', { class: 'meta' }, [s.date, s.imported ? T('A családfa életrajzi jegyzetéből') : (s.author ? T('Lejegyezte: ') + s.author : null)].filter(Boolean).join(' · ')),
    trNote,
    s.cover && !s.cover.portrait ? h('div', { class: 'cover-big' }, h('img', { src: s.cover.file, alt: '' })) : null,
    s.cover?.portrait ? h('img', { class: 'story-portrait', src: s.cover.file, alt: '' }) : null,
    body,
    s.photos.length ? h('section', { class: 'section', style: 'margin-top:30px' }, h('h2', null, T('Fotók')), photoGrid(s.photos)) : null,
    s.person_ids.length || s.family_ids.length ? h('section', { class: 'section' }, h('h2', null, T('Szereplők')), h('div', { class: 'plist' }, s.person_ids.map(x => chip(x)), s.family_ids.map(fid => h('a', { class: 'pchip', href: '#/family/' + fid }, familyLabel(F(fid)))))) : null,
    S.user ? h('div', { class: 'row', style: 'margin-top:20px' },
      canTry(s.modes.update) ? h('button', { class: 'btn', onclick: () => editStory(s) }, icon('edit'), T('Szerkesztés')) : null,
      h('button', { class: 'btn', onclick: () => uploadPhotos({ story_id: s.id }) }, icon('photo'), T('Fotó hozzáadása')),
      pinBtn('story', s.id, T('Kitűzés a kezdőlapra'))) : null,
    commentsBox('story', s.id));
}

// ======================================================================= TREE EXPLORER / CHART BUILDER
let ctrl = null;
export async function viewTree(id, qs) {
  await loadTree();
  const s = S.settings;
  let root = +(id || qs.get('root') || S.user?.person_id || S.tree.home || [...S.tree.P.keys()][0]);
  if (!P(root)) root = S.tree.home;
  const st = { kind: qs.get('kind') || 'hourglass', root, other: +(qs.get('other') || 0) || null, up: +(qs.get('up') || s.chart_gens_up), down: +(qs.get('down') || s.chart_gens_down),
    photos: qs.has('photos') ? qs.get('photos') === '1' : !!s.chart_photos, places: qs.has('places') ? qs.get('places') === '1' : !!s.chart_places, spouses: qs.get('spouses') !== '0', style: qs.get('style') || s.chart_style, orient: qs.get('orient') || '', card: qs.get('card') || s.chart_card || 'tall', photoSize: qs.get('photo') || s.chart_photo || 'large' };
  if (!P(st.root)) return h('div', null, emptyTree());
  setTitle(T('Családfa – ') + personName(P(st.root)));
  const host = h('div', { class: 'chart-host' });
  const titleBar = h('div', { class: 'chart-title-bar' });
  const stage = h('div', { class: 'chart-stage' }, titleBar, host,
  );
  const rootPk = personPicker({ value: st.root, onPick: v => { if (v) { st.root = v; draw(); } } });
  const otherPk = personPicker({ value: st.other, placeholder: T('Másik személy…'), onPick: v => { st.other = v; draw(); } });
  const types = h('div', { class: 'ctype' }, Object.entries(CHART_KINDS).map(([k, v]) => h('button', { type: 'button', class: st.kind === k ? 'on' : '', 'data-k': k, onclick: () => { st.kind = k; draw(); } }, icon(v.icon), T(v.label))));
  const num = (key, label, max = 10) => { const i = h('input', { type: 'range', min: 1, max, value: st[key], oninput: e => { st[key] = +e.target.value; i.nextSibling.textContent = st[key]; draw(); } }); return h('label', { class: 'f', 'data-g': key }, h('span', null, label), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, i, h('b', { style: 'min-width:1.5em;text-align:right' }, st[key]))); };
  const tog = (key, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st[key], onchange: e => { st[key] = e.target.checked; draw(); } }), h('span', null, label));
  const orientSel = h('select', { onchange: e => { st.orient = e.target.value; draw(); } },
    h('option', { value: 'v' }, T('Függőlegesen (fentről lefelé)')), h('option', { value: 'h' }, T('Vízszintesen (balról jobbra)')));
  const cardSel = h('select', { onchange: e => { st.card = e.target.value; draw(); } },
    h('option', { value: 'tall', selected: st.card !== 'wide' }, T('Álló (keskeny, fotó felül)')), h('option', { value: 'wide', selected: st.card === 'wide' }, T('Fekvő (széles, fotó balra)')));
  const photoSel = h('select', { onchange: e => { st.photoSize = e.target.value; draw(); } },
    [['normal', T('Normál')], ['large', T('Nagy')], ['xl', T('Nagyon nagy (kilóg a kártyából)')], ['portrait', T('Igazolványkép (álló téglalap)')]].map(([k, l]) => h('option', { value: k, selected: st.photoSize === k }, l)));
  const style = h('select', { onchange: e => { st.style = e.target.value; draw(); } }, [['album', T('Album')], ['classic', T('Klasszikus')], ['minimal', T('Letisztult')]].map(([k, l]) => h('option', { value: k, selected: st.style === k }, l)));
  const title = h('input', { type: 'text', placeholder: T('Cím az exporthoz (nem kötelező)') });
  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { fail(e); } finally { btn.disabled = false; } };
  const autoTitle = () => title.value || `${T(CHART_KINDS[st.kind].label)}: ${personName(P(st.root))}`;
  const side = h('aside', { class: 'chart-side' },
    h('h2', null, T('Családfa-böngésző')),
    field(T('Középpontban'), rootPk.el),
    S.user ? h('button', { class: 'btn btn-sm', style: 'margin:-4px 0 12px', title: T('Valaki, aki még senkihez sem kapcsolódik a fában – utána a személy oldalán kötheted hozzá a többiekhez.'), onclick: () => editPerson(null) }, icon('plus'), T('Új személy')) : null,
    types,
    h('div', { 'data-rel': 1 }, field(T('Rokonság vele'), otherPk.el)),
    num('up', T('Felmenő nemzedékek'), 10), num('down', T('Leszármazott nemzedékek'), 10),
    h('div', { 'data-g': 'orient' }, field(T('Nemzedékek elrendezése'), orientSel)),
    tog('photos', T('Fotók')), tog('places', T('Születési hely')), tog('spouses', T('Házastársak')),
    h('div', { 'data-g': 'card' }, field(T('Kártyák formája'), cardSel)),
    h('div', { 'data-g': 'photo' }, field(T('Fotók mérete'), photoSel)),
    field(T('Doboz stílus'), style),
    h('hr'),
    field(T('Export'), title),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-sm', onclick: e => busy(e.currentTarget, () => exportChart(ctrl, { title: autoTitle(), format: 'png' })) }, icon('download'), T('PNG')),
      h('button', { class: 'btn btn-sm', onclick: e => busy(e.currentTarget, () => exportChart(ctrl, { title: autoTitle(), format: 'svg' })) }, icon('download'), T('SVG')),
      h('button', { class: 'btn btn-sm', onclick: () => window.print() }, icon('print'), T('Nyomtatás'))),
    S.user ? h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'btn btn-sm btn-primary', onclick: e => busy(e.currentTarget, async () => { const r = await exportChart(ctrl, { title: autoTitle(), save: true, kind: st.kind, person_id: st.root, config: st }); toast(T('Elmentve a diagramok közé.')); }) }, icon('save'), T('Mentés a diagramok közé')),
      isAdmin() && st.kind !== 'relation' ? h('button', { class: 'btn btn-sm', onclick: async () => { await api('pin', { kind: 'tree', ref_id: st.root, replace: true, caption: title.value, params: { kind: st.kind, up: Math.min(st.up, 4), down: Math.min(st.down, 4), ...(st.orient ? { orient: st.orient } : {}) } }); toast(T('Kitűzve a kezdőlapra.')); } }, icon('pin'), T('Kitűzés')) : null) : null,
    h('p', { class: 'hint', style: 'margin-top:14px' }, T('Dupla kattintás (mobilon dupla koppintás) egy kártyán: ő kerül középre. Egy kattintás: gyorskártya. Billentyűk: ↑ szülő, ↓ gyermek, ← → testvér, Home: kiinduló személy; a böngésző Vissza gombja az előző személyre ugrik. Nagyítás: görgő, két ujjas csípés vagy +/−.')));

  const draw = () => {
    const k = CHART_KINDS[st.kind];
    types.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === st.kind));
    side.querySelector('[data-g=up]').hidden = !k.up;
    side.querySelector('[data-g=down]').hidden = !k.down;
    side.querySelector('[data-rel]').hidden = st.kind !== 'relation';
    side.querySelector('[data-g=orient]').hidden = !k.orient;
    side.querySelector('[data-g=card]').hidden = st.kind === 'fan';
    side.querySelector('[data-g=photo]').hidden = st.kind === 'fan' || !st.photos;
    if (k.orient) orientSel.value = chartOrient(st);
    const q = new URLSearchParams({ kind: st.kind, up: st.up, down: st.down, photos: st.photos ? 1 : 0, places: st.places ? 1 : 0, spouses: st.spouses ? 1 : 0, style: st.style });
    if (st.orient) q.set('orient', st.orient);
    if (st.card !== (s.chart_card || 'tall')) q.set('card', st.card);
    if (st.photoSize !== (s.chart_photo || 'large')) q.set('photo', st.photoSize);
    if (st.other) q.set('other', st.other);
    const url = `#/tree/${st.root}?${q}`;
    if (pushNext) { history.pushState(null, '', url); pushNext = false; } else history.replaceState(null, '', url);
    ctrl?.destroy();
    ctrl = renderChart(host, { ...st, focus: true, onRecenter: nid => recenter(nid), onOpen: nid => go('#/person/' + nid),
      popActions: id => [
        { label: T('Középre'), primary: true, run: x => recenter(x) },
        { label: T('Adatlap'), run: x => go('#/person/' + x) },
        ...(id !== st.root ? [{ label: T('Rokonság vele'), run: x => { st.other = x; st.kind = 'relation'; otherPk.set(x); draw(); } }] : []),
      ] });
    const rp = P(st.root);
    titleBar.replaceChildren(h('h2', null, personName(rp)), h('p', null, st.kind === 'relation' ? (st.other ? ctrl?.info?.label : T('Válassz egy másik személyt a bal oldalon.')) : [T(k.label), years(rp)].filter(Boolean).join(' · ')));
    setTitle(T('Családfa – ') + personName(rp));
  };
  // re-centring is a real navigation step: the browser's Back button returns to the previous person
  let pushNext = false;
  const recenter = nid => { if (!P(nid) || nid === st.root) return; st.root = nid; rootPk.set(nid); pushNext = true; draw(); };
  // keyboard: ↑ parent, ↓ first child, ← → siblings (or spouse), Home = home person
  const onKey = e => {
    if (!document.body.contains(page)) return window.removeEventListener('keydown', onKey);
    if (e.target.closest('input,textarea,select,[contenteditable]') || e.altKey || e.ctrlKey || e.metaKey) return;
    const p = P(st.root); if (!p) return;
    let next = null;
    if (e.key === 'ArrowUp') next = parentsOf(st.root)[0];
    else if (e.key === 'ArrowDown') next = childrenOf(st.root)[0];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const bf = p.fc?.length ? F(p.fc[0]) : null;
      const sib = bf ? bf.c : [];
      const i = sib.indexOf(st.root);
      if (sib.length > 1) next = sib[(i + (e.key === 'ArrowRight' ? 1 : sib.length - 1)) % sib.length];
      else { const f = p.fs?.length ? F(p.fs[0]) : null; next = f ? spouseIn(f, st.root) : null; }
    } else if (e.key === 'Home') next = S.user?.person_id || S.tree.home;
    if (next) { e.preventDefault(); recenter(next); }
  };
  window.addEventListener('keydown', onKey);
  const page = h('div', { class: 'chart-page' }, side, stage);
  requestAnimationFrame(draw);
  return page;
}

export async function viewCharts() {
  setTitle(T('Diagramok'));
  await loadTree();
  const list = await api('charts');
  return h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, T('Mentett diagramok')), h('p', null, T('Felmenői, leszármazotti, homokóra- és legyezőábrák, amelyeket a családtagok elmentettek. Letölthetők PNG-ként és SVG-ként.'))),
      h('a', { class: 'btn btn-primary', href: '#/tree' }, icon('plus'), T('Új diagram'))),
    list.length ? h('div', { class: 'saved-charts' }, list.map(c => {
      const cfg = (() => { try { return JSON.parse(c.config || '{}'); } catch (e) { return {}; } })();
      const reopen = '#/tree/' + (c.person_id || '') + '?' + new URLSearchParams(Object.fromEntries(Object.entries(cfg).filter(([k, v]) => ['kind', 'up', 'down', 'other', 'style'].includes(k) && v != null).map(([k, v]) => [k, v])));
      return h('div', { class: 'saved-chart' }, h('a', { class: 'img', href: c.png, target: '_blank', rel: 'noopener' }, h('img', { src: c.png, alt: c.title, loading: 'lazy' })),
        h('div', { class: 'b' }, h('h3', null, c.title), h('div', { class: 'hint' }, [T(CHART_KINDS[c.kind]?.label || ''), c.author, c.created?.slice(0, 10)].filter(Boolean).join(' · ')),
          h('div', { class: 'row', style: 'margin-top:8px;gap:4px' },
            h('a', { class: 'btn btn-sm', href: c.png, download: '' }, T('PNG')), c.svg ? h('a', { class: 'btn btn-sm', href: c.svg, download: '' }, T('SVG')) : null,
            c.person_id ? h('a', { class: 'btn btn-sm btn-ghost', href: reopen }, T('Megnyitás')) : null,
            S.user && (isAdmin() || +c.created_by === S.user.id) ? h('button', { class: 'icon-btn', title: T('Törlés'), onclick: async () => { if (await confirmBox(T('Diagram törlése'), T("Törlöd: „{0}”?", c.title), T('Törlés'))) { await api('chart.delete', { id: c.id }); render(); } } }, icon('trash')) : null)));
    })) : h('div', { class: 'empty' }, T('Még nincs mentett diagram. A fa-böngészőben bármelyik nézetet elmentheted.'), h('div', null, h('a', { class: 'btn', href: '#/tree' }, T('Fa-böngésző megnyitása')))));
}

// ======================================================================= AUTH
const OAUTH_NAMES = { google: 'Google', facebook: 'Facebook' };
/** "Belépés Google-fiókkal" / "Facebookkal" buttons; nothing when no provider is set up. */
function oauthButtons(verb, next = '') {
  const ps = S.boot.oauth || [];
  if (!ps.length) return null;
  return h('div', { class: 'oauth-box' },
    ps.map(p => h('a', { class: 'btn oauth-btn oauth-' + p, href: 'oauth.php?start=' + p + (next ? '&next=' + encodeURIComponent(next) : '') },
      h('span', { class: 'oauth-mark', 'aria-hidden': 'true' }, p === 'google' ? 'G' : 'f'), T(verb, OAUTH_NAMES[p]))),
    h('div', { class: 'oauth-or' }, h('span', null, T('vagy e-mail címmel és jelszóval'))));
}
export function viewLogin(qs) {
  setTitle(T('Belépés'));
  const form = h('form', { class: 'auth-card' },
    h('h1', null, T('Belépés')),
    h('p', { class: 'muted' }, S.settings.public_access === 'login' ? T('A családfa csak a család tagjainak látható. Hozzáférést az admintól kérhetsz.') : T('Szerkesztéshez jelentkezz be.')),
    qs?.get('oauth') === 'pending' ? h('div', { class: 'auth-note' }, T('A regisztrációd jóváhagyásra vár. Amint az admin elfogadja, ugyanezzel a gombbal be tudsz lépni.')) : null,
    qs?.get('oauth') === 'error' && S.boot.oauthError ? h('div', { class: 'auth-note bad' }, S.boot.oauthError) : null,
    oauthButtons('Belépés {0}-fiókkal', qs?.get('next') || ''),
    field(T('E-mail cím'), h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true })),
    field(T('Jelszó'), pwInput({ name: 'password', autocomplete: 'current-password', required: true })),
    S.boot.pwReset ? h('a', { class: 'auth-forgot', href: '#/forgot' }, T('Elfelejtetted a jelszavad?')) : null,
    h('button', { class: 'btn btn-primary', type: 'submit', style: 'width:100%;margin-top:6px' }, T('Belépés')),
    S.boot.allowRegister ? h('p', { style: 'margin:16px 0 0;text-align:center' }, T('Még nincs fiókod? '), h('a', { href: '#/register' }, T('Regisztrálj'))) : null);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const b = form.querySelector('button'); b.disabled = true;
    try { await api('login', formData(form)); location.hash = qs.get('next') || '#/'; location.reload(); }
    catch (er) { fail(er); b.disabled = false; }
  });
  return h('div', { class: 'auth-wrap' }, form);
}
export function viewForgot(qs) {
  setTitle(T('Elfelejtett jelszó'));
  if (!S.boot.pwReset) return h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' }, h('h1', null, T('Elfelejtett jelszó')), h('p', null, T('Új jelszót az admintól kérhetsz.')), h('a', { class: 'btn', href: '#/login' }, T('Vissza a belépéshez'))));
  const form = h('form', { class: 'auth-card' },
    h('h1', null, T('Elfelejtett jelszó')),
    h('p', { class: 'muted' }, T('Add meg az e-mail címed, amivel regisztráltál. Küldünk egy linket, amellyel egy órán belül új jelszót állíthatsz be.')),
    field(T('E-mail cím'), h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true, value: qs?.get('email') || '' })),
    h('button', { class: 'btn btn-primary', type: 'submit', style: 'width:100%' }, T('Link küldése')),
    h('p', { style: 'margin:16px 0 0;text-align:center' }, h('a', { href: '#/login' }, T('Vissza a belépéshez'))));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const b = form.querySelector('button[type=submit]'); b.disabled = true;
    const email = formData(form).email;
    try {
      await api('pwreset.request', { email });
      form.replaceChildren(h('h1', null, T('Nézd meg a leveleidet')),
        h('p', null, T('Ha a(z) {0} címmel van fiók az oldalon, néhány percen belül megérkezik a link. Nézd meg a levélszemét mappát is.', email)),
        h('p', { class: 'muted' }, T('Nem jött levél? Az admin a felhasználók között közvetlenül is adhat új jelszót.')),
        h('a', { class: 'btn', href: '#/login' }, T('Vissza a belépéshez')));
    } catch (er) { fail(er); b.disabled = false; }
  });
  return h('div', { class: 'auth-wrap' }, form);
}
export async function viewReset(token) {
  setTitle(T('Új jelszó'));
  const wrap = h('div', { class: 'auth-wrap' });
  let name = '';
  try { name = (await api('pwreset', { token, check: 1 })).name; }
  catch (er) {
    wrap.append(h('div', { class: 'auth-card' }, h('h1', null, T('Új jelszó')), h('p', null, er.message), h('a', { class: 'btn', href: '#/forgot' }, T('Új link kérése'))));
    return wrap;
  }
  const form = h('form', { class: 'auth-card' },
    h('h1', null, T('Új jelszó')),
    h('p', { class: 'muted' }, T('Szia {0}! Add meg az új jelszavad.', name)),
    field(T('Új jelszó'), pwInput({ name: 'password', required: true, minlength: 8, autocomplete: 'new-password' }), T('Legalább 8 karakter.')),
    field(T('Jelszó még egyszer'), pwInput({ name: 'password2', required: true, minlength: 8, autocomplete: 'new-password' })),
    h('button', { class: 'btn btn-primary', type: 'submit', style: 'width:100%' }, T('Jelszó beállítása')));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = formData(form);
    if (v.password !== v.password2) return toast(T('A két jelszó nem egyezik.'), 'bad');
    const b = form.querySelector('button[type=submit]'); b.disabled = true;
    try { await api('pwreset', { token, password: v.password }); toast(T('Új jelszó beállítva, beléptél.')); setTimeout(() => { location.hash = '#/'; location.reload(); }, 700); }
    catch (er) { fail(er); b.disabled = false; }
  });
  wrap.append(form);
  return wrap;
}
function viewRegisterOauth(o) {
  const form = h('form', { class: 'auth-card' },
    h('h1', null, T('Regisztráció')),
    h('p', { class: 'muted' }, T('A {0}-fiókoddal léptél be, de még nincs fiókod a családfán. Írd meg, ki vagy a családban – az admin jóváhagyása után ugyanezzel a gombbal tudsz belépni, jelszó nélkül.', o.providerName)),
    field(T('A neved'), h('input', { type: 'text', name: 'name', required: true, autocomplete: 'name', value: o.name || '' })),
    o.email ? h('p', null, T('E-mail cím: '), h('b', null, o.email)) : field(T('E-mail cím'), h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email' }), T('A {0} nem adott e-mail címet; erre kapod az értesítéseket.', o.providerName)),
    field(T('Ki vagy a családban?'), h('textarea', { name: 'intro', rows: 3, placeholder: T('Pl. Csurgay Péter fia, Bence (2006). Anyám Cholnoky Viktória.') }), T('Ebből tudja az admin, ki vagy a fában.')),
    h('button', { class: 'btn btn-primary', type: 'submit', style: 'width:100%' }, T('Regisztráció elküldése')));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const b = form.querySelector('button[type=submit]'); b.disabled = true;
    try {
      await api('register.oauth', { ...formData(form), lang: S.lang });
      S.boot.oauthNew = null;
      form.replaceChildren(h('h1', null, T('Köszönjük!')), h('p', null, T('A regisztrációdat megkaptuk. Amint az admin jóváhagyja, a {0} gombbal be tudsz lépni.', o.providerName)), h('a', { class: 'btn', href: '#/' }, T('Vissza a kezdőlapra')));
    } catch (er) { fail(er); b.disabled = false; }
  });
  return h('div', { class: 'auth-wrap' }, form);
}
export function viewRegister(qs) {
  setTitle(T('Regisztráció'));
  if (!S.boot.allowRegister) return h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' }, h('h1', null, T('Regisztráció')), h('p', null, T('A regisztráció jelenleg nincs engedélyezve. Hozzáférést az admintól kérhetsz.'))));
  if (qs?.get('oauth') && S.boot.oauthNew) return viewRegisterOauth(S.boot.oauthNew);
  const form = h('form', { class: 'auth-card' },
    h('h1', null, T('Regisztráció')),
    h('p', { class: 'muted' }, T('Add meg az adataidat. Az admin jóváhagyása után tudsz belépni; ha a családfa egy ágát te gondozod, ő rendeli hozzád szerkesztésre.')),
    oauthButtons('Regisztráció {0}-fiókkal'),
    field(T('A neved'), h('input', { type: 'text', name: 'name', required: true, autocomplete: 'name' })),
    field(T('E-mail cím'), h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email' })),
    field(T('Jelszó'), pwInput({ name: 'password', required: true, minlength: 8, autocomplete: 'new-password' }), T('Legalább 8 karakter.')),
    field(T('Jelszó még egyszer'), pwInput({ name: 'password2', required: true, minlength: 8, autocomplete: 'new-password' })),
    field(T('Ki vagy a családban?'), h('textarea', { name: 'intro', rows: 3, placeholder: T('Pl. Csurgay Péter fia, Bence (2006). Anyám Cholnoky Viktória.') }), T('Ebből tudja az admin, ki vagy a fában.')),
    // hidden trap for bots; no label and an odd name, so phone autofill does not fill it in
    h('div', { class: 'hp', 'aria-hidden': 'true' }, h('input', { type: 'text', name: 'hp_x7', tabindex: -1, autocomplete: 'off', 'data-lpignore': 'true', 'data-1p-ignore': '' })),
    h('button', { class: 'btn btn-primary', type: 'submit', style: 'width:100%' }, T('Regisztráció elküldése')),
    h('p', { style: 'margin:16px 0 0;text-align:center' }, T('Van már fiókod? '), h('a', { href: '#/login' }, T('Belépés'))));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = formData(form);
    if (v.password !== v.password2) return toast(T('A két jelszó nem egyezik.'), 'bad');
    const b = form.querySelector('button[type=submit]'); b.disabled = true;
    try {
      await api('register', { ...v, lang: S.lang });
      form.replaceChildren(h('h1', null, T('Köszönjük!')), h('p', null, T('A regisztrációdat megkaptuk. Amint az admin jóváhagyja, ezzel az e-mail címmel és jelszóval be tudsz lépni.')), h('a', { class: 'btn', href: '#/' }, T('Vissza a kezdőlapra')));
    } catch (er) { fail(er); b.disabled = false; }
  });
  return h('div', { class: 'auth-wrap' }, form);
}
export function viewInstall() {
  setTitle(T('Telepítés'));
  const ged = S.boot.repoGedcom;
  const form = h('form', { class: 'auth-card' },
    h('h1', null, T('Új családfa')),
    h('p', { class: 'muted' }, T('Hozd létre az admin fiókot. Később a fogaskerék alatt mindent beállíthatsz, és felhasználókat, családfőket vehetsz fel.')),
    field(T('Az oldal címe'), h('input', { type: 'text', name: 'title', value: S.settings.site_title })),
    field(T('A neved'), h('input', { type: 'text', name: 'name', required: true, autocomplete: 'name' })),
    field(T('E-mail cím'), h('input', { type: 'email', name: 'email', required: true, autocomplete: 'username' })),
    field(T('Jelszó'), pwInput({ name: 'password', required: true, minlength: 8, autocomplete: 'new-password' }), T('Legalább 8 karakter.')),
    ged ? h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'import', checked: true }), h('span', null, T("Kiinduló adatok betöltése: "), h('code', null, ged))) : null,
    h('button', { class: 'btn btn-primary', type: 'submit', style: 'width:100%' }, T('Létrehozás')),
    h('p', { class: 'hint', style: 'margin-top:12px' }, T('Adatbázis: '), S.boot.driver === 'sqlite' ? T('helyi SQLite fájl (nincs config.php)') : T('MySQL a config.php alapján')));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const b = form.querySelector('button[type=submit]'); b.disabled = true; b.textContent = T('Létrehozás…');
    try { const r = await api('install', formData(form)); if (r.imported) toast(T("Betöltve: {0} személy, {1} család.", r.imported.persons, r.imported.families)); setTimeout(() => { location.hash = '#/'; location.reload(); }, 600); }
    catch (er) { fail(er); b.disabled = false; b.textContent = T('Létrehozás'); }
  });
  return h('div', { class: 'auth-wrap' }, form);
}
function loginMethods() {
  const box = h('div', { class: 'panel', style: 'max-width:420px;margin-top:16px' });
  const draw = async () => {
    let m;
    try { m = await api('oauth.mine'); } catch (e) { box.replaceChildren(h('p', { class: 'hint' }, e.message)); return; }
    const all = [...new Set([...m.enabled, ...m.linked.map(l => l.provider)])];
    if (!all.length) { box.remove(); return; }
    box.replaceChildren(h('h2', null, T('Belépés Google- vagy Facebook-fiókkal')),
      h('p', { class: 'hint' }, T('Ha összekapcsolod, jelszó nélkül, egy kattintással léphetsz be.')),
      all.map(p => {
        const l = m.linked.find(x => x.provider === p);
        return h('div', { class: 'oauth-row' }, h('span', { class: 'oauth-mark oauth-' + p, 'aria-hidden': 'true' }, p === 'google' ? 'G' : 'f'),
          h('div', null, h('b', null, OAUTH_NAMES[p] || p), h('div', { class: 'hint' }, l ? T('Kapcsolva') + (l.email ? ' · ' + l.email : '') : T('Nincs kapcsolva'))),
          l ? h('button', { class: 'btn btn-sm', onclick: async () => {
                if (!await confirmBox(T('Leválasztás'), T('Leválasztod a {0}-fiókodat? Utána azzal nem tudsz belépni.', OAUTH_NAMES[p]), T('Leválasztás'))) return;
                try { await api('oauth.unlink', { provider: p }); toast(T('Leválasztva.')); draw(); } catch (e) { fail(e); }
              } }, T('Leválasztás'))
            : m.enabled.includes(p) ? h('a', { class: 'btn btn-sm btn-primary', href: 'oauth.php?start=' + p + '&mode=link&csrf=' + encodeURIComponent(S.csrf) }, T('Kapcsolás')) : null);
      }));
  };
  draw();
  return box;
}
export async function viewAccount(qs) {
  if (!S.user) { go('#/login'); return null; }
  setTitle(T('Fiókom'));
  await loadTree();
  const mine = await api('changes.mine');
  if (qs?.get('linked')) setTimeout(() => toast(T('A {0}-fiókod összekapcsolva. Mostantól azzal is beléphetsz.', OAUTH_NAMES[qs.get('linked')] || qs.get('linked'))), 50);
  if (qs?.get('oauth') === 'error' && S.boot.oauthError) setTimeout(() => toast(S.boot.oauthError, 'bad'), 50);
  const hasPw = S.user.hasPassword !== false;
  const pw = h('form', { class: 'panel', style: 'max-width:420px' }, h('h2', null, hasPw ? T('Jelszócsere') : T('Jelszó beállítása')),
    hasPw ? field(T('Jelenlegi jelszó'), pwInput({ name: 'old', autocomplete: 'current-password' })) : h('p', { class: 'hint' }, T('Most Google- vagy Facebook-fiókkal lépsz be. Ha jelszót is beállítasz, e-mail címmel is be tudsz lépni.')),
    field(T('Új jelszó'), pwInput({ name: 'new', autocomplete: 'new-password', minlength: 8 })),
    h('button', { class: 'btn btn-primary', type: 'submit' }, hasPw ? T('Jelszó módosítása') : T('Jelszó beállítása')));
  pw.addEventListener('submit', async e => { e.preventDefault(); try { await api('password', formData(pw)); toast(hasPw ? T('Jelszó módosítva.') : T('Jelszó beállítva.')); pw.reset(); if (!hasPw) { S.user.hasPassword = true; render(); } } catch (er) { fail(er); } });
  const roleTxt = { admin: T('Admin – mindent szerkeszthetsz.'), head: T('Családfő – a saját ágadon új adatot azonnal felvehetsz, módosítás és törlés admin jóváhagyással.'), member: T('Családtag – javaslataidat az admin hagyja jóvá.') }[S.user.role];
  return h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, S.user.name), h('p', null, roleTxt)), h('button', { class: 'btn', onclick: async () => { await api('logout', {}); location.hash = '#/'; location.reload(); } }, T('Kilépés'))),
    h('div', { class: 'cols' },
      h('section', { class: 'section' }, h('h2', null, T('Beküldött módosításaim')),
        mine.length ? h('table', { class: 'tbl' }, h('tr', null, h('th', null, T('Mikor')), h('th', null, T('Mit')), h('th', null, T('Állapot'))),
          mine.map(c => h('tr', null, h('td', null, c.created.slice(0, 16)), h('td', null, c.summary, c.review_note ? h('div', { class: 'hint' }, 'Admin: ', c.review_note) : null),
            h('td', null, h('span', { class: 'badge ' + ({ pending: 'pend', approved: 'ok', rejected: 'bad' }[c.status]) }, { pending: T('várakozik'), approved: T('elfogadva'), rejected: T('elutasítva') }[c.status])))))
          : h('p', { class: 'empty' }, T('Még nem küldtél be jóváhagyandó módosítást.')),
        S.boot.branchRoots?.length ? h('div', { style: 'margin-top:24px' }, h('h2', null, T('Az én ágam')), h('div', { class: 'plist' }, S.boot.branchRoots.map(id => chip(id, T('ág kezdete'))))) : null),
      h('div', null, pw, loginMethods())));
}
