import { S, P, F, h, api, op, icon, personName, years, avatar, chip, personLink, parentsOf, siblingsOf, spouseIn, familyLabel,
  loadTree, setTitle, md, fmtDate, toast, fail, opDone, personPicker, field, go, norm, huCmp, photoStyle, modal, formData, render, confirmBox } from './core.js';
import { renderChart, exportChart, CHART_KINDS } from './charts.js';
import { editPerson, addRelative, linkExisting, editFamily, editEvent, uploadPhotos, photoViewer, editStory, refresh } from './edit.js';

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
  return { BIRT: 'megszületett', DEAT: 'elhunyt', MARR: 'összeházasodott', CHR: 'megkeresztelték', BAPM: 'megkeresztelték', ENGA: 'eljegyezték egymást', BURI: 'eltemették', GRAD: 'diplomát szerzett', DIV: 'elváltak' }[e.type] || e.tl.toLowerCase();
}
function whenCell(e) {
  const d = e.date || '';
  const m = d.match(/^(\d{3,4})\.\s*(.*)$/);
  return h('div', { class: 'when' }, m ? [m[1], h('small', null, m[2])] : d || '—');
}
function pinBtn(kind, ref_id, label = 'Kitűzés a kezdőlapra') {
  if (!isAdmin()) return null;
  return h('button', { class: 'icon-btn act', title: label, 'aria-label': label, onclick: async e => { e.preventDefault(); try { await api('pin', { kind, ref_id, replace: kind !== 'story' }); toast('Kitűzve a kezdőlapra.'); } catch (er) { fail(er); } } }, icon('pin'));
}
function timeline(events, { withSubject = true, editable = null } = {}) {
  return h('ul', { class: 'timeline' }, events.map(e => h('li', null, whenCell(e), h('span', { class: 'ico ' + e.type }, icon(EV_ICON[e.type] || 'star')),
    h('div', { class: 'what' },
      h('div', { class: 't' }, withSubject ? [evSubject(e), ' ', evVerb(e)] : [e.tl, e.label ? ': ' + e.label : '']),
      h('div', { class: 's' }, [withSubject && e.label ? e.label : null, e.place].filter(Boolean).join(' · ')),
      e.note ? h('div', { class: 's', style: 'white-space:pre-wrap' }, e.note) : null),
    h('div', { class: 'tl-act' },
      editable ? h('button', { class: 'icon-btn act', title: 'Szerkesztés', onclick: () => editable(e) }, icon('edit')) : null, pinBtn('event', e.id)))));
}

// ======================================================================= HOME
export async function viewHome() {
  setTitle('');
  const [home] = await Promise.all([api('home'), loadTree()]);
  const s = S.settings, st = home.stats;
  const treePin = home.pins.find(p => p.kind === 'tree');
  const evPin = home.pins.find(p => p.kind === 'event');
  const storyPins = home.pins.filter(p => p.kind === 'story');
  const photoPin = home.pins.find(p => p.kind === 'photo');
  const rootId = treePin?.ref_id || S.tree.home;
  const tp = treePin?.params || {};
  const kind = tp.kind || s.home_tree_kind;
  const facts = [];
  if (st.persons) facts.push(h('b', null, st.persons + ' családtag'));
  if (st.generations > 1) facts.push(h('b', null, st.generations + ' nemzedék'));
  if (st.photos) facts.push(h('b', null, st.photos + ' fotó'));
  const factLine = facts.length ? [facts.reduce((a, f, i) => [...a, i ? (i === facts.length - 1 ? ' és ' : ', ') : '', f], []), st.since ? ['. A legkorábbi feljegyzés: ', h('b', null, st.since), '.'] : '.'] : 'Még üres a családfa.';

  const host = h('div', { class: 'chart-host' });
  const hero = h('section', { class: 'home-hero' },
    h('div', { class: 'hero-title' }, h('div', null, h('h1', null, s.site_title), h('p', null, s.site_subtitle)), h('p', { class: 'hero-facts' }, factLine)),
    rootId ? h('div', { class: 'hero-tree' }, host,
      h('div', { class: 'hero-tree-cap' },
        treePin ? h('span', { class: 'pin-mark' }, icon('pin')) : null,
        h('span', null, treePin?.caption || (CHART_KINDS[kind]?.label + ': ' + personName(P(rootId)))),
        h('a', { class: 'btn btn-sm', href: `#/tree/${rootId}?kind=${kind}` }, 'Megnyitás a fa-böngészőben'))) : h('div', { style: 'padding:30px 0 40px' }, emptyTree()));

  const heroEv = evPin?.event || null;
  const left = h('div', null,
    heroEv ? pinnedEvent(evPin) : null,
    h('section', { class: 'section' }, h('h2', null, home.recentMode === 'window' ? 'Friss események' : 'Legutóbbi események', h('a', { href: '#/events' }, 'Összes esemény')),
      home.recentMode === 'latest' && home.recent.length ? h('p', { class: 'hint' }, `Az elmúlt ${s.recent_days} napból nincs új esemény, ezért a családfa legutóbbi eseményei látszanak.`) : null,
      home.recent.length ? timeline(home.recent) : h('p', { class: 'empty' }, 'Még nincs rögzített esemény.')),
    h('section', { class: 'section' }, h('h2', null, 'Családi történetek', h('a', { href: '#/stories' }, 'Mind')),
      storyPins.map(p => storyTeaser(p.story, true)), home.stories.filter(x => !storyPins.some(p => p.ref_id === x.id)).map(x => storyTeaser(x)),
      !home.stories.length && !storyPins.length ? h('div', { class: 'empty' }, 'Még nincs sztori. Ki emlékszik valamire a nagyszülőkről?', S.user ? h('div', null, h('button', { class: 'btn', onclick: () => editStory() }, icon('plus'), 'Sztori írása')) : null) : null));

  const right = h('div', null,
    photoPin ? h('section', { class: 'section' }, h('h2', null, 'Kitűzött fotó'), h('a', { href: '#', onclick: e => { e.preventDefault(); photoViewer([photoPin.photo]); } }, h('img', { src: photoPin.photo.file, alt: photoPin.photo.title || '', style: 'border-radius:8px' })), photoPin.photo.title ? h('p', { class: 'muted', style: 'margin-top:6px' }, photoPin.photo.title) : null) : null,
    s.anniversaries ? h('section', { class: 'section' }, h('h2', null, 'Évfordulók'),
      home.anniversaries.length ? home.anniversaries.slice(0, 8).map(a => h('div', { class: 'ann' },
        h('div', { class: 'n' }, a.years, h('small', null, a.type === 'MARR' ? 'éve házasok' : P(a.person_id)?.dec ? 'éve született' : 'éves lesz')),
        h('div', null, h('div', null, evSubject(a)), h('div', { class: 'hint' }, a.in_days === 0 ? 'ma' : a.in_days === 1 ? 'holnap' : `${a.in_days} nap múlva`, ' · ', a.date))))
        : h('p', { class: 'empty' }, `A következő ${s.anniversary_days} napban nincs évforduló.`)) : null,
    home.newPhotos.length ? h('section', { class: 'section' }, h('h2', null, 'Új fotók', h('a', { href: '#/people?tab=photos' }, 'Album')),
      h('div', { class: 'thumbs' }, home.newPhotos.map((p, i) => h('a', { href: '#', onclick: e => { e.preventDefault(); photoViewer(home.newPhotos, i); } }, h('img', { src: p.thumb, alt: p.title || '' }))))) : null,
    h('section', { class: 'section' }, h('h2', null, 'Ki kicsoda?'),
      h('p', null, 'Felismered a dédszülőket? A kvízben 4 hasonló korú családtag közül kell kiválasztani, ki van a képen.'),
      h('div', { class: 'row' }, h('a', { class: 'btn btn-primary', href: '#/quiz' }, icon('quiz'), 'Kvíz indítása'), h('a', { class: 'btn', href: '#/people' }, 'Arcképcsarnok'))));

  const page = h('div', null, hero, h('div', { class: 'home-body', style: 'padding:6px max(16px, calc((100vw - 1180px) / 2)) 60px' }, h('div', { class: 'cols' }, left, right)));
  if (rootId) requestAnimationFrame(() => renderChart(host, {
    kind, root: rootId, up: tp.up || s.home_tree_gens, down: tp.down || Math.max(1, s.home_tree_gens - 1), photos: s.chart_photos, style: s.chart_style,
    places: false, interactive: true, wheel: false, onNode: null, onOpen: id => go('#/person/' + id),
  }));
  return page;
}
function emptyTree() {
  return h('div', { class: 'panel', style: 'color:var(--ink)' }, h('h2', null, 'Kezdjük el a családfát'),
    h('p', null, 'Vegyél fel egy első személyt, vagy importálj GEDCOM fájlt az admin felületen.'),
    S.user ? h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', onclick: () => editPerson(null) }, icon('plus'), 'Első személy'), isAdmin() ? h('a', { class: 'btn', href: '#/admin/import' }, 'GEDCOM import') : null) : null);
}
function pinnedEvent(pin) {
  const e = pin.event;
  const subj = e.person_id ? P(e.person_id) : null;
  const ph = pin.photo?.thumb || subj?.ph;
  return h('article', { class: 'pinned-event' },
    h('div', { class: 'ph' }, ph ? h('img', { src: pin.photo?.file || subj?.pf || ph, alt: '', style: subj && !pin.photo ? photoStyle(subj) : '' }) : null),
    h('div', null,
      h('div', { class: 'kick' }, icon('pin'), pin.caption || e.tl),
      h('h2', null, evSubject(e)),
      h('p', null, [e.date, e.place].filter(Boolean).join(', '), e.label ? ' — ' + e.label : ''),
      e.note ? h('p', { style: 'margin-top:6px' }, e.note) : null,
      isAdmin() ? h('button', { class: 'btn btn-sm btn-ghost', style: 'margin-top:8px', onclick: async () => { await api('unpin', { id: pin.id }); render(); } }, 'Levétel a kezdőlapról') : null));
}
function storyTeaser(s, pinned = false) {
  return h('a', { class: 'story-teaser', href: '#/story/' + s.id },
    h('h3', null, pinned ? h('span', { style: 'color:var(--accent);margin-right:6px' }, icon('pin')) : null, s.title),
    h('p', null, [s.date, s.excerpt].filter(Boolean).join(' — ')));
}

// ======================================================================= EVENTS
export async function viewEvents(qs) {
  setTitle('Események');
  await loadTree();
  const type = qs.get('type') || '';
  const evs = await api('events', null, { query: type ? { type } : {} });
  const sel = h('select', { style: 'width:auto', onchange: e => go('#/events' + (e.target.value ? '?type=' + e.target.value : '')) },
    h('option', { value: '' }, 'Minden esemény'), Object.entries(S.boot.eventTypes).map(([k, l]) => h('option', { value: k, selected: k === type }, l)));
  const byDecade = {};
  for (const e of evs) (byDecade[Math.floor((e.y || 0) / 10) * 10] ||= []).push(e);
  return h('div', null, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Események'), h('p', null, `${evs.length} dátummal ellátott esemény, a legfrissebbtől visszafelé.`)), sel),
    Object.keys(byDecade).sort((a, b) => b - a).map(d => h('section', { class: 'section' }, h('h2', null, d + '-as évek'), timeline(byDecade[d]))));
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
    : h('div', { class: 'ph-empty' }, icon('silhouette'), canTry(m.create) ? h('button', { class: 'btn btn-sm', onclick: () => uploadPhotos({ person_id: id }) }, 'Portré feltöltése') : 'Nincs fotó'));

  const tools = S.user ? h('div', { class: 'row tools' },
    canTry(m.update) ? h('button', { class: 'btn btn-sm', onclick: () => editPerson(id, null, d) }, icon('edit'), 'Szerkesztés') : null,
    canTry(m.create) ? h('button', { class: 'btn btn-sm', onclick: () => uploadPhotos({ person_id: id }) }, icon('photo'), 'Fotó') : null,
    canTry(m.create) ? h('button', { class: 'btn btn-sm', onclick: () => editEvent(null, { person_id: id }) }, icon('plus'), 'Esemény') : null,
    h('button', { class: 'btn btn-sm', onclick: () => editStory(null, { person_ids: [id] }) }, icon('book'), 'Sztori'),
    h('a', { class: 'btn btn-sm', href: `#/tree/${id}?kind=hourglass` }, icon('tree'), 'Diagram'),
    isAdmin() ? h('button', { class: 'btn btn-sm', onclick: () => pinTree(id) }, icon('pin'), 'Fa kitűzése') : null) : h('div', { class: 'row tools' }, h('a', { class: 'btn btn-sm', href: `#/tree/${id}?kind=hourglass` }, icon('tree'), 'Diagram'));

  const head = h('div', { class: 'person-head' }, portrait, h('div', null,
    lineage.length ? h('div', { class: 'lineage' }, (p.sx === 'F' ? 'lánya: ' : p.sx === 'M' ? 'fia: ' : 'gyermeke: ') + lineage.join(' és ')) : null,
    h('h1', null, personName(p)),
    p.n || d.married_name ? h('div', { class: 'muted', style: 'margin-bottom:6px' }, [p.n ? `„${p.n}”` : null, d.married_name].filter(Boolean).join(' · ')) : null,
    h('div', { class: 'life' }, p.masked ? h('span', null, 'Élő személy – a részletek csak bejelentkezve láthatók.') : [
      birth ? h('div', null, h('span', null, birth.type === 'BIRT' ? 'Született ' : 'Keresztelték '), birth.date || '?', birth.place ? ', ' + birth.place : '') : null,
      death ? h('div', null, h('span', null, death.type === 'DEAT' ? 'Elhunyt ' : 'Eltemették '), death.date || '?', death.place ? ', ' + death.place : '') : (p.dec ? h('div', null, h('span', null, 'Elhunyt')) : null)]),
    tools, d.heads?.length ? h('p', { class: 'hint', style: 'margin-top:8px' }, 'Családfő: ', d.heads.map(x => x.name).join(', ')) : null));

  // ---- family column
  const fam = h('div', { class: 'panel' });
  const parents = parentsOf(id);
  fam.append(h('div', { class: 'fam-block' }, h('h4', null, 'Szülők', bf && S.user ? h('a', { href: '#/family/' + bf.id, class: 'hint', style: 'margin-left:auto' }, 'család') : null),
    parents.length ? parents.map(x => chip(x)) : h('p', { class: 'hint' }, 'Nincsenek rögzítve.'),
    S.user && parents.length < 2 ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => addRelative(id, 'parent') }, icon('plus'), 'Szülő hozzáadása') : null));
  const sibs = siblingsOf(id);
  if (sibs.length) fam.append(h('div', { class: 'fam-block' }, h('h4', null, 'Testvérek'), sibs.map(x => chip(x))));
  for (const fid of p.fs || []) {
    const f = F(fid); if (!f) continue;
    const sp = spouseIn(f, id);
    const fd = d.families.find(x => x.id === fid);
    const marr = fd?.events.find(e => e.type === 'MARR');
    fam.append(h('div', { class: 'fam-block' },
      h('h4', null, f.dv ? 'Volt házastárs' : (p.sx === 'M' ? 'Feleség' : p.sx === 'F' ? 'Férj' : 'Házastárs'), marr?.date ? h('span', null, '· ' + marr.date) : null, h('a', { href: '#/family/' + fid, class: 'hint', style: 'margin-left:auto' }, 'család')),
      sp ? chip(sp) : h('p', { class: 'hint' }, 'Ismeretlen'),
      f.c.length ? h('div', { class: 'kids' }, h('h4', null, 'Gyermekek'), f.c.map(c => chip(c))) : null));
  }
  if (S.user) fam.append(h('div', { class: 'row', style: 'margin-top:10px' },
    h('button', { class: 'btn btn-sm', onclick: () => addRelative(id, 'spouse') }, icon('plus'), 'Házastárs'),
    h('button', { class: 'btn btn-sm', onclick: () => addRelative(id, 'child') }, icon('plus'), 'Gyermek'),
    h('button', { class: 'btn btn-sm btn-ghost', onclick: () => linkExisting(id) }, icon('link'), 'Meglévő személy')));

  const mini = h('div', { class: 'mini-chart' });
  const evEditable = canTry(m.update) || canTry(m.create) ? e => editEvent(e, { person_id: id, mode: m.update }) : null;
  const leftCol = h('div', null,
    d.notes ? h('section', { class: 'section' }, h('h2', null, 'Életrajz'), h('div', { class: 'bio' }, d.notes)) : null,
    d.events.length ? h('section', { class: 'section' }, h('h2', null, 'Életút'), timeline(d.events, { withSubject: false, editable: evEditable })) : null,
    h('section', { class: 'section' }, h('h2', null, 'Fotók', canTry(m.create) ? h('button', { class: 'btn btn-sm side', onclick: () => uploadPhotos({ person_id: id }) }, icon('plus'), 'Feltöltés') : null),
      d.photos.length ? photoGrid(d.photos) : h('p', { class: 'empty' }, p.masked ? 'Élő személy fotói csak bejelentkezve láthatók.' : 'Még nincs fotó róla.')),
    h('section', { class: 'section' }, h('h2', null, 'Sztorik', S.user ? h('button', { class: 'btn btn-sm side', onclick: () => editStory(null, { person_ids: [id] }) }, icon('plus'), 'Új sztori') : null),
      d.stories.length ? d.stories.map(s => storyTeaser(s)) : h('p', { class: 'empty' }, 'Még nincs róla történet.')),
    d.extra?.length ? h('section', { class: 'section' }, h('h2', null, 'Egyéb adatok'), h('dl', { class: 'facts' }, d.extra.map(([k, v]) => [h('dt', null, { _PHOM: 'Telefon (otthon)', _PMOB: 'Mobil', _POFF: 'Telefon (munka)', EMAIL: 'E-mail' }[k] || k), h('dd', null, v)]))) : null);
  const rightCol = h('div', null, h('section', { class: 'section' }, h('h2', null, 'Család'), fam),
    h('section', { class: 'section' }, h('h2', null, 'Homokóra', h('a', { href: `#/tree/${id}?kind=hourglass` }, 'Nagyobban')), mini));
  requestAnimationFrame(() => renderChart(mini, { kind: 'hourglass', root: id, up: 2, down: 1, photos: true, style: S.settings.chart_style, wheel: false, onNode: nid => go('#/person/' + nid) }));
  return h('div', null, head, h('div', { class: 'person-grid' }, leftCol, rightCol));
}
function pinTree(id) {
  const kind = h('select', null, Object.entries(CHART_KINDS).filter(([k]) => k !== 'relation').map(([k, v]) => h('option', { value: k, selected: k === 'hourglass' }, v.label)));
  const up = h('input', { type: 'number', min: 1, max: 6, value: 2 }), down = h('input', { type: 'number', min: 1, max: 6, value: 2 });
  const cap = h('input', { type: 'text', placeholder: 'Pl. A nagyszülők családja' });
  modal({ title: 'Családfarészlet kitűzése a kezdőlapra', body: h('div', null, h('p', { class: 'muted' }, 'Középpontban: ', personName(P(id))), field('Diagram', kind), h('div', { class: 'grid2' }, field('Felmenő nemzedékek', up), field('Leszármazott nemzedékek', down)), field('Felirat', cap)),
    actions: [{ label: 'Mégse' }, { label: 'Kitűzés', cls: 'btn-primary', onClick: async () => { await api('pin', { kind: 'tree', ref_id: id, replace: true, caption: cap.value, params: { kind: kind.value, up: +up.value, down: +down.value } }); toast('Kitűzve a kezdőlapra.'); } }] });
}
function photoGrid(photos) {
  return h('div', { class: 'photo-grid' }, photos.map((p, i) => h('a', { href: '#', onclick: e => { e.preventDefault(); photoViewer(photos, i); } },
    h('img', { src: p.thumb, alt: p.title || '', loading: 'lazy', width: p.w, height: p.h, style: 'height:auto' }),
    p.status === 'pending' ? h('span', { class: 'badge pend' }, 'jóváhagyásra vár') : null,
    p.title || p.date ? h('div', { class: 'cap' }, [p.title, p.date].filter(Boolean).join(' · ')) : null)));
}

// ======================================================================= FAMILY
export async function viewFamily(id) {
  id = +id;
  await loadTree();
  const f = F(id);
  if (!f) throw new Error('Nincs ilyen család.');
  const d = await api('family', null, { query: { id } });
  setTitle(familyLabel(f));
  const m = d.modes;
  const host = h('div', { class: 'mini-chart', style: 'height:420px' });
  const ph = d.photos.find(x => x.id === d.photo_id) || d.photos[0];
  const page = h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, familyLabel(f)), h('p', null, [d.events.find(e => e.type === 'MARR')?.date ? 'Házasságot kötöttek: ' + d.events.find(e => e.type === 'MARR').date : null, f.c.length ? f.c.length + ' gyermek' : null].filter(Boolean).join(' · '))),
      S.user ? h('div', { class: 'row' },
        canTry(m.update) ? h('button', { class: 'btn btn-sm', onclick: () => editFamily(id, d) }, icon('edit'), 'Szerkesztés') : null,
        canTry(m.create) ? h('button', { class: 'btn btn-sm', onclick: () => uploadPhotos({ family_id: id }) }, icon('photo'), 'Családi fotó') : null,
        canTry(m.create) ? h('button', { class: 'btn btn-sm', onclick: () => editPerson(null, { type: 'child', family_id: id, of: f.h || f.w }) }, icon('plus'), 'Gyermek') : null,
        canTry(m.create) ? h('button', { class: 'btn btn-sm', onclick: () => editEvent(null, { family_id: id }) }, icon('plus'), 'Esemény') : null,
        h('button', { class: 'btn btn-sm', onclick: () => editStory(null, { family_ids: [id] }) }, icon('book'), 'Sztori')) : null),
    h('div', { class: 'person-grid' },
      h('div', null,
        ph ? h('section', { class: 'section' }, h('a', { href: '#', onclick: e => { e.preventDefault(); photoViewer(d.photos, d.photos.indexOf(ph)); } }, h('img', { src: ph.file, alt: ph.title || '', style: 'border-radius:8px;max-height:520px;width:auto' }))) : null,
        d.notes ? h('section', { class: 'section' }, h('h2', null, 'A családról'), h('div', { class: 'bio' }, d.notes)) : null,
        d.events.length ? h('section', { class: 'section' }, h('h2', null, 'Események'), timeline(d.events, { withSubject: false, editable: S.user ? e => editEvent(e, { family_id: id, mode: m.update }) : null })) : null,
        h('section', { class: 'section' }, h('h2', null, 'Családi fotók'), d.photos.length ? photoGrid(d.photos) : h('p', { class: 'empty' }, 'Még nincs családi fotó.')),
        d.stories.length ? h('section', { class: 'section' }, h('h2', null, 'Sztorik'), d.stories.map(s => storyTeaser(s))) : null),
      h('div', null,
        h('section', { class: 'section' }, h('h2', null, 'Szülők'), h('div', { class: 'panel' }, [f.h, f.w].filter(Boolean).map(x => chip(x)))),
        h('section', { class: 'section' }, h('h2', null, 'Gyermekek'), h('div', { class: 'panel' }, f.c.length ? f.c.map(x => chip(x)) : h('p', { class: 'hint' }, 'Nincsenek rögzítve.'))),
        h('section', { class: 'section' }, host))));
  requestAnimationFrame(() => renderChart(host, { kind: 'descendants', root: f.h || f.w, down: 2, photos: true, wheel: false, onNode: nid => go('#/person/' + nid) }));
  return page;
}

// ======================================================================= PEOPLE / GALLERY
export async function viewPeople(qs) {
  setTitle('Arcképcsarnok');
  await loadTree();
  const tab = qs.get('tab') || 'portraits';
  const wrap = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist' },
    [['portraits', 'Arcképek'], ['all', 'Mindenki'], ['photos', 'Fotóalbum']].map(([k, l]) => h('button', { class: tab === k ? 'on' : '', role: 'tab', onclick: () => go('#/people?tab=' + k) }, l)));
  const headline = h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Arcképcsarnok'), h('p', null, 'A család arcai nemzedékenként. Kattints egy arcra a részletekért.')),
    h('div', { class: 'row' }, h('a', { class: 'btn btn-primary', href: '#/quiz' }, icon('quiz'), 'Ki kicsoda? kvíz'), S.user ? h('button', { class: 'btn', onclick: () => uploadPhotos({}) }, icon('photo'), 'Fotó feltöltése') : null));
  wrap.append(headline, tabs);
  if (tab === 'photos') {
    const photos = await api('photos');
    wrap.append(photos.length ? photoGrid(photos) : h('p', { class: 'empty' }, 'Még nincs fotó az albumban.'));
    return wrap;
  }
  const all = [...S.tree.P.values()];
  const q = h('input', { type: 'search', placeholder: 'Szűrés névre, évre…', value: qs.get('q') || '' });
  const surnames = [...new Set(all.map(p => p.s).filter(Boolean))].sort(huCmp);
  const sn = h('select', null, h('option', { value: '' }, 'Minden családnév'), surnames.map(s => h('option', { value: s }, s)));
  const sort = h('select', null, h('option', { value: 'gen' }, 'Nemzedékenként'), h('option', { value: 'name' }, 'Név szerint'), h('option', { value: 'born' }, 'Születés szerint'));
  const grid = h('div');
  const draw = () => {
    let list = all.filter(p => tab === 'all' || p.ph);
    const nq = norm(q.value);
    if (nq) list = list.filter(p => norm(personName(p) + ' ' + (p.n || '') + ' ' + (p.b || '') + ' ' + (p.bp || '')).includes(nq));
    if (sn.value) list = list.filter(p => p.s === sn.value);
    const card = p => h('a', { class: 'pcard', href: '#/person/' + p.id }, h('div', { class: 'img' }, p.ph ? h('img', { src: p.ph, alt: '', loading: 'lazy', style: photoStyle(p) }) : icon('silhouette')),
      h('div', { class: 'nm' }, personName(p)), h('div', { class: 'yr' }, years(p)));
    if (!list.length) { grid.replaceChildren(h('div', { class: 'empty' }, tab === 'portraits' ? ['Még senkiről nincs portré. ', h('a', { href: '#/people?tab=all' }, 'Mindenki'), ' fülön látod a teljes névsort, és a személyek oldalán tölthetsz fel képet.'] : 'Nincs találat.')); return; }
    if (sort.value === 'gen') {
      const groups = {};
      for (const p of list) { const y = p.b || p.e; const k = y ? Math.floor(y / 25) * 25 : 'x'; (groups[k] ||= []).push(p); }
      const keys = Object.keys(groups).sort((a, b) => a === 'x' ? 1 : b === 'x' ? -1 : a - b);
      grid.replaceChildren(...keys.map(k => h('div', { class: 'gen-row' }, h('h3', null, k === 'x' ? 'Ismeretlen időszak' : `Születtek ${k}–${+k + 24} között`),
        h('div', { class: 'portrait-grid' }, groups[k].sort((a, b) => (a.b || a.e || 0) - (b.b || b.e || 0)).map(card)))));
    } else {
      list.sort(sort.value === 'name' ? (a, b) => huCmp(personName(a), personName(b)) : (a, b) => (a.b || a.e || 9999) - (b.b || b.e || 9999));
      grid.replaceChildren(h('div', { class: 'portrait-grid' }, list.map(card)));
    }
  };
  [q, sn, sort].forEach(el => el.addEventListener('input', draw));
  wrap.append(h('div', { class: 'gallery-tools' }, q, sn, sort, h('span', { class: 'hint' }, tab === 'portraits' ? `${all.filter(p => p.ph).length} arckép, ${all.length} családtag` : `${all.length} családtag`)), grid);
  draw();
  return wrap;
}

// ======================================================================= STORIES
export async function viewStories() {
  setTitle('Történetek');
  await loadTree();
  const list = await api('stories');
  return h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Családi történetek'), h('p', null, 'Anekdoták, emlékek, levelek – amit a dátumok nem mesélnek el.')),
      S.user ? h('button', { class: 'btn btn-primary', onclick: () => editStory() }, icon('plus'), 'Új sztori') : null),
    list.length ? h('div', { class: 'story-list' }, list.map(s => h('a', { class: 'story-card', href: '#/story/' + s.id },
      h('div', { class: 'cover' }, s.cover ? h('img', { src: s.cover.thumb, alt: '' }) : h('span', { class: 'q' }, '„')),
      h('h3', null, s.title), h('div', { class: 'meta' }, [s.date, s.person_ids.slice(0, 3).map(id => personName(P(id), { short: true })).join(', ')].filter(Boolean).join(' · ')),
      h('p', null, s.excerpt))))
      : h('div', { class: 'empty' }, h('p', null, 'Még egy sztori sincs. Az első lehet egy nagymama-recept, egy háborús levél vagy egy nyaralás.'), S.user ? h('button', { class: 'btn btn-primary', onclick: () => editStory() }, 'Az első sztori megírása') : null));
}
export async function viewStory(id) {
  await loadTree();
  const s = await api('story', null, { query: { id } });
  setTitle(s.title);
  const body = h('div', { class: 'prose', html: md(s.body) });
  return h('article', { class: 'story-page' },
    h('p', null, h('a', { href: '#/stories' }, '← Minden történet')),
    h('h1', null, s.title),
    h('div', { class: 'meta' }, [s.date, s.author ? 'Lejegyezte: ' + s.author : null].filter(Boolean).join(' · ')),
    s.cover ? h('div', { class: 'cover-big' }, h('img', { src: s.cover.file, alt: '' })) : null,
    body,
    s.photos.length ? h('section', { class: 'section', style: 'margin-top:30px' }, h('h2', null, 'Fotók'), photoGrid(s.photos)) : null,
    s.person_ids.length || s.family_ids.length ? h('section', { class: 'section' }, h('h2', null, 'Szereplők'), h('div', { class: 'plist' }, s.person_ids.map(x => chip(x)), s.family_ids.map(fid => h('a', { class: 'pchip', href: '#/family/' + fid }, familyLabel(F(fid)))))) : null,
    S.user ? h('div', { class: 'row', style: 'margin-top:20px' },
      canTry(s.modes.update) ? h('button', { class: 'btn', onclick: () => editStory(s) }, icon('edit'), 'Szerkesztés') : null,
      h('button', { class: 'btn', onclick: () => uploadPhotos({ story_id: s.id }) }, icon('photo'), 'Fotó hozzáadása'),
      pinBtn('story', s.id, 'Kitűzés a kezdőlapra')) : null);
}

// ======================================================================= TREE EXPLORER / CHART BUILDER
let ctrl = null;
export async function viewTree(id, qs) {
  await loadTree();
  const s = S.settings;
  let root = +(id || qs.get('root') || S.user?.person_id || S.tree.home || [...S.tree.P.keys()][0]);
  if (!P(root)) root = S.tree.home;
  const st = { kind: qs.get('kind') || 'hourglass', root, other: +(qs.get('other') || 0) || null, up: +(qs.get('up') || s.chart_gens_up), down: +(qs.get('down') || s.chart_gens_down),
    photos: qs.has('photos') ? qs.get('photos') === '1' : !!s.chart_photos, places: qs.has('places') ? qs.get('places') === '1' : !!s.chart_places, spouses: qs.get('spouses') !== '0', style: qs.get('style') || s.chart_style };
  if (!P(st.root)) return h('div', null, emptyTree());
  setTitle('Családfa – ' + personName(P(st.root)));
  const host = h('div', { class: 'chart-host' });
  const titleBar = h('div', { class: 'chart-title-bar' });
  const stage = h('div', { class: 'chart-stage' }, titleBar, host,
    h('div', { class: 'chart-zoom' }, h('button', { 'aria-label': 'Nagyítás', onclick: () => ctrl?.zoom(.8) }, '+'), h('button', { 'aria-label': 'Kicsinyítés', onclick: () => ctrl?.zoom(1.25) }, '−'), h('button', { 'aria-label': 'Teljes nézet', title: 'Teljes nézet', onclick: () => ctrl?.fit(3) }, '⤢')));
  const rootPk = personPicker({ value: st.root, onPick: v => { if (v) { st.root = v; draw(); } } });
  const otherPk = personPicker({ value: st.other, placeholder: 'Másik személy…', onPick: v => { st.other = v; draw(); } });
  const types = h('div', { class: 'ctype' }, Object.entries(CHART_KINDS).map(([k, v]) => h('button', { type: 'button', class: st.kind === k ? 'on' : '', 'data-k': k, onclick: () => { st.kind = k; draw(); } }, icon(v.icon), v.label)));
  const num = (key, label, max = 10) => { const i = h('input', { type: 'range', min: 1, max, value: st[key], oninput: e => { st[key] = +e.target.value; i.nextSibling.textContent = st[key]; draw(); } }); return h('label', { class: 'f', 'data-g': key }, h('span', null, label), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, i, h('b', { style: 'min-width:1.5em;text-align:right' }, st[key]))); };
  const tog = (key, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st[key], onchange: e => { st[key] = e.target.checked; draw(); } }), h('span', null, label));
  const style = h('select', { onchange: e => { st.style = e.target.value; draw(); } }, [['album', 'Album'], ['classic', 'Klasszikus'], ['minimal', 'Letisztult']].map(([k, l]) => h('option', { value: k, selected: st.style === k }, l)));
  const title = h('input', { type: 'text', placeholder: 'Cím az exporthoz (nem kötelező)' });
  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { fail(e); } finally { btn.disabled = false; } };
  const autoTitle = () => title.value || `${CHART_KINDS[st.kind].label}: ${personName(P(st.root))}`;
  const side = h('aside', { class: 'chart-side' },
    h('h2', null, 'Családfa-böngésző'),
    field('Középpontban', rootPk.el),
    types,
    h('div', { 'data-rel': 1 }, field('Rokonság vele', otherPk.el)),
    num('up', 'Felmenő nemzedékek', 10), num('down', 'Leszármazott nemzedékek', 10),
    tog('photos', 'Fotók'), tog('places', 'Születési hely'), tog('spouses', 'Házastársak'),
    field('Doboz stílus', style),
    h('hr'),
    field('Export', title),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-sm', onclick: e => busy(e.currentTarget, () => exportChart(ctrl, { title: autoTitle(), format: 'png' })) }, icon('download'), 'PNG'),
      h('button', { class: 'btn btn-sm', onclick: e => busy(e.currentTarget, () => exportChart(ctrl, { title: autoTitle(), format: 'svg' })) }, icon('download'), 'SVG'),
      h('button', { class: 'btn btn-sm', onclick: () => window.print() }, icon('print'), 'Nyomtatás')),
    S.user ? h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'btn btn-sm btn-primary', onclick: e => busy(e.currentTarget, async () => { const r = await exportChart(ctrl, { title: autoTitle(), save: true, kind: st.kind, person_id: st.root, config: st }); toast('Elmentve a diagramok közé.'); }) }, icon('save'), 'Mentés a diagramok közé'),
      isAdmin() && st.kind !== 'relation' ? h('button', { class: 'btn btn-sm', onclick: async () => { await api('pin', { kind: 'tree', ref_id: st.root, replace: true, caption: title.value, params: { kind: st.kind, up: Math.min(st.up, 4), down: Math.min(st.down, 4) } }); toast('Kitűzve a kezdőlapra.'); } }, icon('pin'), 'Kitűzés') : null) : null,
    h('p', { class: 'hint', style: 'margin-top:14px' }, 'Kattintás egy dobozra: középre veszi. Dupla kattintás: megnyitja az adatlapot. Görgetés: nagyítás, húzás: mozgatás.'));

  const draw = () => {
    const k = CHART_KINDS[st.kind];
    types.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === st.kind));
    side.querySelector('[data-g=up]').hidden = !k.up;
    side.querySelector('[data-g=down]').hidden = !k.down;
    side.querySelector('[data-rel]').hidden = st.kind !== 'relation';
    const q = new URLSearchParams({ kind: st.kind, up: st.up, down: st.down, photos: st.photos ? 1 : 0, places: st.places ? 1 : 0, spouses: st.spouses ? 1 : 0, style: st.style });
    if (st.other) q.set('other', st.other);
    history.replaceState(null, '', `#/tree/${st.root}?${q}`);
    ctrl?.destroy();
    ctrl = renderChart(host, { ...st, focus: true, onNode: nid => { st.root = nid; rootPk.set(nid); draw(); }, onOpen: nid => go('#/person/' + nid) });
    const rp = P(st.root);
    titleBar.replaceChildren(h('h2', null, personName(rp)), h('p', null, st.kind === 'relation' ? (st.other ? ctrl?.info?.label : 'Válassz egy másik személyt a bal oldalon.') : [k.label, years(rp)].filter(Boolean).join(' · ')));
    setTitle('Családfa – ' + personName(rp));
  };
  const page = h('div', { class: 'chart-page' }, side, stage);
  requestAnimationFrame(draw);
  return page;
}

export async function viewCharts() {
  setTitle('Diagramok');
  await loadTree();
  const list = await api('charts');
  return h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Mentett diagramok'), h('p', null, 'Felmenői, leszármazotti, homokóra- és legyezőábrák, amelyeket a családtagok elmentettek. Letölthetők PNG-ként és SVG-ként.')),
      h('a', { class: 'btn btn-primary', href: '#/tree' }, icon('plus'), 'Új diagram')),
    list.length ? h('div', { class: 'saved-charts' }, list.map(c => {
      const cfg = (() => { try { return JSON.parse(c.config || '{}'); } catch (e) { return {}; } })();
      const reopen = '#/tree/' + (c.person_id || '') + '?' + new URLSearchParams(Object.fromEntries(Object.entries(cfg).filter(([k, v]) => ['kind', 'up', 'down', 'other', 'style'].includes(k) && v != null).map(([k, v]) => [k, v])));
      return h('div', { class: 'saved-chart' }, h('a', { class: 'img', href: c.png, target: '_blank', rel: 'noopener' }, h('img', { src: c.png, alt: c.title, loading: 'lazy' })),
        h('div', { class: 'b' }, h('h3', null, c.title), h('div', { class: 'hint' }, [CHART_KINDS[c.kind]?.label, c.author, c.created?.slice(0, 10)].filter(Boolean).join(' · ')),
          h('div', { class: 'row', style: 'margin-top:8px;gap:4px' },
            h('a', { class: 'btn btn-sm', href: c.png, download: '' }, 'PNG'), c.svg ? h('a', { class: 'btn btn-sm', href: c.svg, download: '' }, 'SVG') : null,
            c.person_id ? h('a', { class: 'btn btn-sm btn-ghost', href: reopen }, 'Megnyitás') : null,
            S.user && (isAdmin() || +c.created_by === S.user.id) ? h('button', { class: 'icon-btn', title: 'Törlés', onclick: async () => { if (await confirmBox('Diagram törlése', `Törlöd: „${c.title}”?`, 'Törlés')) { await api('chart.delete', { id: c.id }); render(); } } }, icon('trash')) : null)));
    })) : h('div', { class: 'empty' }, 'Még nincs mentett diagram. A fa-böngészőben bármelyik nézetet elmentheted.', h('div', null, h('a', { class: 'btn', href: '#/tree' }, 'Fa-böngésző megnyitása'))));
}

// ======================================================================= AUTH
export function viewLogin(qs) {
  setTitle('Belépés');
  const form = h('form', { class: 'auth-card' },
    h('h1', null, 'Belépés'),
    h('p', { class: 'muted' }, S.settings.public_access === 'login' ? 'A családfa csak a család tagjainak látható. Hozzáférést az admintól kérhetsz.' : 'Szerkesztéshez jelentkezz be.'),
    field('E-mail cím', h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true })),
    field('Jelszó', h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true })),
    h('button', { class: 'btn btn-primary', type: 'submit', style: 'width:100%;margin-top:6px' }, 'Belépés'));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const b = form.querySelector('button'); b.disabled = true;
    try { await api('login', formData(form)); location.hash = qs.get('next') || '#/'; location.reload(); }
    catch (er) { fail(er); b.disabled = false; }
  });
  return h('div', { class: 'auth-wrap' }, form);
}
export function viewInstall() {
  setTitle('Telepítés');
  const ged = S.boot.repoGedcom;
  const form = h('form', { class: 'auth-card' },
    h('h1', null, 'Új családfa'),
    h('p', { class: 'muted' }, 'Hozd létre az admin fiókot. Később a fogaskerék alatt mindent beállíthatsz, és felhasználókat, családfőket vehetsz fel.'),
    field('Az oldal címe', h('input', { type: 'text', name: 'title', value: S.settings.site_title })),
    field('A neved', h('input', { type: 'text', name: 'name', required: true, autocomplete: 'name' })),
    field('E-mail cím', h('input', { type: 'email', name: 'email', required: true, autocomplete: 'username' })),
    field('Jelszó', h('input', { type: 'password', name: 'password', required: true, minlength: 8, autocomplete: 'new-password' }), 'Legalább 8 karakter.'),
    ged ? h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'import', checked: true }), h('span', null, `Kiinduló adatok betöltése: `, h('code', null, ged))) : null,
    h('button', { class: 'btn btn-primary', type: 'submit', style: 'width:100%' }, 'Létrehozás'),
    h('p', { class: 'hint', style: 'margin-top:12px' }, 'Adatbázis: ', S.boot.driver === 'sqlite' ? 'helyi SQLite fájl (nincs config.php)' : 'MySQL a config.php alapján'));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const b = form.querySelector('button[type=submit]'); b.disabled = true; b.textContent = 'Létrehozás…';
    try { const r = await api('install', formData(form)); if (r.imported) toast(`Betöltve: ${r.imported.persons} személy, ${r.imported.families} család.`); setTimeout(() => { location.hash = '#/'; location.reload(); }, 600); }
    catch (er) { fail(er); b.disabled = false; b.textContent = 'Létrehozás'; }
  });
  return h('div', { class: 'auth-wrap' }, form);
}
export async function viewAccount() {
  if (!S.user) { go('#/login'); return null; }
  setTitle('Fiókom');
  await loadTree();
  const mine = await api('changes.mine');
  const pw = h('form', { class: 'panel', style: 'max-width:420px' }, h('h2', null, 'Jelszócsere'),
    field('Jelenlegi jelszó', h('input', { type: 'password', name: 'old', autocomplete: 'current-password' })),
    field('Új jelszó', h('input', { type: 'password', name: 'new', autocomplete: 'new-password', minlength: 8 })),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Jelszó módosítása'));
  pw.addEventListener('submit', async e => { e.preventDefault(); try { await api('password', formData(pw)); toast('Jelszó módosítva.'); pw.reset(); } catch (er) { fail(er); } });
  const roleTxt = { admin: 'Admin – mindent szerkeszthetsz.', head: 'Családfő – a saját ágadon új adatot azonnal felvehetsz, módosítás és törlés admin jóváhagyással.', member: 'Családtag – javaslataidat az admin hagyja jóvá.' }[S.user.role];
  return h('div', null,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, S.user.name), h('p', null, roleTxt)), h('button', { class: 'btn', onclick: async () => { await api('logout', {}); location.hash = '#/'; location.reload(); } }, 'Kilépés')),
    h('div', { class: 'cols' },
      h('section', { class: 'section' }, h('h2', null, 'Beküldött módosításaim'),
        mine.length ? h('table', { class: 'tbl' }, h('tr', null, h('th', null, 'Mikor'), h('th', null, 'Mit'), h('th', null, 'Állapot')),
          mine.map(c => h('tr', null, h('td', null, c.created.slice(0, 16)), h('td', null, c.summary, c.review_note ? h('div', { class: 'hint' }, 'Admin: ', c.review_note) : null),
            h('td', null, h('span', { class: 'badge ' + ({ pending: 'pend', approved: 'ok', rejected: 'bad' }[c.status]) }, { pending: 'várakozik', approved: 'elfogadva', rejected: 'elutasítva' }[c.status])))))
          : h('p', { class: 'empty' }, 'Még nem küldtél be jóváhagyandó módosítást.'),
        S.boot.branchRoots?.length ? h('div', { style: 'margin-top:24px' }, h('h2', null, 'Az én ágam'), h('div', { class: 'plist' }, S.boot.branchRoots.map(id => chip(id, 'ág kezdete')))) : null),
      h('div', null, pw)));
}
