// Family-tree diagrams rendered as SVG: layout → render → pan/zoom → export (SVG/PNG/server).
import { S, P, F, h, api, personName, years, parentsOf, spouseIn, toast, fail } from './core.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const c of kids) if (c) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
};

export const CHART_KINDS = {
  ancestors: { label: 'Felmenők', icon: 'ancestors', up: true },
  descendants: { label: 'Leszármazottak', icon: 'descendants', down: true },
  hourglass: { label: 'Homokóra', icon: 'hourglass', up: true, down: true },
  fan: { label: 'Legyező', icon: 'fan', up: true },
  family: { label: 'Családlap', icon: 'family' },
  relation: { label: 'Rokonság', icon: 'relation' },
};

function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  return { surface: v('--surface'), surface2: v('--surface-2'), paper: v('--paper'), ink: v('--ink'), muted: v('--muted'), line: v('--line'),
    male: v('--male'), female: v('--female'), unknown: v('--unknown'), accent: v('--accent'), cover: v('--cover'), coverInk: v('--cover-ink') };
}
const sexColor = (pal, sx) => sx === 'M' ? pal.male : sx === 'F' ? pal.female : pal.unknown;

// ======================================================================= layouts
// Each returns { nodes:[{id,x,y,w,h,root?}], links:[{d, kind}], extra:[], bounds }
function boxSize(o) { return { w: o.photos ? 196 : 168, h: o.places ? 74 : 62 }; }

export function layoutAncestors(rootId, o, vertical = false) {
  const { w, hh } = { w: boxSize(o).w, hh: boxSize(o).h };
  const G = o.up; const nodes = []; const links = [];
  const gapMain = vertical ? 58 : 46, gapCross = vertical ? 14 : 12;
  let next = 0;
  const seen = new Map();
  const place = (id, g) => {
    const parents = g < G ? parentsOf(id) : [];
    let cross;
    const pk = [];
    for (const pid of parents) pk.push(place(pid, g + 1));
    if (!pk.length) { cross = next; next += (vertical ? w : hh) + gapCross; }
    else cross = (pk[0].cross + pk[pk.length - 1].cross) / 2;
    const main = g * ((vertical ? hh : w) + gapMain);
    const n = vertical ? { id, x: cross, y: -main, w, h: hh, g, cross } : { id, x: main, y: cross, w, h: hh, g, cross };
    n.dup = seen.has(id); seen.set(id, true);
    nodes.push(n);
    for (const c of pk) {
      if (vertical) { const x1 = n.x + w / 2, y1 = n.y, x2 = c.x + w / 2, y2 = c.y + hh, my = (y1 + y2) / 2; links.push({ d: `M${x1},${y1}V${my}H${x2}V${y2}` }); }
      else { const x1 = n.x + w, y1 = n.y + hh / 2, x2 = c.x, y2 = c.y + hh / 2, mx = (x1 + x2) / 2; links.push({ d: `M${x1},${y1}H${mx}V${y2}H${x2}` }); }
    }
    return n;
  };
  const r = place(rootId, 0);
  r.root = true;
  return { nodes, links };
}

export function layoutDescendants(rootId, o, { withRootSpouses = true } = {}) {
  const { w, h: hh } = boxSize(o);
  const G = o.down, sgap = 18, kgap = 22, vgap = 64;
  const nodes = [], links = [];
  const guard = new Set();
  const measure = (id, d) => {
    const p = P(id);
    const fams = (d < G || (d === G && o.spouses)) && (d > 0 || withRootSpouses) ? (p?.fs || []).map(F).filter(Boolean) : [];
    const showSp = o.spouses !== false;
    const unitW = w + (showSp ? fams.filter(f => spouseIn(f, id)).length * (w + sgap) : 0);
    const kids = [];
    if (d < G && !guard.has(id)) {
      guard.add(id);
      for (const f of fams) for (const c of f.c) kids.push({ fam: f.id, m: measure(c, d + 1) });
    }
    const kidsW = kids.reduce((s, k) => s + k.m.width, 0) + Math.max(0, kids.length - 1) * kgap;
    return { id, d, fams, unitW, kids, kidsW, width: Math.max(unitW, kidsW), showSp };
  };
  const placeT = (m, left, top) => {
    const ux = left + (m.width - m.unitW) / 2;
    nodes.push({ id: m.id, x: ux, y: top, w, h: hh, root: m.d === 0 });
    const famX = {};
    let sx = ux + w + sgap;
    for (const f of m.fams) {
      const sp = spouseIn(f, m.id);
      if (m.showSp && sp) {
        nodes.push({ id: sp, x: sx, y: top, w, h: hh, spouse: true, div: f.dv });
        links.push({ d: `M${sx - sgap},${top + hh / 2}H${sx}`, kind: f.dv ? 'div' : 'marr' });
        famX[f.id] = sx - sgap / 2; sx += w + sgap;
      } else famX[f.id] = ux + w / 2;
    }
    let kx = left + (m.width - m.kidsW) / 2;
    const ky = top + hh + vgap;
    const byFam = {};
    for (const k of m.kids) {
      placeT(k.m, kx, ky);
      const kn = nodes.find(n => n.id === k.m.id && n.y === ky && !n.spouse && n.x >= kx - 1 && n.x <= kx + k.m.width);
      (byFam[k.fam] ||= []).push(kn.x + w / 2);
      kx += k.m.width + kgap;
    }
    for (const [fid, xs] of Object.entries(byFam)) {
      const fx = famX[fid] ?? ux + w / 2, bus = top + hh + vgap / 2;
      const lo = Math.min(fx, ...xs), hi = Math.max(fx, ...xs);
      let d = `M${fx},${top + (famX[fid] !== ux + w / 2 ? hh / 2 : hh)}V${bus}M${lo},${bus}H${hi}`;
      for (const x of xs) d += `M${x},${bus}V${ky}`;
      links.push({ d });
    }
  };
  placeT(measure(rootId, 0), 0, 0);
  return { nodes, links };
}

export function layoutHourglass(rootId, o) {
  const down = layoutDescendants(rootId, o);
  const up = layoutAncestors(rootId, o, true);
  const rd = down.nodes.find(n => n.root), ru = up.nodes.find(n => n.root);
  const dx = rd.x - ru.x, dy = rd.y - ru.y;
  const shift = d => d.replace(/([MLHV])([-\d.]+)(?:,([-\d.]+))?/g, (m, c, a, b) => c === 'H' ? `H${+a + dx}` : c === 'V' ? `V${+a + dy}` : `${c}${+a + dx},${+b + dy}`);
  const nodes = down.nodes.concat(up.nodes.filter(n => !n.root).map(n => ({ ...n, x: n.x + dx, y: n.y + dy })));
  const links = down.links.concat(up.links.map(l => ({ ...l, d: shift(l.d) })));
  return { nodes, links };
}

export function layoutFamily(rootId, o) {
  const { w, h: hh } = boxSize(o);
  const nodes = [], links = [];
  const gap = 18, vgap = 70;
  const bf = P(rootId)?.fc?.length ? F(P(rootId).fc[0]) : null;
  const sibs = bf ? bf.c.slice() : [rootId];
  if (!sibs.includes(rootId)) sibs.push(rootId);
  const fams = (P(rootId)?.fs || []).map(F).filter(Boolean);
  // middle row: siblings (in birth order) with root's spouses right after the root
  const row = [];
  for (const s of sibs) { row.push({ id: s, root: s === rootId }); if (s === rootId) for (const f of fams) { const sp = spouseIn(f, rootId); if (sp) row.push({ id: sp, spouse: true, fam: f.id }); } }
  const rowW = row.length * w + (row.length - 1) * gap;
  const y1 = hh + vgap;
  row.forEach((n, i) => nodes.push({ ...n, x: i * (w + gap), y: y1, w, h: hh }));
  const rootN = nodes.find(n => n.root);
  if (bf) {
    const parents = [bf.h, bf.w].filter(Boolean);
    const pw = parents.length * w + (parents.length - 1) * gap;
    const px0 = rowW / 2 - pw / 2;
    parents.forEach((id, i) => nodes.push({ id, x: px0 + i * (w + gap), y: 0, w, h: hh }));
    const cx = rowW / 2, bus = y1 - vgap / 2;
    let d = parents.length === 2 ? `M${px0 + w},${hh / 2}H${px0 + w + gap}M${cx},${hh / 2}V${bus}` : `M${cx},${hh}V${bus}`;
    const sibNodes = nodes.filter(n => sibs.includes(n.id) && n.y === y1);
    const xs = sibNodes.map(n => n.x + w / 2);
    d += `M${Math.min(cx, ...xs)},${bus}H${Math.max(cx, ...xs)}`;
    for (const x of xs) d += `M${x},${bus}V${y1}`;
    links.push({ d });
  }
  // children of root below, grouped under each spouse
  const y2 = y1 + hh + vgap;
  const kidsAll = [];
  for (const f of fams) for (const c of f.c) kidsAll.push({ c, f });
  const kw = kidsAll.length * w + Math.max(0, kidsAll.length - 1) * gap;
  const kx0 = rootN.x + w / 2 + (fams.length && spouseIn(fams[0], rootId) ? (w + gap) / 2 : 0) - kw / 2;
  kidsAll.forEach((k, i) => nodes.push({ id: k.c, x: kx0 + i * (w + gap), y: y2, w, h: hh }));
  for (const f of fams) {
    const spN = nodes.find(n => n.spouse && n.fam === f.id);
    const fx = spN ? spN.x - gap / 2 : rootN.x + w / 2;
    if (spN) links.push({ d: `M${spN.x - gap},${y1 + hh / 2}H${spN.x}`, kind: f.dv ? 'div' : 'marr' });
    const xs = kidsAll.map((k, i) => k.f === f ? kx0 + i * (w + gap) + w / 2 : null).filter(x => x !== null);
    if (!xs.length) continue;
    const bus = y2 - vgap / 2;
    let d = `M${fx},${y1 + (spN ? hh / 2 : hh)}V${bus}M${Math.min(fx, ...xs)},${bus}H${Math.max(fx, ...xs)}`;
    for (const x of xs) d += `M${x},${bus}V${y2}`;
    links.push({ d });
  }
  return { nodes, links };
}

// ------------------------------------------------------------- relationship path
export function findPath(a, b) {
  a = +a; b = +b;
  if (a === b) return [{ id: a }];
  const prev = new Map([[a, null]]);
  const q = [a];
  const nb = id => {
    const out = [];
    const p = P(id); if (!p) return out;
    for (const fid of p.fc || []) { const f = F(fid); if (f?.h) out.push([f.h, 'up']); if (f?.w) out.push([f.w, 'up']); }
    for (const fid of p.fs || []) { const f = F(fid); if (!f) continue; const sp = spouseIn(f, id); if (sp) out.push([sp, 'sp']); for (const c of f.c) out.push([c, 'down']); }
    return out;
  };
  while (q.length) {
    const id = q.shift();
    for (const [n, how] of nb(id)) {
      if (prev.has(n)) continue;
      prev.set(n, { from: id, how });
      if (n === b) {
        const path = [{ id: b, how }];
        let cur = prev.get(b);
        while (cur) { path.unshift({ id: cur.from, how: prev.get(cur.from)?.how }); cur = prev.get(cur.from); }
        path[0].how = null;
        return path;
      }
      q.push(n);
    }
  }
  return null;
}
const STEP = { up: { M: 'apja', F: 'anyja', U: 'szülője' }, down: { M: 'fia', F: 'lánya', U: 'gyermeke' }, sp: { M: 'férje', F: 'felesége', U: 'házastársa' } };
/** Hungarian kinship term (possessive form) for a blood path: `a` steps up then `b` steps down; sx = sex of the target. */
export function kinTerm(a, b, sx) {
  const pick = (m, f, u) => sx === 'M' ? m : sx === 'F' ? f : u;
  if (b === 0) {
    const t = [null, pick('apja', 'anyja', 'szülője'), pick('nagyapja', 'nagyanyja', 'nagyszülője'), pick('dédapja', 'dédanyja', 'dédszülője'),
      pick('ükapja', 'ükanyja', 'ükszülője'), pick('szépapja', 'szépanyja', 'szépszülője')][a];
    return t || `${a}. nemzedékbeli felmenője`;
  }
  if (a === 0) return [null, pick('fia', 'lánya', 'gyermeke'), 'unokája', 'dédunokája', 'ükunokája', 'szépunokája'][b] || `${b}. nemzedékbeli leszármazottja`;
  if (a === 1 && b === 1) return pick('fiútestvére', 'lánytestvére', 'testvére');
  if (a === 2 && b === 1) return pick('nagybátyja', 'nagynénje', 'nagybátyja vagy nagynénje');
  if (a === 1 && b === 2) return pick('unokaöccse', 'unokahúga', 'unokaöccse vagy unokahúga');
  if (a === 3 && b === 1) return pick('dédnagybátyja', 'dédnagynénje', 'szüleinek nagybátyja vagy nagynénje');
  if (a === 1 && b === 3) return 'testvérének unokája';
  const deg = n => n === 1 ? 'unokatestvére' : n === 2 ? 'másodunokatestvére' : n === 3 ? 'harmadunokatestvére' : `${n}. unokatestvére`;
  const c = Math.min(a, b) - 1;
  if (a === b) return deg(c);
  return `${deg(c)} (${Math.abs(a - b)} nemzedék eltéréssel)`;
}
export function relationLabel(path) {
  if (!path) return 'A családfában nincs kimutatható kapcsolat kettejük között.';
  if (path.length === 1) return 'Ugyanazt a személyt választottad.';
  const steps = path.slice(1).map(s => s.how);
  const from = P(path[0].id), tgt = P(path[path.length - 1].id);
  let a = 0, b = 0, blood = true;
  for (const x of steps) { if (x === 'up') { if (b) blood = false; a++; } else if (x === 'down') b++; else blood = false; }
  const tn = personName(tgt, { withTitle: false }), fn = personName(from, { withTitle: false });
  if (blood) return `${tn} ${fn} ${kinTerm(a, b, tgt?.sx)}.`;
  if (steps.length === 1) return `${tn} ${fn} ${STEP.sp[tgt?.sx || 'U']}.`;
  return `${tn} és ${fn} kapcsolata ${steps.length} lépésben: ` + path.slice(1).map(s => STEP[s.how][P(s.id)?.sx || 'U']).join(' → ') + '.';
}
export function layoutRelation(a, b, o) {
  const { w, h: hh } = boxSize(o);
  const path = findPath(a, b);
  const nodes = [], links = [], extra = [];
  if (!path) return { nodes: [{ id: +a, x: 0, y: 0, w, h: hh, root: true }], links, extra, path };
  let x = 0, y = 0;
  path.forEach((s, i) => {
    if (i > 0) {
      if (s.how === 'up') { y -= hh + 56; x += w * 0.62; }
      else if (s.how === 'down') { y += hh + 56; x += w * 0.62; }
      else x += w + 60;
    }
    nodes.push({ id: s.id, x, y, w, h: hh, root: i === 0 || i === path.length - 1 });
    if (i > 0) {
      const p = nodes[i - 1], n = nodes[i];
      const tgt = P(s.id);
      const lab = STEP[s.how][tgt?.sx || 'U'];
      if (s.how === 'sp') { links.push({ d: `M${p.x + w},${p.y + hh / 2}H${n.x}`, kind: 'marr' }); extra.push({ x: (p.x + w + n.x) / 2, y: p.y + hh / 2 - 8, t: lab }); }
      else {
        const up = s.how === 'up';
        const x1 = p.x + w / 2, y1 = up ? p.y : p.y + hh, x2 = n.x + w / 2, y2 = up ? n.y + hh : n.y, my = (y1 + y2) / 2;
        links.push({ d: `M${x1},${y1}V${my}H${x2}V${y2}` });
        extra.push({ x: (x1 + x2) / 2, y: my - 7, t: lab });
      }
    }
  });
  return { nodes, links, extra, path };
}

// ======================================================================= rendering
function measureBounds(nodes, extraPts = []) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h); }
  for (const p of extraPts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  if (!isFinite(x0)) return { x: 0, y: 0, w: 100, h: 100 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function clip(s, max) { s = String(s || ''); return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s; }

function personBox(n, o, pal, defs, uid) {
  const p = P(n.id) || { g: '?', sx: 'U' };
  const st = o.style || 'album';
  const g = sv('g', { class: 'node', transform: `translate(${n.x},${n.y})`, 'data-id': n.id, tabindex: 0, role: 'button', 'aria-label': personName(p) });
  const col = sexColor(pal, p.sx);
  const fill = st === 'classic' ? pal.surface2 : st === 'minimal' ? 'none' : pal.surface;
  const stroke = n.root ? pal.accent : st === 'classic' ? col : pal.line;
  g.append(sv('rect', { width: n.w, height: n.h, rx: st === 'classic' ? 3 : 9, fill, stroke, 'stroke-width': n.root ? 2.4 : 1, ...(n.dup ? { 'stroke-dasharray': '4 3' } : {}) }));
  if (st !== 'minimal') g.append(sv('rect', { x: 0, y: st === 'classic' ? 0 : 8, width: 4, height: st === 'classic' ? n.h : n.h - 16, rx: 2, fill: col }));
  else g.append(sv('rect', { x: 0, y: n.h - 2, width: n.w, height: 2, fill: col }));
  let tx = 14;
  const r = Math.min(23, n.h / 2 - 7);
  if (o.photos) {
    const cx = 12 + r, cy = n.h / 2;
    if (p.ph) {
      const cid = `c${uid}_${n.id}_${Math.round(n.x)}_${Math.round(n.y)}`.replace(/[^\w]/g, '_');
      defs.append(sv('clipPath', { id: cid }, sv('circle', { cx, cy, r })));
      const fx = p.fx ?? .5, fy = p.fy ?? .35;
      // emulate object-fit:cover with a focus point on a square crop
      g.append(sv('image', { href: p.ph, x: cx - r, y: cy - r, width: r * 2, height: r * 2, preserveAspectRatio: `x${fx < .34 ? 'Min' : fx > .66 ? 'Max' : 'Mid'}Y${fy < .34 ? 'Min' : fy > .66 ? 'Max' : 'Mid'} slice`, 'clip-path': `url(#${cid})` }));
      g.append(sv('circle', { cx, cy, r, fill: 'none', stroke: col, 'stroke-width': 1.5 }));
    } else {
      g.append(sv('circle', { cx, cy, r, fill: pal.surface2, stroke: pal.line }));
      g.append(sv('text', { x: cx, y: cy + 5, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700, fill: pal.muted, 'font-family': 'Alegreya, Georgia, serif' }, ((p.s || '')[0] || '') + ((p.g || '')[0] || '')));
    }
    tx = 12 + r * 2 + 9;
  }
  const maxC = Math.floor((n.w - tx - 6) / 7.1);
  const west = S.settings.name_order === 'west';
  const l1 = p.masked && S.settings.privacy_living === 'names' ? 'Élő személy' : (west ? p.g : p.s) || '';
  const l2 = p.masked && S.settings.privacy_living === 'names' ? '' : ((p.t ? p.t + ' ' : '') + ((west ? p.s : p.g) || ''));
  const font = 'Alegreya, Georgia, serif', sans = '"Alegreya Sans", "Segoe UI", sans-serif';
  const top = o.places ? 20 : 23;
  g.append(sv('text', { x: tx, y: top, 'font-size': 15, 'font-weight': 700, fill: pal.ink, 'font-family': font }, clip(l1 || l2 || '?', maxC)));
  if (l1 && l2) g.append(sv('text', { x: tx, y: top + 17, 'font-size': 14, fill: pal.ink, 'font-family': font }, clip(l2, maxC + 1)));
  const yr = years(p);
  g.append(sv('text', { x: tx, y: top + (l1 && l2 ? 33 : 18), 'font-size': 12.5, fill: pal.muted, 'font-family': sans }, yr));
  if (o.places && (p.bp || p.dp)) g.append(sv('text', { x: tx, y: top + 48, 'font-size': 11.5, fill: pal.muted, 'font-family': sans }, clip(p.bp || p.dp, maxC + 3)));
  if (n.div) g.append(sv('text', { x: n.w - 8, y: 14, 'text-anchor': 'end', 'font-size': 11, fill: pal.muted, 'font-family': sans }, 'elvált'));
  return g;
}

function renderFan(rootId, o, pal, svgRoot, defs, uid) {
  const G = Math.min(o.up, 8);
  const r0 = 78, ring = o.photos ? 92 : 84;
  const span = 240 * Math.PI / 180, start = -Math.PI / 2 - span / 2;
  const g = sv('g');
  const slots = [[rootId]];
  for (let gi = 1; gi <= G; gi++) {
    const prev = slots[gi - 1], cur = [];
    for (const id of prev) { if (!id) { cur.push(null, null); continue; } const bf = P(id)?.fc?.length ? F(P(id).fc[0]) : null; cur.push(bf?.h || null, bf?.w || null); }
    slots.push(cur);
  }
  const arc = (ri, ro, a0, a1) => {
    const p = (r, a) => `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${p(ri, a0)}L${p(ro, a0)}A${ro},${ro} 0 ${large} 1 ${p(ro, a1)}L${p(ri, a1)}A${ri},${ri} 0 ${large} 0 ${p(ri, a0)}Z`;
  };
  const font = 'Alegreya, Georgia, serif', sans = '"Alegreya Sans", "Segoe UI", sans-serif';
  const nodes = [];
  for (let gi = 1; gi <= G; gi++) {
    const n = slots[gi].length, ri = r0 + (gi - 1) * ring, ro = ri + ring, da = span / n;
    for (let i = 0; i < n; i++) {
      const id = slots[gi][i];
      const a0 = start + i * da, a1 = a0 + da, am = (a0 + a1) / 2;
      const p = id ? P(id) : null;
      const col = p ? sexColor(pal, p.sx) : pal.line;
      const seg = sv('g', id ? { class: 'node', 'data-id': id, tabindex: 0, role: 'button', 'aria-label': personName(p) } : {});
      seg.append(sv('path', { d: arc(ri, ro, a0, a1), fill: p ? `color-mix(in srgb, ${col} ${gi % 2 ? 16 : 10}%, ${pal.surface})` : pal.surface2, stroke: pal.line, 'stroke-width': 1 }));
      if (p) {
        // fallback fill for renderers without color-mix (PNG export)
        seg.firstChild.setAttribute('data-col', col);
        const rm = (ri + ro) / 2;
        const deg = am * 180 / Math.PI;
        const arcLen = da * rm;
        const radial = arcLen < 120;
        let rot = radial ? deg : deg + 90;
        let flip = radial ? (deg > 90 || deg < -90) : (deg > 0 && deg < 180);
        if (flip) rot += 180;
        const tg = sv('g', { transform: `translate(${(rm * Math.cos(am)).toFixed(1)},${(rm * Math.sin(am)).toFixed(1)}) rotate(${rot.toFixed(1)})` });
        const maxC = Math.max(4, Math.floor((radial ? ring - 10 : arcLen - 10) / 7));
        const fs = gi >= 5 ? 11.5 : 13.5;
        const nm = radial ? personName(p, { short: true, withTitle: false }) : (S.settings.name_order === 'west' ? p.g : p.s) || '';
        const thick = radial ? Math.min(3, Math.floor(arcLen / 14)) : 3;
        const lines = radial ? [clip(nm, maxC), thick > 1 ? years(p) : ''] : [clip(nm, maxC), clip((S.settings.name_order === 'west' ? p.s : p.g) || '', maxC), years(p)];
        const used = lines.filter(Boolean);
        used.forEach((t, li) => tg.append(sv('text', { x: 0, y: (li - (used.length - 1) / 2) * (fs + 2) + 4, 'text-anchor': 'middle', 'font-size': li === used.length - 1 && used.length > 1 ? fs - 2 : fs, 'font-weight': li === 0 ? 700 : 400, fill: li === used.length - 1 && used.length > 1 ? pal.muted : pal.ink, 'font-family': li === used.length - 1 && used.length > 1 ? sans : font }, t)));
        seg.append(tg);
      }
      g.append(seg);
    }
  }
  // center
  const rp = P(rootId);
  const cg = sv('g', { class: 'node', 'data-id': rootId, tabindex: 0, role: 'button' });
  cg.append(sv('circle', { r: r0 - 4, fill: pal.surface, stroke: pal.accent, 'stroke-width': 2.4 }));
  if (o.photos && rp?.ph) {
    const cid = `fanc${uid}`;
    defs.append(sv('clipPath', { id: cid }, sv('circle', { r: r0 - 8 })));
    cg.append(sv('image', { href: rp.ph, x: -(r0 - 8), y: -(r0 - 8), width: (r0 - 8) * 2, height: (r0 - 8) * 2, preserveAspectRatio: 'xMidYMid slice', 'clip-path': `url(#${cid})` }));
    cg.append(sv('rect', { x: -(r0 - 8), y: 18, width: (r0 - 8) * 2, height: 34, fill: pal.surface, opacity: .82 }));
    cg.append(sv('text', { y: 33, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: pal.ink, 'font-family': font }, clip(personName(rp, { short: true, withTitle: false }), 18)));
    cg.append(sv('text', { y: 47, 'text-anchor': 'middle', 'font-size': 11.5, fill: pal.muted, 'font-family': sans }, years(rp)));
  } else {
    cg.append(sv('text', { y: -4, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700, fill: pal.ink, 'font-family': font }, clip((S.settings.name_order === 'west' ? rp?.g : rp?.s) || '', 16)));
    cg.append(sv('text', { y: 14, 'text-anchor': 'middle', 'font-size': 14, fill: pal.ink, 'font-family': font }, clip((S.settings.name_order === 'west' ? rp?.s : rp?.g) || '', 16)));
    cg.append(sv('text', { y: 32, 'text-anchor': 'middle', 'font-size': 12, fill: pal.muted, 'font-family': sans }, years(rp)));
  }
  g.append(cg);
  svgRoot.append(g);
  const R = r0 + G * ring;
  const lowY = Math.max(R * Math.sin(start + span), r0); // span ends 30° below the horizon
  return { x: -R, y: -R, w: 2 * R, h: R + lowY };
}

let UID = 0;
/**
 * Render a chart into `host`. Returns a controller {svg, bounds, fit(), exportSVG(), exportPNG(), destroy()}.
 * opts: kind, root, other (relation), up, down, photos, places, spouses, style, interactive, onNode(id), onOpen(id)
 */
export function renderChart(host, opts) {
  const o = { up: 3, down: 2, photos: true, places: false, spouses: true, style: 'album', interactive: true, ...opts };
  const pal = palette();
  const uid = ++UID;
  const svg = sv('svg', { xmlns: NS, 'xmlns:xlink': 'http://www.w3.org/1999/xlink', role: 'img', 'aria-label': (CHART_KINDS[o.kind]?.label || 'Diagram') + ': ' + personName(P(o.root)) });
  const defs = sv('defs');
  svg.append(defs);
  const world = sv('g');
  svg.append(world);
  let bounds, info = {};
  if (!P(o.root)) { host.replaceChildren(h('div', { class: 'empty', style: 'padding:30px' }, 'Válassz egy személyt.')); return null; }

  if (o.kind === 'fan') {
    bounds = renderFan(o.root, o, pal, world, defs, uid);
  } else {
    let L;
    if (o.kind === 'ancestors') L = layoutAncestors(o.root, o);
    else if (o.kind === 'descendants') L = layoutDescendants(o.root, o);
    else if (o.kind === 'family') L = layoutFamily(o.root, o);
    else if (o.kind === 'relation') { L = layoutRelation(o.root, o.other || o.root, o); info.path = L.path; info.label = relationLabel(L.path); }
    else L = layoutHourglass(o.root, o);
    const lg = sv('g', { fill: 'none', stroke: pal.muted, 'stroke-width': 1.4, 'stroke-linejoin': 'round', opacity: .75 });
    for (const l of L.links) lg.append(sv('path', { d: l.d, ...(l.kind === 'marr' ? { stroke: pal.accent, 'stroke-width': 2.2 } : {}), ...(l.kind === 'div' ? { stroke: pal.muted, 'stroke-dasharray': '5 4' } : {}) }));
    world.append(lg);
    for (const e of L.extra || []) world.append(sv('text', { x: e.x, y: e.y, 'text-anchor': 'middle', 'font-size': 12, fill: pal.accent, 'font-family': '"Alegreya Sans", sans-serif', 'font-style': 'italic', 'paint-order': 'stroke', stroke: pal.paper, 'stroke-width': 4 }, e.t));
    for (const n of L.nodes) world.append(personBox(n, o, pal, defs, uid));
    bounds = measureBounds(L.nodes);
    info.count = new Set(L.nodes.map(n => n.id)).size;
  }
  const pad = 30;
  bounds = { x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + 2 * pad, h: bounds.h + 2 * pad };
  host.replaceChildren(svg);

  // ---------------- viewBox pan/zoom
  let vb = { ...bounds };
  const apply = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const fit = (maxScale = 1.25) => {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height || !host.isConnected) return; // hidden or already replaced
    const W = r.width || 800, H = r.height || 500;
    const s = Math.min(W / bounds.w, H / bounds.h, maxScale);
    vb = { w: W / s, h: H / s, x: bounds.x + bounds.w / 2 - W / s / 2, y: bounds.y + bounds.h / 2 - H / s / 2 };
    apply();
  };
  const focusRoot = () => {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height || !host.isConnected) return;
    const node = world.querySelector(`.node[data-id="${o.root}"]`);
    if (!node || o.kind === 'fan') return fit();
    const bb = node.getBBox(); const ctm = node.transform.baseVal.consolidate()?.matrix;
    const cx = (ctm ? ctm.e : 0) + bb.x + bb.width / 2, cy = (ctm ? ctm.f : 0) + bb.y + bb.height / 2;
    const s = Math.min(r.width / bounds.w, r.height / bounds.h);
    if (s >= 0.7) return fit(1.1); // small chart: show all of it
    const sc = Math.max(s, Math.min(1, r.width / 1000));
    vb = { w: r.width / sc, h: r.height / sc, x: cx - r.width / sc / 2, y: cy - r.height / sc / 2 };
    apply();
  };
  const zoom = (f, cx, cy) => {
    const r = host.getBoundingClientRect();
    const px = cx === undefined ? .5 : (cx - r.left) / r.width, py = cy === undefined ? .5 : (cy - r.top) / r.height;
    const nw = Math.min(Math.max(vb.w * f, 120), bounds.w * 6 + 2000), nh = nw * (vb.h / vb.w);
    vb.x += (vb.w - nw) * px; vb.y += (vb.h - nh) * py; vb.w = nw; vb.h = nh;
    apply();
  };
  requestAnimationFrame(() => (o.focus || host.clientWidth < 640 ? focusRoot() : fit()));
  // embedded charts: one finger scrolls the page, two fingers pinch-zoom the chart; full-screen explorer: all gestures go to the chart
  host.style.touchAction = o.wheel === false ? 'pan-y' : 'none';

  const cleanups = [];
  let touched = false; // once the user zoomed/panned, resizes no longer reset the view
  if (o.interactive) {
    // pointers: 1 finger/mouse = pan, 2 fingers = pinch-zoom around their midpoint
    const pts = new Map();
    let drag = null, pinch = null, moved = false;
    const startDrag = (x, y) => { drag = { x, y, vx: vb.x, vy: vb.y }; };
    const down = e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (e.target.closest('.chart-ctl')) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { host.setPointerCapture(e.pointerId); } catch (_) { }
      if (pts.size === 1) { startDrag(e.clientX, e.clientY); moved = false; }
      if (pts.size === 2) {
        const [p1, p2] = [...pts.values()];
        pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, w: vb.w };
        drag = null; moved = true;
      }
    };
    const move = e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) {
        e.preventDefault();
        const [p1, p2] = [...pts.values()];
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
        const target = pinch.w * pinch.d / d;
        zoom(target / vb.w, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        touched = true;
        return;
      }
      if (!drag) return;
      const r = host.getBoundingClientRect(); const sc = vb.w / r.width;
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) { moved = true; touched = true; }
      vb.x = drag.vx - (e.clientX - drag.x) * sc; vb.y = drag.vy - (e.clientY - drag.y) * sc; apply();
    };
    const up = e => {
      pts.delete(e.pointerId);
      try { host.releasePointerCapture(e.pointerId); } catch (_) { }
      if (pts.size < 2) pinch = null;
      if (pts.size === 1) { const p = [...pts.values()][0]; startDrag(p.x, p.y); } else drag = null;
    };
    const wheel = e => { if (o.wheel === false && !e.ctrlKey && !e.metaKey) return; e.preventDefault(); touched = true; zoom(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY); };
    const click = e => {
      if (moved || e.target.closest('.chart-ctl')) return;
      const n = e.target.closest('.node'); if (!n) return;
      const id = +n.dataset.id;
      if (e.detail >= 2 || !o.onNode) { o.onOpen ? o.onOpen(id) : (location.hash = '#/person/' + id); return; }
      o.onNode(id);
    };
    const key = e => { const n = e.target.closest?.('.node'); if (n && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (o.onNode || (id => location.hash = '#/person/' + id))(+n.dataset.id); } };
    host.addEventListener('pointerdown', down); host.addEventListener('pointermove', move, { passive: false }); host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up);
    host.addEventListener('wheel', wheel, { passive: false }); host.addEventListener('click', click); host.addEventListener('keydown', key);
    cleanups.push(() => { host.removeEventListener('pointerdown', down); host.removeEventListener('pointermove', move); host.removeEventListener('pointerup', up); host.removeEventListener('pointercancel', up); host.removeEventListener('wheel', wheel); host.removeEventListener('click', click); host.removeEventListener('keydown', key); });
    // on-screen zoom buttons (always available: touch screens, trackpads, embedded charts without wheel zoom)
    if (o.controls !== false) {
      const btn = (label, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', ev => { ev.stopPropagation(); touched = true; fn(); }); return b; };
      const ctl = document.createElement('div');
      ctl.className = 'chart-ctl';
      ctl.append(btn('+', 'Nagyítás', () => zoom(0.75)), btn('−', 'Kicsinyítés', () => zoom(1.33)), btn('⤢', 'Teljes nézet', () => fit(3)));
      host.append(ctl);
    }
  } else {
    host.addEventListener('click', e => { const n = e.target.closest('.node'); if (n) (o.onOpen || (id => location.hash = '#/person/' + id))(+n.dataset.id); });
  }
  const ro = new ResizeObserver(() => { if (!touched) (o.focus || host.clientWidth < 640 ? focusRoot() : fit()); });
  ro.observe(host);
  cleanups.push(() => ro.disconnect());

  return {
    svg, bounds, info, opts: o, fit, zoom, focusRoot,
    destroy: () => cleanups.forEach(f => f()),
    exportSVG: (title) => buildExportSVG(svg, bounds, pal, title),
  };
}

// ======================================================================= export
async function toDataURL(url) {
  const r = await fetch(url, { credentials: 'same-origin' });
  const b = await r.blob();
  return await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
}
let fontCss = null;
async function embeddedFonts() {
  if (fontCss !== null) return fontCss;
  try {
    const css = await (await fetch('https://fonts.googleapis.com/css2?family=Alegreya:wght@400;700&family=Alegreya+Sans:ital,wght@0,400;1,400&display=swap')).text();
    const blocks = css.split('@font-face').slice(1).filter(b => /latin-ext|U\+0000-00FF|U\+0100/.test(b) || true);
    let out = '';
    for (const b of blocks) {
      const m = b.match(/url\((https:[^)]+)\)/); if (!m) continue;
      const data = await toDataURL(m[1]);
      out += '@font-face' + b.replace(m[1], data);
    }
    fontCss = out;
  } catch (e) { fontCss = ''; }
  return fontCss;
}
export async function buildExportSVG(svg, bounds, pal, title) {
  const c = svg.cloneNode(true);
  const titleH = title ? 64 : 0;
  const B = { x: bounds.x, y: bounds.y - titleH, w: bounds.w, h: bounds.h + titleH };
  c.setAttribute('viewBox', `${B.x} ${B.y} ${B.w} ${B.h}`);
  c.setAttribute('width', Math.round(B.w)); c.setAttribute('height', Math.round(B.h));
  // color-mix() is not understood by every SVG renderer → bake a flat tint
  c.querySelectorAll('[data-col]').forEach(el => { el.setAttribute('fill', tint(el.getAttribute('data-col'), pal.surface, .14)); el.removeAttribute('data-col'); });
  c.querySelectorAll('[tabindex]').forEach(el => { el.removeAttribute('tabindex'); el.removeAttribute('role'); });
  const bg = document.createElementNS(NS, 'rect');
  Object.entries({ x: B.x, y: B.y, width: B.w, height: B.h, fill: pal.paper }).forEach(([k, v]) => bg.setAttribute(k, v));
  c.insertBefore(bg, c.firstChild.nextSibling);
  if (title) {
    const t = sv('text', { x: B.x + 30, y: B.y + 44, 'font-size': 28, 'font-weight': 700, fill: pal.ink, 'font-family': 'Alegreya, Georgia, serif' }, title);
    c.append(t);
    c.append(sv('text', { x: B.x + B.w - 30, y: B.y + 44, 'text-anchor': 'end', 'font-size': 13, fill: pal.muted, 'font-family': '"Alegreya Sans", sans-serif' }, (S.settings.site_title || '') + ' · ' + new Date().toLocaleDateString('hu-HU')));
  }
  const imgs = [...c.querySelectorAll('image')];
  const cache = {};
  await Promise.all(imgs.map(async im => {
    const u = im.getAttribute('href');
    if (!u || u.startsWith('data:')) return;
    try { cache[u] ||= toDataURL(u); im.setAttribute('href', await cache[u]); } catch (e) { im.remove(); }
  }));
  const fonts = await embeddedFonts();
  if (fonts) { const st = document.createElementNS(NS, 'style'); st.textContent = fonts; c.querySelector('defs').append(st); }
  return { text: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(c), w: B.w, h: B.h };
}
function tint(hex, base, a) {
  const p = x => { x = x.trim(); if (x.startsWith('#')) { if (x.length === 4) x = '#' + [...x.slice(1)].map(c => c + c).join(''); return [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)); } const m = x.match(/\d+/g); return m ? m.slice(0, 3).map(Number) : [255, 255, 255]; };
  const A = p(hex), B = p(base);
  return '#' + A.map((v, i) => Math.round(v * a + B[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
}
export async function svgToPNG(svgText, w, h, scale = 2) {
  const maxSide = 14000;
  scale = Math.min(scale, maxSide / Math.max(w, h));
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('A diagram képpé alakítása nem sikerült.')); img.src = url; });
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  URL.revokeObjectURL(url);
  return cv;
}
export function download(name, blobOrUrl) {
  const a = document.createElement('a');
  a.download = name;
  a.href = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  document.body.append(a); a.click(); a.remove();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export async function exportChart(ctrl, { title, format = 'png', save = false, kind, person_id, config } = {}) {
  const ex = await ctrl.exportSVG(title);
  const base = (title || 'csaladfa').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').toLowerCase();
  if (format === 'svg' && !save) return download(base + '.svg', new Blob([ex.text], { type: 'image/svg+xml' }));
  const cv = await svgToPNG(ex.text, ex.w, ex.h, +S.settings.chart_png_scale || 2);
  if (!save) return new Promise(res => cv.toBlob(b => { download(base + '.png', b); res(); }, 'image/png'));
  const png = cv.toDataURL('image/png');
  return api('chart.save', { title, kind, person_id, config, png, svg: ex.text });
}
