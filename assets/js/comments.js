// Comments (hozzászólások) under persons, families, stories and photos – for logged-in members.
import { S, T, api, h, icon, fail, toast, confirmBox, personName, familyLabel, P, F, tx, trText } from './core.js';

const enabled = () => (S.settings.comments || 'members') !== 'off';

function when(ts) {
  if (!ts) return '';
  const d = new Date(ts.replace(' ', 'T'));
  if (isNaN(d)) return ts;
  const loc = { hu: 'hu-HU', en: 'en-GB', de: 'de-DE' }[S.lang] || 'hu-HU';
  const today = new Date().toDateString() === d.toDateString();
  return today ? T('ma') + ' ' + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
}

/** A text box with a send button; resolves the text through onSend (which may throw). */
function composer({ placeholder, label, value = '', onSend, onCancel, storyBox = false }) {
  const ta = h('textarea', { rows: 3, maxlength: 5000, placeholder }, value);
  // a memory / anecdote (not a data fix): it is listed on the Stories page too
  const sb = storyBox ? h('input', { type: 'checkbox' }) : null;
  const send = h('button', { class: 'btn btn-sm btn-primary', type: 'button' }, icon('chat'), label);
  const go = async () => {
    const v = ta.value.trim();
    if (!v) { ta.focus(); return; }
    send.disabled = true;
    try { await onSend(v, !!sb?.checked); ta.value = ''; if (sb) sb.checked = false; } catch (e) { fail(e); } finally { send.disabled = false; }
  };
  send.addEventListener('click', go);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } });
  return h('div', { class: 'c-compose' }, ta,
    sb ? h('label', { class: 'check c-story-check', title: T('Nem adat-pontosítás, hanem egy emlék, anekdota, történet: a Történetek menüpontban is megjelenik (ugyanez a hozzászólás, nem másolat).') },
      sb, h('span', null, icon('book'), ' ', T('Ez egy történet, emlék – a Történetek között is jelenjen meg'))) : null,
    h('div', { class: 'row' }, send,
    onCancel ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: onCancel }, T('Mégse')) : null,
    h('span', { class: 'hint' }, T('Ctrl+Enter: küldés'))));
}

/**
 * The comment thread of one item. Returns a section that loads itself.
 * entity: 'person' | 'family' | 'story' | 'photo'
 */
export function commentsBox(entity, id, { compact = false } = {}) {
  if (!enabled()) return null;
  const head = h(compact ? 'h4' : 'h2', compact ? { style: 'margin-top:20px' } : null, icon('chat'), ' ', T('Hozzászólások'));
  const box = h('section', { class: 'section comments' + (compact ? ' compact' : '') }, head);
  if (!S.user) {
    box.append(h('p', { class: 'hint' }, h('a', { href: '#/login?next=' + encodeURIComponent(location.hash) }, T('Jelentkezz be')), T(' a hozzászólások olvasásához és írásához.')));
    return box;
  }
  const list = h('div', { class: 'c-list' }, h('p', { class: 'hint' }, T('Betöltés…')));
  let replyTo = null, editing = null, items = [];

  const load = async () => {
    try { items = await api('comments', null, { query: { entity, entity_id: id } }); } catch (e) { list.replaceChildren(h('p', { class: 'hint' }, e.message)); return; }
    draw();
  };
  const one = c => {
    if (c.deleted) return h('div', { class: 'c-item deleted' }, h('p', { class: 'hint' }, T('(törölt hozzászólás)')));
    const body = editing === c.id
      ? composer({ placeholder: '', label: T('Mentés'), value: c.body, onCancel: () => { editing = null; draw(); },
          onSend: async v => { await api('comment.edit', { id: c.id, body: v }); editing = null; await load(); } })
      : trText(c, 'body', 'div', { class: 'c-body' });
    return h('div', { class: 'c-item', id: 'c' + c.id },
      h('div', { class: 'c-meta' }, h('b', null, c.author || T('ismeretlen')), h('span', null, when(c.created)), c.edited ? h('span', null, T('(javítva)')) : null,
        c.story ? h('a', { class: 'c-story-badge', href: '#/story/c-' + c.id, title: T('A Történetek között is megjelenik') }, icon('book'), T('Történet')) : null),
      body,
      editing === c.id ? null : h('div', { class: 'c-act' },
        h('button', { class: 'linkbtn', onclick: () => { replyTo = c.parent_id || c.id; editing = null; draw(); } }, T('Válasz')),
        c.mine ? h('button', { class: 'linkbtn', onclick: () => { editing = c.id; replyTo = null; draw(); } }, T('Javítás')) : null,
        c.can_story ? h('button', { class: 'linkbtn', title: T('Emlék, anekdota, történet: a Történetek menüpontban is megjelenik (ugyanez a hozzászólás, nem másolat).'), onclick: async () => {
          try { await api('comment.story', { id: c.id, on: !c.story }); toast(c.story ? T('Már nem látszik a Történetek között.') : T('Megjelenik a Történetek között is.')); await load(); } catch (e) { fail(e); }
        } }, c.story ? T('Kivétel a Történetek közül') : T('Történetek közé')) : null,
        c.can_delete ? h('button', { class: 'linkbtn', onclick: async () => {
          if (!await confirmBox(T('Hozzászólás törlése'), T('Biztosan törlöd ezt a hozzászólást?'), T('Törlés'))) return;
          try { await api('comment.delete', { id: c.id }); await load(); } catch (e) { fail(e); }
        } }, T('Törlés')) : null));
  };
  const draw = () => {
    const roots = items.filter(c => !c.parent_id);
    head.replaceChildren(icon('chat'), ' ', T('Hozzászólások'), items.filter(c => !c.deleted).length ? h('span', { class: 'c-count' }, items.filter(c => !c.deleted).length) : null);
    list.replaceChildren(
      roots.length ? null : h('p', { class: 'hint' }, T('Még nincs hozzászólás. Pontosítanál, kérdeznél, vagy tudsz egy érdekességet? Írd meg!')),
      roots.map(r => h('div', { class: 'c-thread' }, one(r),
        h('div', { class: 'c-replies' }, items.filter(c => c.parent_id === r.id).map(one),
          replyTo === r.id ? composer({ placeholder: T('Válasz…'), label: T('Válasz küldése'), onCancel: () => { replyTo = null; draw(); },
            onSend: async v => { await api('comment.add', { entity, entity_id: id, parent_id: r.id, body: v }); replyTo = null; await load(); } }) : null))));
    if (replyTo) list.querySelector('.c-replies textarea')?.focus();
  };
  box.append(list, composer({ placeholder: T('Pontosítás, kérdés, emlék, érdekesség…'), label: T('Hozzászólás küldése'),
    storyBox: true,
    onSend: async (v, story) => { await api('comment.add', { entity, entity_id: id, body: v, story }); toast(story ? T('Hozzászólás elküldve – a Történetek között is megjelenik.') : T('Hozzászólás elküldve.')); await load(); } }));
  load();
  return box;
}

/** Home page: the latest comments with what they are about. */
export function recentComments(list, openPhoto) {
  if (!enabled() || !S.user || !list?.length) return null;
  const target = c => {
    if (c.entity === 'person') return h('a', { href: '#/person/' + c.entity_id }, P(c.entity_id) ? personName(P(c.entity_id)) : T('ismeretlen'));
    if (c.entity === 'family') return h('a', { href: '#/family/' + c.entity_id }, F(c.entity_id) ? familyLabel(F(c.entity_id)) : T('család'));
    if (c.entity === 'story') return h('a', { href: '#/story/' + c.entity_id }, c.title || T('sztori'));
    return h('a', { href: '#', onclick: e => { e.preventDefault(); openPhoto([{ id: c.entity_id }]); } }, c.title || T('fotó'));
  };
  return h('section', { class: 'section' }, h('h2', null, T('Legutóbbi hozzászólások')),
    list.map(c => h('div', { class: 'c-recent' },
      h('div', { class: 'c-meta' }, h('b', null, c.author || T('ismeretlen')), ' → ', target(c), h('span', null, when(c.created))),
      h('div', { class: 'c-body' }, (b => b.length > 180 ? b.slice(0, 180) + '…' : b)(tx(c, 'body'))))));
}
