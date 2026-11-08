// Family-tree diagrams rendered as SVG: layout → render → pan/zoom → export (SVG/PNG/server).
import { S, P, F, h, api, T, personName, years, parentsOf, spouseIn, toast, fail } from './core.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const c of kids) if (c) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
};

export const CHART_KINDS = {
  // orient: the kind can lay out its generations both ways; the value is its default (v = top-down, h = left-right)
  ancestors: { label: 'Felmenők', icon: 'ancestors', up: true, orient: 'h' },
  descendants: { label: 'Leszármazottak', icon: 'descendants', down: true, orient: 'v' },
  hourglass: { label: 'Családfa', icon: 'hourglass', up: true, down: true, orient: 'v' },
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
// card scale from the admin setting (chart_font %): fonts, cards and the spouse strips grow together
let K = 1;
// 100% = names as large as normal body text (16px) at the chart's starting zoom
// card shape (chart_card setting): 'tall' = narrow card, photo on top, name below – dense generations stay narrow;
// 'wide' = photo on the left, name beside it
export const cardShape = o => ((o && o.card) || S.settings?.chart_card || 'tall') === 'wide' ? 'wide' : 'tall';
/** Card size at 100% (before the chart_font scaling) and the visible strip of a tucked-in spouse card. */
// photo size on the cards (chart_photo setting): normal, large (default), xl (the circle overhangs the
// card edge a little), portrait (rounded ID-photo rectangle). The card grows with it, the text keeps its room.
const PHOTO_SIZES = ['normal', 'large', 'xl', 'portrait'];
export const photoSize = o => { const v = (o && o.photoSize) || S.settings?.chart_photo || 'large'; return PHOTO_SIZES.includes(v) ? v : 'large'; };
// tall: circle centre cy / radius r (or a rect), where the name starts (ty), extra card height (dh)
const TALL_PHOTO = {
  normal: { cy: 42, r: 31, ty: 96, dh: 0 },
  large: { cy: 50, r: 42, ty: 115, dh: 19 },
  xl: { cy: 46, r: 56, ty: 124, dh: 28 },
  portrait: { rect: [12, 12, 112, 132], ty: 166, dh: 70 },
};
// wide: circle centre cx / radius r (vertically centred) or a rect on the left; card height h, extra width dw
const WIDE_PHOTO = {
  normal: { r: 27, dw: 0 },
  large: { cx: 48, r: 36, h: 88, dw: 18 },
  xl: { cx: 34, r: 48, h: 92, dw: 16 },
  portrait: { rect: [12, 8, 70, 88], h: 104, dw: 16 },
};
function baseSize(o) {
  // the strip is tall enough for a recognisable photo of the spouse (not just a dot)
  const ps = photoSize(o);
  if (cardShape(o) === 'wide') {
    const q = WIDE_PHOTO[ps], h0 = o.places ? 90 : 76;
    if (!o.photos) return { w: 196, h: h0, sdx: 30, sdy: 30 };
    return { w: 224 + q.dw, h: Math.max(h0, q.h || 0), sdx: 30, sdy: 42 };
  }
  return { w: 136, h: (o.photos ? 146 + TALL_PHOTO[ps].dh : 80) + (o.places ? 16 : 0), sdx: 20, sdy: o.photos ? 58 : 44 };
}
function scaleK(o = {}) {
  K = Math.min(2.2, Math.max(0.6, (+S.settings?.chart_font || 125) / 100 * 16 / 17));
  const b = baseSize(o); SDX = Math.round(b.sdx * K); SDY = Math.round(b.sdy * K);
  return K;
}
function boxSize(o) { scaleK(o); const b = baseSize(o); return { w: Math.round(b.w * K), h: Math.round(b.h * K) }; }
// spouse cards slide in behind their partner: shifted right/down, only the bottom strip (with the name) shows
export let SDX = 30, SDY = 30;

/**
 * Where the line to the children of a person's k-th relationship (1-based, of n shown spouses) leaves the
 * stacked spouse cards: with several spouses the 1st exits to the left, the last to the right, the ones in
 * between straight down from their visible strip. Returns the path head and the x of the vertical drop.
 * lvl: side exits use a lower bus than the ones going straight down, so the lines never cross.
 * (ux, top) is the main card's corner; spouse k sits at (ux + k*SDX, top + k*SDY).
 */
export function famExit(ux, top, w, hh, k, n) {
  if (!k) {                                       // relationship without a known spouse: from the person card itself
    if (!n) return { head: `M${ux + w / 2},${top + hh}`, x: ux + w / 2 };
    const x = ux - (n === 1 ? 14 : 28);           // out on the left, outside the spouse-1 line; its children come first
    return { head: `M${ux},${top + hh / 2}H${x}`, x, lvl: n === 1 ? -1 : 0 }; // outer line, higher bus: no crossing
  }
  const sx = ux + k * SDX, cy = top + hh + (k - 0.5) * SDY, bottom = top + hh + k * SDY;
  if (n === 1) return { head: `M${sx + w / 2},${bottom}`, x: sx + w / 2 };
  if (k === 1) { const x = ux - 14; return { head: `M${sx},${cy}H${x}`, x, lvl: 1 }; }
  if (k === n && n >= 3) { const x = sx + w + 14; return { head: `M${sx + w},${cy}H${x}`, x, lvl: 1 }; }
  if (k === n) return { head: `M${sx + w / 2},${bottom}`, x: sx + w / 2, lvl: -1 }; // 2 spouses: 2nd goes down
  const x = sx + SDX / 2;                                                       // middle ones: down beside the next card
  return { head: `M${x},${bottom}`, x, lvl: -1 };
}

/** Effective generation direction of a chart: 'v' (top-down) or 'h' (left-right). */
export function chartOrient(o) {
  let def = CHART_KINDS[o.kind]?.orient;
  if (!def) return null;
  // narrow cards: the pedigree also grows upwards (wide cards read better side by side)
  if (o.kind === 'ancestors' && cardShape(o) === 'tall') def = 'v';
  return o.orient === 'h' || o.orient === 'v' ? o.orient : def;
}

// dir: in the horizontal layout the ancestors go to the right (1) or, in an hourglass, to the left (-1)
export function layoutAncestors(rootId, o, vertical = false, dir = 1, { noRootLinks = false } = {}) {
  const { w, hh } = { w: boxSize(o).w, hh: boxSize(o).h };
  const G = o.up; const nodes = []; const links = [];
  // o.viewUp (home page): the older generations are packed above without spreading the ones shown first
  const C = o.viewUp != null ? Math.min(G, o.viewUp) : G;
  const gapMain = vertical ? 58 : 46, gapCross = vertical ? 14 : 12;
  const size = vertical ? w : hh;
  let next = 0;
  const seen = new Map();
  const mk = (id, g, cross) => {
    const main = g * ((vertical ? hh : w) + gapMain) * (vertical ? 1 : dir);
    const n = vertical ? { id, x: cross, y: -main, w, h: hh, g, cross } : { id, x: main, y: cross, w, h: hh, g, cross };
    n.dup = seen.has(id); seen.set(id, true); n.gen = g;
    nodes.push(n);
    return n;
  };
  const link = (n, c) => {
    if (vertical) { const x1 = n.x + w / 2, y1 = n.y, x2 = c.x + w / 2, y2 = c.y + hh, my = (y1 + y2) / 2; links.push({ d: `M${x1},${y1}V${my}H${x2}V${y2}` }); }
    else { const x1 = dir > 0 ? n.x + w : n.x, y1 = n.y + hh / 2, x2 = dir > 0 ? c.x : c.x + w, y2 = c.y + hh / 2, mx = (x1 + x2) / 2; links.push({ d: `M${x1},${y1}H${mx}V${y2}H${x2}` }); }
  };
  const top = [];
  const place = (id, g) => {
    const parents = g < C ? parentsOf(id) : [];
    let cross;
    const pk = [];
    for (const pid of parents) pk.push(place(pid, g + 1));
    if (!pk.length) { cross = next; next += size + gapCross; }
    else cross = (pk[0].cross + pk[pk.length - 1].cross) / 2;
    const n = mk(id, g, cross);
    if (g === C) top.push(n);
    if (!(noRootLinks && g === 0)) for (const c of pk) link(n, c);
    return n;
  };
  const r = place(rootId, 0);
  r.root = true;
  // older generations: each couple centred on their child as far as the neighbours allow, row balanced
  let row = top;
  for (let g = C + 1; g <= G && row.length; g++) {
    const groups = [];
    for (const n of row) {
      if (n.dup) continue;
      const ps = parentsOf(n.id);
      if (!ps.length) continue;
      const gw = ps.length * size + (ps.length - 1) * gapCross;
      groups.push({ n, ps, gw, ideal: n.cross + size / 2 - gw / 2 });
    }
    if (!groups.length) break;
    let end = -Infinity;
    for (const q of groups) { q.c = Math.max(q.ideal, end + gapCross * 2); end = q.c + q.gw; }
    const shift = groups.reduce((s, q) => s + (q.ideal - q.c), 0) / groups.length;
    const nx = [];
    for (const q of groups) {
      let c = q.c + shift;
      for (const pid of q.ps) { const p = mk(pid, g, c); link(q.n, p); nx.push(p); c += size + gapCross; }
    }
    row = nx;
  }
  return { nodes, links };
}


/**
 * A person's families for drawing. Two families with the same spouse (a marriage entered twice) are drawn as one,
 * with all their children – otherwise the spouse would appear twice and look like a different person.
 */
function famsOf(id) {
  const out = [], bySp = new Map();
  for (const fid of P(id)?.fs || []) {
    const f = F(fid); if (!f) continue;
    const sp = spouseIn(f, id);
    if (sp && bySp.has(sp)) { const m = bySp.get(sp); for (const c of f.c || []) if (!m.c.includes(c)) m.c.push(c); continue; }
    const m = sp ? { ...f, c: [...(f.c || [])] } : f;
    if (sp) bySp.set(sp, m);
    out.push(m);
  }
  return out;
}

/**
 * How spouses are drawn (chart_spouses setting, explorer "Házastársak"): 'behind' = slid in behind the
 * partner's card, only a strip shows; 'beside' = a full card next to the partner, joined by a marriage line;
 * 'none' = not drawn. o.spouses may be true (the setting), false, or one of the three.
 */
export function spouseMode(o) {
  const v = o && o.spouses;
  if (v === false || v === 'none' || v === '0' || v === 0) return 'none';
  if (v === 'beside' || v === 'behind') return v;
  const d = S.settings?.chart_spouses;
  return d === 'behind' || d === 'none' ? d : 'beside';
}
const spGap = () => Math.round(18 * K);
let SP_RIGHT = false;   // set while a chart with the spouses' families is laid out

/**
 * A person with the spouses drawn next to / behind them, generations top-down. Returns the unit's size,
 * the offset of the person's own card inside it, and place(ux, top, nodes, links) that adds the spouse cards
 * (and marriage lines) and returns, per family id, where the line to that family's children starts.
 */
function spouseUnitV(id, fams, sps, mode, w, hh) {
  const n = sps.length;
  if (mode !== 'beside') return {
    unitW: w + n * SDX, unitH: hh + n * SDY, off: 0,
    place(ux, top, nodes) {
      const famPt = {};
      sps.forEach((f, i) => {
        const k = i + 1;
        nodes.push({ id: spouseIn(f, id), x: ux + k * SDX, y: top + k * SDY, w, h: hh, spouse: true, layer: k, of: id, div: f.dv });
        famPt[f.id] = famExit(ux, top, w, hh, k, n);
      });
      for (const f of fams) if (!famPt[f.id]) famPt[f.id] = famExit(ux, top, w, hh, 0, n);
      return famPt;
    },
  };
  // beside: 1st spouse on the right, 2nd on the left, 3rd further right…; the children's line drops from the gap
  // (with the spouse's family shown too, all spouses go to the right: their families are on that side)
  const SG = spGap(), step = w + SG, nL = SP_RIGHT ? 0 : Math.floor(n / 2);
  return {
    unitW: w * (1 + n) + n * SG, unitH: hh, off: nL * step,
    place(ux, top, nodes, links) {
      const px = ux + nL * step, my = top + hh / 2, famPt = {};
      sps.forEach((f, i) => {
        const k = i + 1, side = SP_RIGHT || k % 2 ? 1 : -1, idx = SP_RIGHT ? k : Math.ceil(k / 2);
        nodes.push({ id: spouseIn(f, id), x: px + side * idx * step, y: top, w, h: hh, sp: true, of: id, div: f.dv });
        const gx = side > 0 ? px + idx * step - SG / 2 : px - (idx - 1) * step - SG / 2;
        links.push({ d: `M${gx - SG / 2},${my}H${gx + SG / 2}`, kind: f.dv ? 'div' : 'marr' });
        famPt[f.id] = { head: `M${gx},${my}`, x: gx };
      });
      for (const f of fams) if (!famPt[f.id]) famPt[f.id] = { head: `M${px + w / 2},${top + hh}`, x: px + w / 2 };
      return famPt;
    },
  };
}
/** The same with the generations left → right: 'beside' spouses go below the person. */
function spouseUnitH(id, fams, sps, mode, w, hh) {
  const n = sps.length;
  if (mode !== 'beside') return {
    unitW: w + n * SDX, unitH: hh + n * SDY, off: 0,
    place(ux, uy, nodes) {
      const famPt = {};
      sps.forEach((f, i) => {
        const k = i + 1;
        nodes.push({ id: spouseIn(f, id), x: ux + k * SDX, y: uy + k * SDY, w, h: hh, spouse: true, layer: k, of: id, div: f.dv });
        famPt[f.id] = { x: ux + k * SDX + w, y: uy + hh + (k - 0.5) * SDY };
      });
      // a relationship without a spouse card: from the top of the person card, above the tucked-in spouses
      for (const f of fams) if (!famPt[f.id]) famPt[f.id] = { x: ux + w, y: n ? uy + SDY / 2 : uy + hh / 2 };
      return famPt;
    },
  };
  const SG = spGap();
  return {
    unitW: w, unitH: hh * (1 + n) + n * SG, off: 0,
    place(ux, uy, nodes, links) {
      const famPt = {}, cx = ux + w / 2;
      sps.forEach((f, i) => {
        const k = i + 1, sy = uy + k * (hh + SG);
        nodes.push({ id: spouseIn(f, id), x: ux, y: sy, w, h: hh, sp: true, of: id, div: f.dv });
        links.push({ d: `M${cx},${sy - SG}V${sy}`, kind: f.dv ? 'div' : 'marr' });
        famPt[f.id] = { x: cx, y: sy - SG / 2 };
      });
      for (const f of fams) if (!famPt[f.id]) famPt[f.id] = { x: ux + w, y: uy + hh / 2 };
      return famPt;
    },
  };
}

export function layoutDescendants(rootId, o, { withRootSpouses = true } = {}) {
  const { w, h: hh } = boxSize(o);
  const G = o.down, kgap = 26, vgap = 64;
  // o.viewDown (home page): the generations below it are only reachable by dragging; they are packed
  // under their parents without widening the generations above, so the first view keeps its proportions
  const C = o.viewDown != null ? Math.min(G, o.viewDown) : G;
  const nodes = [], links = [];
  const guard = new Set();
  const mode = spouseMode(o);
  let maxSp = o._minSp || 0;
  const unitFor = (id, d) => {
    const showSp = mode !== 'none' && (d > 0 || withRootSpouses);
    const fams0 = famsOf(id);
    const sps = showSp ? fams0.filter(f => spouseIn(f, id)) : [];
    // children of a relationship with no spouse card go first (leftmost): their line leaves on the far left
    const fams = sps.length ? [...fams0.filter(f => !sps.includes(f)), ...sps] : fams0;
    maxSp = Math.max(maxSp, sps.length);
    return { id, d, fams, sps, u: spouseUnitV(id, fams, sps, mode, w, hh) };
  };
  const measure = (id, d) => {
    const m = unitFor(id, d);
    const kids = [];
    if (d < C && !guard.has(id)) {
      guard.add(id);
      for (const f of m.fams) for (const c of f.c) kids.push({ fam: f.id, m: measure(c, d + 1) });
    }
    const kidsW = kids.reduce((s, k) => s + k.m.width, 0) + Math.max(0, kids.length - 1) * kgap;
    return { ...m, unitW: m.u.unitW, kids, kidsW, width: Math.max(m.u.unitW, kidsW) };
  };
  const m0 = measure(rootId, 0);
  // the deeper generations count for the row height too
  if (C < G) {
    const seen = new Set();
    const walk = (id, d) => { if (d > G || seen.has(id)) return; seen.add(id); unitFor(id, d); if (d < G) for (const f of famsOf(id)) for (const c of f.c) walk(c, d + 1); };
    walk(rootId, 0);
  }
  const rowStep = hh + (mode === 'beside' ? 0 : maxSp * SDY) + vgap;
  const famLinks = (byFam, famPt, ux, top, ky) => {
    const famIds = Object.keys(byFam);
    famIds.forEach(fid => {
      const xs = byFam[fid];
      const ex = famPt[fid] || famExit(ux, top, w, hh, 0, 0);
      // separate bus heights when a person has children with several spouses
      const bus = ky - vgap / 2 + (famIds.length > 1 ? (ex.lvl || 0) * 8 : 0);
      const lo = Math.min(ex.x, ...xs), hi = Math.max(ex.x, ...xs);
      let d = `${ex.head}V${bus}M${lo},${bus}H${hi}`;
      for (const x of xs) d += `M${x},${bus}V${ky}`;
      links.push({ d });
    });
  };
  const frontier = [];   // the units of the last laid-out generation, left to right (for the deeper ones)
  const placeT = (m, left, top) => {
    const ux = left + (m.width - m.unitW) / 2;
    nodes.push({ id: m.id, x: ux + m.u.off, y: top, w, h: hh, root: m.d === 0, main: true, gen: -m.d });
    // where each family's line to its children starts: bottom of that spouse's strip (or of the person)
    const n0 = nodes.length;
    const famPt = m.u.place(ux, top, nodes, links);
    for (let i = n0; i < nodes.length; i++) nodes[i].gen = -m.d;
    if (m.d === C) frontier.push({ m, famPt, ux, top });
    let kx = left + (m.width - m.kidsW) / 2;
    const ky = top + rowStep;
    const byFam = {};
    for (const k of m.kids) {
      placeT(k.m, kx, ky);
      (byFam[k.fam] ||= []).push(kx + (k.m.width - k.m.unitW) / 2 + k.m.u.off + w / 2);
      kx += k.m.width + kgap;
    }
    famLinks(byFam, famPt, ux + m.u.off, top, ky);
  };
  placeT(m0, 0, 0);
  // deeper generations, row by row: each family's children as a group, as close under the parents as the
  // neighbours allow; then the whole row is shifted so it is balanced around the parents
  let row = frontier;
  for (let d = C + 1; d <= G && row.length; d++) {
    const top = row[0].top + rowStep;
    const groups = [];
    for (const r of row) {
      if (guard.has(r.m.id)) continue;
      guard.add(r.m.id);
      for (const f of r.m.fams) {
        const kids = f.c.map(c => unitFor(c, d));
        if (!kids.length) continue;
        const gw = kids.reduce((s, k) => s + k.u.unitW, 0) + (kids.length - 1) * kgap;
        const ex = r.famPt[f.id] || famExit(r.ux + r.m.u.off, r.top, w, hh, 0, 0);
        groups.push({ r, f, kids, gw, ideal: ex.x - gw / 2 });
      }
    }
    if (!groups.length) break;
    let end = -Infinity;
    for (const g of groups) { g.x = Math.max(g.ideal, end + kgap * 2); end = g.x + g.gw; }
    const shift = groups.reduce((s, g) => s + (g.ideal - g.x), 0) / groups.length;
    const next = [];
    for (const g of groups) {
      let x = g.x + shift;
      const xs = [];
      for (const k of g.kids) {
        nodes.push({ id: k.id, x: x + k.u.off, y: top, w, h: hh, main: true, gen: -d });
        const n0 = nodes.length;
        const famPt = k.u.place(x, top, nodes, links);
        for (let i = n0; i < nodes.length; i++) nodes[i].gen = -d;
        next.push({ m: k, famPt, ux: x, top });
        xs.push(x + k.u.off + w / 2);
        x += k.u.unitW + kgap;
      }
      famLinks({ [g.f.id]: xs }, g.r.famPt, g.r.ux + g.r.m.u.off, g.r.top, top);
    }
    row = next;
  }
  return { nodes, links, maxSp };
}

/**
 * Descendants with the generations left → right: siblings stacked downwards, each family's line leaving
 * the right end of that spouse's strip (or the person card) to a vertical bus in front of the children.
 * Lines are drawn above the cards here (linksOnTop), so a line visibly starts from its own strip.
 */
export function layoutDescendantsH(rootId, o, { withRootSpouses = true } = {}) {
  const { w, h: hh } = boxSize(o);
  const G = o.down, kgap = 14, hgap = 72;
  const nodes = [], links = [];
  const guard = new Set();
  let maxSp = 0;
  const mode = spouseMode(o);
  maxSp = o._minSp || 0;
  const measure = (id, d) => {
    const showSp = mode !== 'none' && (d > 0 || withRootSpouses);
    const fams0 = famsOf(id);
    const sps = showSp ? fams0.filter(f => spouseIn(f, id)) : [];
    const fams = sps.length ? [...fams0.filter(f => !sps.includes(f)), ...sps] : fams0;
    maxSp = Math.max(maxSp, sps.length);
    const u = spouseUnitH(id, fams, sps, mode, w, hh);
    const unitH = u.unitH;
    const kids = [];
    if (d < G && !guard.has(id)) {
      guard.add(id);
      for (const f of fams) for (const c of f.c) kids.push({ fam: f.id, m: measure(c, d + 1) });
    }
    const kidsH = kids.reduce((s, k) => s + k.m.height, 0) + Math.max(0, kids.length - 1) * kgap;
    return { id, d, fams, sps, u, unitH, kids, kidsH, height: Math.max(unitH, kidsH) };
  };
  const m0 = measure(rootId, 0);
  const colStep = w + (mode === 'beside' ? 0 : maxSp * SDX) + hgap;
  const placeT = (m, left, top) => {
    const ux = left, uy = top + (m.height - m.unitH) / 2;
    nodes.push({ id: m.id, x: ux, y: uy, w, h: hh, root: m.d === 0, main: true, gen: -m.d });
    const n0 = nodes.length;
    const famPt = m.u.place(ux, uy, nodes, links);
    for (let i = n0; i < nodes.length; i++) nodes[i].gen = -m.d;
    const kx = left + colStep;
    let ky = top + (m.height - m.kidsH) / 2;
    const byFam = {};
    for (const k of m.kids) {
      placeT(k.m, kx, ky);
      (byFam[k.fam] ||= []).push(ky + (k.m.height - k.m.unitH) / 2 + hh / 2);
      ky += k.m.height + kgap;
    }
    const famIds = Object.keys(byFam), nf = famIds.length;
    famIds.forEach((fid, fi) => {
      const ys = byFam[fid], ex = famPt[fid];
      // one bus per relationship; the lower ones a little further left, so the lines never cross
      const bus = kx - hgap / 2 + ((nf - 1) / 2 - fi) * 9;
      let d = `M${ex.x},${ex.y}H${bus}M${bus},${Math.min(ex.y, ...ys)}V${Math.max(ex.y, ...ys)}`;
      for (const y of ys) d += `M${bus},${y}H${kx}`;
      links.push({ d });
    });
  };
  placeT(m0, 0, 0);
  return { nodes, links, linksOnTop: true, maxSp };
}

/**
 * Ancestors above (or to the left), descendants below (right). The middle row – otherwise only the centre
 * person – also holds the siblings in birth order, each with their spouses (o.sibs !== false), hung on the
 * line from the parents. So two brothers who married two sisters show up side by side.
 */
export function layoutHourglass(rootId, o, orient = 'v') {
  SP_RIGHT = !!o.spTree && spouseMode(o) !== 'none';
  try { return hourglass(rootId, o, orient); } finally { SP_RIGHT = false; }
}
/**
 * o.spTree ("Házastárs fája is"): the spouse's family too – their parents and further ancestors above them,
 * their siblings beside them in the middle row. Then the centre person's siblings all go to the left and
 * the spouse's family to the right, so the two families' lines never cross.
 */
function hourglass(rootId, o, orient) {
  const horiz = orient === 'h';
  const { w, h: hh } = boxSize(o);
  const mode = spouseMode(o);
  const spT = SP_RIGHT;
  const unitOf = id => {
    const fams0 = famsOf(id);
    const sps = mode === 'none' ? [] : fams0.filter(f => spouseIn(f, id));
    return { id, fams: fams0, sps };
  };
  const sibsOf = id => { const bf = (P(id)?.fc || []).map(F).find(Boolean); return bf ? bf.c.filter(c => P(c)) : []; };
  // the siblings (and their spouses) of the middle row
  const sibs = o.sibs === false ? [] : sibsOf(rootId);
  const sibUnits = sibs.filter(c => c !== rootId).map(unitOf);
  // the spouses' siblings (spTree)
  const rootSps = mode === 'none' ? [] : famsOf(rootId).map(f => spouseIn(f, rootId)).filter(Boolean);
  const spSibs = spT && o.sibs !== false ? rootSps.map(sp => sibsOf(sp).filter(c => c !== sp && c !== rootId).map(unitOf)) : rootSps.map(() => []);
  const minSp = Math.max(0, ...sibUnits.map(u => u.sps.length), ...spSibs.flat().map(u => u.sps.length));
  const o2 = { ...o, _minSp: minSp };
  const down = horiz ? layoutDescendantsH(rootId, o2) : layoutDescendants(rootId, o2);
  const up = horiz ? layoutAncestors(rootId, o, false, -1) : layoutAncestors(rootId, o, true);
  const rd = down.nodes.find(n => n.root), ru = up.nodes.find(n => n.root);
  const dx = rd.x - ru.x, dy = rd.y - ru.y;
  const shift = d => d.replace(/([MLHV])([-\d.]+)(?:,([-\d.]+))?/g, (m, c, a, b) => c === 'H' ? `H${+a + dx}` : c === 'V' ? `V${+a + dy}` : `${c}${+a + dx},${+b + dy}`);
  const nodes = down.nodes.concat(up.nodes.filter(n => !n.root).map(n => ({ ...n, x: n.x + dx, y: n.y + dy })));
  const links = down.links.concat(up.links.map(l => ({ ...l, d: shift(l.d) })));
  const gap = Math.round(26 * K);
  const ru0 = unitOf(rootId);
  const U = id => { const u = unitOf(id); return horiz ? spouseUnitH(id, u.fams, u.sps, mode, w, hh) : spouseUnitV(id, u.fams, u.sps, mode, w, hh); };
  const rU = U(rootId);
  // a sibling unit at `pos` (left edge, or top edge when horizontal); returns its connection point on the cross axis
  const put = (id, pos) => {
    const V = U(id);
    const x = horiz ? rd.x : pos, y = horiz ? pos : rd.y;
    nodes.push({ id, x: x + V.off, y, w, h: hh, main: true, sib: true, gen: 0 });
    const n0 = nodes.length;
    V.place(x, y, nodes, links);
    for (let i = n0; i < nodes.length; i++) nodes[i].gen = 0;
    return horiz ? y + hh / 2 : x + V.off + w / 2;
  };
  const len = id => (horiz ? U(id).unitH : U(id).unitW);
  const rootStart = horiz ? rd.y : rd.x - rU.off, rootEnd = rootStart + (horiz ? rU.unitH : rU.unitW);
  if (sibUnits.length) {
    const ri = sibs.indexOf(rootId);
    // with the spouse's family on the right, all of the centre person's siblings are on the left
    const before = spT ? sibs.filter(c => c !== rootId) : sibs.slice(0, Math.max(0, ri));
    const after = spT ? [] : sibs.slice(ri + 1);
    const pts = [];
    let pos = rootStart - gap;
    for (const id of before.slice().reverse()) { pos -= len(id); pts.push(put(id, pos)); pos -= gap; }
    pos = rootEnd + gap;
    for (const id of after) { pts.push(put(id, pos)); pos += len(id) + gap; }
    // the parents' line to the children: a bus just before the middle row (the root's own line is already there)
    const rc = horiz ? rd.y + hh / 2 : rd.x + w / 2;
    const all = pts.concat(rc);
    const noPar = !up.nodes.some(n => !n.root);
    if (!horiz) {
      const bus = rd.y - 29;
      let d = `M${Math.min(...all)},${bus}H${Math.max(...all)}`;
      for (const t of pts) d += `M${t},${bus}V${rd.y}`;
      if (noPar) d += `M${rc},${bus}V${rd.y}`;   // no parents drawn: still one family
      links.push({ d });
    } else {
      const bus = rd.x - 23;
      let d = `M${bus},${Math.min(...all)}V${Math.max(...all)}`;
      for (const t of pts) d += `M${bus},${t}H${rd.x}`;
      if (noPar) d += `M${bus},${rc}H${rd.x}`;
      links.push({ d });
    }
  }
  // the spouses' families (spTree)
  if (spT) {
    const spNodes = nodes.filter(n => n.of === rootId && (n.spouse || n.sp));
    let pos = Math.max(rootEnd, ...nodes.filter(n => n.gen === 0).map(n => horiz ? n.y + n.h : n.x + n.w)) + gap;
    spNodes.forEach((sn, k) => {
      const behind = !!sn.spouse;
      // where the spouse's line starts: the visible part of their card
      const ax = horiz ? sn.x : behind ? sn.x + w - SDX / 2 : sn.x + w / 2;
      const ay = horiz ? (behind ? sn.y + hh - SDY / 2 : sn.y + hh / 2) : sn.y;
      // their siblings after everything already in the middle row
      const pts = [];
      for (const u of spSibs[k] || []) { pts.push(put(u.id, pos)); pos += len(u.id) + gap; }
      // their ancestors: same generation rows, centred on the family, pushed aside where they would overlap
      let par = [];
      if (o.up > 0) {
        const t = horiz ? layoutAncestors(sn.id, o, false, -1, { noRootLinks: true }) : layoutAncestors(sn.id, o, true, 1, { noRootLinks: true });
        const tr = t.nodes.find(n => n.root), tn = t.nodes.filter(n => !n.root);
        if (tn.length) {
          const a0 = horiz ? ay : ax, mid = pts.length ? (a0 + pts[pts.length - 1]) / 2 : a0;
          let ox = horiz ? rd.x - tr.x : mid - w / 2 - tr.x, oy = horiz ? mid - hh / 2 - tr.y : rd.y - tr.y;
          const hi = {};
          for (const n of nodes) if (n.gen > 0) hi[n.gen] = Math.max(hi[n.gen] ?? -Infinity, horiz ? n.y + n.h : n.x + n.w);
          let need = -Infinity;
          for (const n of tn) if (hi[n.gen] != null) need = Math.max(need, hi[n.gen] + 24 - (horiz ? n.y + oy : n.x + ox));
          if (need > 0) { if (horiz) oy += need; else ox += need; }
          const sh = d => d.replace(/([MLHV])([-\d.]+)(?:,([-\d.]+))?/g, (m, c, a, b) => c === 'H' ? `H${+a + ox}` : c === 'V' ? `V${+a + oy}` : `${c}${+a + ox},${+b + oy}`);
          const placed = tn.map(n => ({ ...n, x: n.x + ox, y: n.y + oy, spTree: sn.id }));
          nodes.push(...placed);
          links.push(...t.links.map(l => ({ ...l, d: sh(l.d) })));
          par = placed.filter(n => n.gen === 1);
        }
      }
      if (!pts.length && !par.length) return;
      // the spouse's family line: a low bus along the middle row (spouse + siblings), and from it one line up,
      // beyond the centre person's parents' lines, to a second bus joining the spouse's parents
      const b1 = 12 + k * 5, b2 = 44 - k * 6;
      if (!horiz) {
        const y1 = rd.y - b1, y2 = rd.y - b2;
        const pc = par.map(p => p.x + w / 2), xu = pc.length ? (Math.min(...pc) + Math.max(...pc)) / 2 : null;
        const xs = [ax, ...pts, ...(xu != null ? [xu] : [])];
        let d = `M${ax},${ay}V${y1}M${Math.min(...xs)},${y1}H${Math.max(...xs)}`;
        for (const t of pts) d += `M${t},${y1}V${rd.y}`;
        if (xu != null) {
          d += `M${xu},${y1}V${y2}M${Math.min(...pc)},${y2}H${Math.max(...pc)}`;
          for (const p of par) d += `M${p.x + w / 2},${y2}V${p.y + hh}`;
        }
        links.push({ d });
      } else {
        const x1 = rd.x - b1 + 2, x2 = rd.x - (b2 - 8);
        const pc = par.map(p => p.y + hh / 2), yu = pc.length ? (Math.min(...pc) + Math.max(...pc)) / 2 : null;
        const ys = [ay, ...pts, ...(yu != null ? [yu] : [])];
        let d = `M${ax},${ay}H${x1}M${x1},${Math.min(...ys)}V${Math.max(...ys)}`;
        for (const t of pts) d += `M${x1},${t}H${rd.x}`;
        if (yu != null) {
          d += `M${x1},${yu}H${x2}M${x2},${Math.min(...pc)}V${Math.max(...pc)}`;
          for (const p of par) d += `M${x2},${p.y + hh / 2}H${p.x + w}`;
        }
        links.push({ d });
      }
    });
  }
  return { nodes, links, linksOnTop: down.linksOnTop };
}

/**
 * The Családfa as a general family graph: the centre person's hourglass (ancestors, siblings, spouses,
 * descendants, the spouses' families) plus the trees of every person "opened" on the chart (o.open: their
 * ancestors, siblings, spouses and descendants). Everyone appears once, in their generation's row.
 *
 * Rows hold units (a person with their spouses). The order inside a row and the positions come from a few
 * sweeps: each unit wants to sit under its parents (top-down) and over its children (bottom-up), siblings in
 * birth order; overlaps are resolved by merging blocks around their average wish (least squares), so a family
 * stays as close to its parents as its neighbours allow. Lines: a bus per family between the rows, with
 * separate heights where buses would overlap.
 */
export function layoutGraph(rootId, o, orient = 'v') {
  const horiz = orient === 'h';
  const { w, h: hh } = boxSize(o);
  const mode = spouseMode(o);
  const UP = Math.max(0, o.up ?? 2), DN = Math.max(0, o.down ?? 2);
  // ---- who is on the chart, and in which row (0 = the centre person's generation, +1 = their children)
  const row = new Map();
  const add = (id, r) => { if (id && P(id) && !row.has(id)) row.set(id, r); return row.has(id); };
  const spousesOf = id => famsOf(id).map(f => spouseIn(f, id)).filter(Boolean);
  const sibsOf = id => { const bf = (P(id)?.fc || []).map(F).find(Boolean); return bf ? bf.c.filter(c => P(c)) : []; };
  const ancestors = (id, r, n) => { if (n <= 0) return; for (const p of parentsOf(id)) { add(p, r - 1); ancestors(p, r - 1, n - 1); } };
  const descendants = (id, r, n) => {
    if (mode !== 'none') for (const sp of spousesOf(id)) add(sp, r);
    if (n <= 0) return;
    for (const f of famsOf(id)) for (const c of f.c) { add(c, r + 1); descendants(c, r + 1, n - 1); }
  };
  const siblings = id => { const r = row.get(id); for (const c of sibsOf(id)) { add(c, r); if (mode !== 'none') for (const sp of spousesOf(c)) add(sp, r); } };
  add(rootId, 0);
  ancestors(rootId, 0, UP);
  if (o.sibs !== false) siblings(rootId);
  descendants(rootId, 0, DN);
  if (o.spTree && mode !== 'none') for (const sp of spousesOf(rootId)) { ancestors(sp, 0, UP); if (o.sibs !== false) siblings(sp); }
  for (const x of o.open || []) {
    if (!row.has(x)) continue;
    const r = row.get(x);
    ancestors(x, r, Math.max(1, UP)); siblings(x); descendants(x, r, Math.max(1, DN));
  }
  // ---- units: a person (in the order they were reached) with their spouses who are on the chart
  const unitOf = new Map(), units = [];
  for (const [id, r] of row) {
    if (unitOf.has(id)) continue;
    const fams = famsOf(id);
    const sps = mode === 'none' ? [] : fams.filter(f => { const s = spouseIn(f, id); return s && row.get(s) === r && !unitOf.has(s); });
    const u = { id, r, fams, sps, members: [id, ...sps.map(f => spouseIn(f, id))] };
    u.U = horiz ? spouseUnitH(id, fams, sps, mode, w, hh) : spouseUnitV(id, fams, sps, mode, w, hh);
    u.len = horiz ? u.U.unitH : u.U.unitW;
    for (const m of u.members) unitOf.set(m, u);
    units.push(u);
  }
  const rows = new Map();
  for (const u of units) { if (!rows.has(u.r)) rows.set(u.r, []); rows.get(u.r).push(u); }
  const rowKeys = [...rows.keys()].sort((a, b) => a - b);
  // links between units: parents' units (for each member) and children's units
  for (const u of units) {
    u.par = []; u.kids = [];
    for (const m of u.members) for (const pid of parentsOf(m)) { const pu = unitOf.get(pid); if (pu && pu.r === u.r - 1 && !u.par.includes(pu)) u.par.push(pu); }
    // birth order among siblings: the tie-breaker
    const bf = (P(u.id)?.fc || []).map(F).find(Boolean);
    u.bi = bf ? bf.c.indexOf(u.id) : 0;
  }
  for (const u of units) for (const pu of u.par) if (!pu.kids.includes(u)) pu.kids.push(u);
  // ---- order and position
  const kgap = horiz ? 14 : 26;
  const cen = u => u.pos + u.len / 2;
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
  const sameFam = (a, b) => a.par.length && a.par.some(p => b.par.includes(p));
  const pack = list => {   // left to right, no overlaps, each as close to its wish as the others allow
    const blocks = [];
    let i = 0;
    for (const u of list) {
      const g = i ? (sameFam(list[i - 1], u) ? kgap : kgap * 1.8) : 0;
      u.gapBefore = g; i++;
      let b = { us: [u], off: [0], len: u.len, sum: u.want, n: 1 };
      b.pos = b.sum / b.n;
      blocks.push(b);
      while (blocks.length > 1) {
        const a = blocks[blocks.length - 2], c = blocks[blocks.length - 1];
        const gap = c.us[0].gapBefore;
        if (a.pos + a.len + gap <= c.pos) break;
        const shiftC = a.len + gap;
        c.us.forEach((x, k) => { a.us.push(x); a.off.push(shiftC + c.off[k]); a.sum += x.want - (shiftC + c.off[k]); a.n++; });
        a.len = shiftC + c.len; a.pos = a.sum / a.n;
        blocks.pop();
      }
    }
    for (const b of blocks) b.us.forEach((u, k) => { u.pos = b.pos + b.off[k]; });
  };
  // first placement: rows in reach order, packed
  for (const r of rowKeys) { let x = 0; for (const u of rows.get(r)) { u.want = x; x += u.len + kgap * 2; } pack(rows.get(r)); }
  const sweep = (down, reorder) => {
    const keys = down ? rowKeys : rowKeys.slice().reverse();
    for (const r of keys) {
      const list = rows.get(r);
      for (const u of list) {
        const nb = down ? u.par : u.kids;
        u.want = (nb.length ? avg(nb.map(cen)) : cen(u)) - u.len / 2;
      }
      if (reorder) {
        const idx = new Map(list.map((u, i) => [u, i]));
        list.sort((a, b) => (sameFam(a, b) ? a.bi - b.bi : 0) || (a.want - b.want) || (idx.get(a) - idx.get(b)));
      }
      pack(list);
    }
  };
  for (let i = 0; i < 4; i++) { sweep(true, true); sweep(false, true); }
  sweep(true, false); sweep(false, false); sweep(true, false);
  // ---- place the cards
  const maxSp = mode === 'beside' ? 0 : Math.max(0, ...units.map(u => u.sps.length));
  const step = horiz ? w + maxSp * SDX + 72 : hh + maxSp * SDY + 64;
  const gapMain = horiz ? 72 : 64;
  const nodes = [], links = [], famPt = new Map(), cardOf = new Map();
  const r0 = rowKeys[0] ?? 0;
  for (const u of units) {
    const main = (u.r - r0) * step;
    const x = horiz ? main : u.pos, y = horiz ? u.pos : main;
    const nx = horiz ? x : x + u.U.off;
    nodes.push({ id: u.id, x: nx, y, w, h: hh, main: true, root: u.id === rootId, gen: -u.r, open: (o.open || []).includes(u.id) });
    const n0 = nodes.length;
    const fp = u.U.place(x, y, nodes, links);
    for (let i = n0; i < nodes.length; i++) { nodes[i].gen = -u.r; nodes[i].open = (o.open || []).includes(nodes[i].id); }
    for (const [fid, pt] of Object.entries(fp)) famPt.set(+fid, pt);
  }
  for (const n of nodes) cardOf.set(n.id, n);
  // where a child's line ends: top (left) of the card, or the visible strip of a spouse tucked behind
  const endOf = n => horiz
    ? (n.spouse ? { a: n.y + hh - SDY / 2, m: n.x } : { a: n.y + hh / 2, m: n.x })
    : (n.spouse ? { a: n.x + w - SDX / 2, m: n.y } : { a: n.x + w / 2, m: n.y });
  // one bus per family between the rows
  const buses = [];
  const fams = new Set();
  for (const id of row.keys()) for (const f of (P(id)?.fc || []).map(F).filter(Boolean)) fams.add(f);
  for (const f of fams) {
    const kids = f.c.filter(c => cardOf.has(c));
    if (!kids.length) continue;
    const kr = row.get(kids[0]);
    const par = [f.h, f.w].filter(x => x && cardOf.has(x) && row.get(x) === kr - 1);
    if (!par.length) continue;
    let pt = famPt.get(f.id);
    // the family's own exit point exists when its parent is the main card of a unit; else from the parent's card
    if (!pt || !par.some(pid => unitOf.get(pid)?.id === pid)) {
      const pn = cardOf.get(par[0]);
      pt = horiz ? { x: pn.x + w, y: pn.y + hh / 2 } : { head: `M${pn.x + w / 2},${pn.y + hh}`, x: pn.x + w / 2 };
    }
    const ends = kids.filter(c => row.get(c) === kr).map(c => endOf(cardOf.get(c)));
    const childMain = (kr - r0) * step;
    buses.push({ pt, ends, childMain, a0: Math.min(horiz ? pt.y : pt.x, ...ends.map(e => e.a)), a1: Math.max(horiz ? pt.y : pt.x, ...ends.map(e => e.a)) });
  }
  // overlapping buses in the same gap get different heights
  const byRow = new Map();
  for (const b of buses) { if (!byRow.has(b.childMain)) byRow.set(b.childMain, []); byRow.get(b.childMain).push(b); }
  for (const list of byRow.values()) {
    list.sort((a, b) => a.a0 - b.a0);
    const ends = [];
    for (const b of list) { let l = ends.findIndex(e => e < b.a0 - 4); if (l < 0) { l = ends.length; ends.push(0); } ends[l] = b.a1; b.lvl = l; }
    const L = ends.length;
    for (const b of list) {
      const bm = b.childMain - gapMain / 2 + (b.lvl - (L - 1) / 2) * Math.min(14, (gapMain - 20) / Math.max(1, L - 1));
      let d;
      if (!horiz) {
        d = `${b.pt.head}V${bm}M${b.a0},${bm}H${b.a1}`;
        for (const e of b.ends) d += `M${e.a},${bm}V${e.m}`;
      } else {
        d = `M${b.pt.x},${b.pt.y}H${bm}M${bm},${b.a0}V${b.a1}`;
        for (const e of b.ends) d += `M${bm},${e.a}H${e.m}`;
      }
      links.push({ d });
    }
  }
  return { nodes, links, linksOnTop: horiz };
}

export function layoutFamily(rootId, o) {
  const { w, h: hh } = boxSize(o);
  const nodes = [], links = [];
  const gap = 22, vgap = 70;
  const bf = P(rootId)?.fc?.length ? F(P(rootId).fc[0]) : null;
  const sibs = bf ? bf.c.slice() : [rootId];
  if (!sibs.includes(rootId)) sibs.push(rootId);
  const fams0 = famsOf(rootId);
  const mode = spouseMode(o);
  const sps = mode === 'none' ? [] : fams0.filter(f => spouseIn(f, rootId));
  const fams = sps.length ? [...fams0.filter(f => !sps.includes(f)), ...sps] : fams0;
  const RU = spouseUnitV(rootId, fams, sps, mode, w, hh);
  let famPt = {}, rootLeft = 0;
  // middle row: siblings in birth order; the root's spouses slide in behind the root card
  const y1 = hh + vgap;
  let x = 0;
  const sibX = {};
  for (const s of sibs) {
    if (s === rootId) {
      sibX[s] = x + RU.off; rootLeft = x;
      nodes.push({ id: s, x: x + RU.off, y: y1, w, h: hh, root: true, main: true });
      famPt = RU.place(x, y1, nodes, links);
      x += RU.unitW + gap;
      continue;
    }
    sibX[s] = x;
    nodes.push({ id: s, x, y: y1, w, h: hh, main: true });
    x += w + gap;
  }
  const rowW = x - gap;
  if (bf) {
    const parents = [bf.h, bf.w].filter(Boolean);
    const pw = parents.length * w + (parents.length - 1) * gap;
    const px0 = rowW / 2 - pw / 2;
    parents.forEach((id, i) => nodes.push({ id, x: px0 + i * (w + gap), y: 0, w, h: hh, main: true }));
    const cx = rowW / 2, bus = y1 - vgap / 2;
    let d = parents.length === 2 ? `M${px0 + w},${hh / 2}H${px0 + w + gap}M${cx},${hh / 2}V${bus}` : `M${cx},${hh}V${bus}`;
    const xs = sibs.map(s => sibX[s] + w / 2);
    d += `M${Math.min(cx, ...xs)},${bus}H${Math.max(cx, ...xs)}`;
    for (const xx of xs) d += `M${xx},${bus}V${y1}`;
    links.push({ d, kind: parents.length === 2 ? null : null });
    if (parents.length === 2) links.push({ d: `M${px0 + w},${hh / 2}H${px0 + w + gap}`, kind: 'marr' });
  }
  // the root's children below, each family's line starting from that spouse's strip
  const y2 = y1 + (mode === 'beside' ? hh : RU.unitH) + vgap;
  const kidsAll = [];
  for (const f of fams) for (const c of f.c) kidsAll.push({ c, f });
  const kw = kidsAll.length * w + Math.max(0, kidsAll.length - 1) * gap;
  const kx0 = rootLeft + RU.unitW / 2 - kw / 2;
  kidsAll.forEach((k, i) => nodes.push({ id: k.c, x: kx0 + i * (w + gap), y: y2, w, h: hh, main: true }));
  fams.forEach((f, fi) => {
    const ex = famPt[f.id];
    const xs = kidsAll.map((k, i) => k.f === f ? kx0 + i * (w + gap) + w / 2 : null).filter(v => v !== null);
    if (!xs.length) return;
    const bus = y2 - vgap / 2 + (fams.length > 1 ? (ex.lvl || 0) * 8 : 0);
    let d = `${ex.head}V${bus}M${Math.min(ex.x, ...xs)},${bus}H${Math.max(ex.x, ...xs)}`;
    for (const xx of xs) d += `M${xx},${bus}V${y2}`;
    links.push({ d });
  });
  return { nodes, links };
}

// ------------------------------------------------------------- relationship path
/**
 * Every shortest connection between two people (at most `max`), e.g. Baum Viktória → Csurgay Árpád both through
 * her sister (his wife) and through her husband (his brother). Going up to a couple and down again through the
 * father or through the mother is the same connection, so those count once.
 */
export function findPaths(a, b, max = 4) {
  a = +a; b = +b;
  if (a === b) return [[{ id: a }]];
  const nb = id => {
    const out = [];
    const p = P(id); if (!p) return out;
    for (const fid of p.fc || []) { const f = F(fid); if (f?.h) out.push([f.h, 'up', fid]); if (f?.w) out.push([f.w, 'up', fid]); }
    for (const fid of p.fs || []) { const f = F(fid); if (!f) continue; const sp = spouseIn(f, id); if (sp) out.push([sp, 'sp', fid]); for (const c of f.c) out.push([c, 'down', fid]); }
    return out;
  };
  // breadth-first distances from a, remembering every predecessor on a shortest route
  const dist = new Map([[a, 0]]), pred = new Map();
  let frontier = [a], found = false;
  while (frontier.length && !found) {
    const next = [];
    for (const id of frontier) for (const [n, how, fid] of nb(id)) {
      const d = dist.get(id) + 1;
      if (!dist.has(n)) { dist.set(n, d); next.push(n); }
      if (dist.get(n) === d) { if (!pred.has(n)) pred.set(n, []); pred.get(n).push({ from: id, how, fid }); }
      if (n === b) found = true;
    }
    frontier = next;
  }
  if (!found) return [];
  const out = [], seen = new Set();
  let budget = 2000;                                // big trees: never enumerate forever
  const walk = (id, tail) => {
    if (out.length >= max * 3 || --budget < 0) return;
    if (id === a) {
      const path = [{ id: a, how: null }, ...tail];
      // one key per connection: a pivot (up, then down) through either parent of the same family is the same
      const key = path.map((s, i) => {
        const nx = path[i + 1];
        return s.how === 'up' && nx?.how === 'down' ? 'F' + nx.fid : s.id + (s.how || '');
      }).join('>');
      if (!seen.has(key)) { seen.add(key); out.push(path.map(({ id, how }) => ({ id, how }))); }
      return;
    }
    for (const pr of pred.get(id) || []) walk(pr.from, [{ id, how: pr.how, fid: pr.fid }, ...tail]);
  };
  walk(b, []);
  // the father's side first, like the single-path version did
  return out.slice(0, max);
}
export function findPath(a, b) { const ps = findPaths(a, b, 1); return ps.length ? ps[0] : null; }
const STEPS = {
  hu: { up: { M: 'apja', F: 'anyja', U: 'szülője' }, down: { M: 'fia', F: 'lánya', U: 'gyermeke' }, sp: { M: 'férje', F: 'felesége', U: 'házastársa' } },
  en: { up: { M: 'father', F: 'mother', U: 'parent' }, down: { M: 'son', F: 'daughter', U: 'child' }, sp: { M: 'husband', F: 'wife', U: 'spouse' } },
  de: { up: { M: 'Vater', F: 'Mutter', U: 'Elternteil' }, down: { M: 'Sohn', F: 'Tochter', U: 'Kind' }, sp: { M: 'Ehemann', F: 'Ehefrau', U: 'Ehepartner' } },
};
const stepWord = (how, sx, lang = S.lang) => (STEPS[lang] || STEPS.hu)[how][sx || 'U'];

/** Kinship term for a blood path: `a` steps up then `b` steps down; sx = sex of the target. Hungarian: possessive form. */
export function kinTerm(a, b, sx, lang = S.lang) {
  if (lang === 'en') return kinTermEn(a, b, sx);
  if (lang === 'de') return kinTermDe(a, b, sx);
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
function kinTermEn(a, b, sx) {
  const pick = (m, f, u) => sx === 'M' ? m : sx === 'F' ? f : u;
  const greats = n => n <= 0 ? '' : n === 1 ? 'great-' : n === 2 ? 'great-great-' : `${n}× great-`;
  if (b === 0) return a === 1 ? pick('father', 'mother', 'parent') : greats(a - 2) + pick('grandfather', 'grandmother', 'grandparent');
  if (a === 0) return b === 1 ? pick('son', 'daughter', 'child') : greats(b - 2) + pick('grandson', 'granddaughter', 'grandchild');
  if (a === 1 && b === 1) return pick('brother', 'sister', 'sibling');
  if (b === 1) return greats(a - 2) + pick('uncle', 'aunt', 'uncle or aunt');
  if (a === 1) return greats(b - 2) + pick('nephew', 'niece', 'nephew or niece');
  const c = Math.min(a, b) - 1, r = Math.abs(a - b);
  const ord = ['', 'first', 'second', 'third', 'fourth', 'fifth'][c] || c + 'th';
  const rem = r === 0 ? '' : r === 1 ? ' once removed' : r === 2 ? ' twice removed' : ` ${r} times removed`;
  return `${ord} cousin${rem}`;
}
function kinTermDe(a, b, sx) {
  const pick = (m, f, u) => sx === 'M' ? m : sx === 'F' ? f : u;
  const ur = n => 'Ur'.repeat(Math.max(0, n)).replace(/^Ur(Ur)+/, m => 'Ur' + m.slice(2).toLowerCase());
  if (b === 0) return a === 1 ? pick('Vater', 'Mutter', 'Elternteil') : (a === 2 ? '' : ur(a - 2)) + (a === 2 ? pick('Großvater', 'Großmutter', 'Großelternteil') : pick('großvater', 'großmutter', 'großelternteil'));
  if (a === 0) return b === 1 ? pick('Sohn', 'Tochter', 'Kind') : (b === 2 ? pick('Enkel', 'Enkelin', 'Enkelkind') : ur(b - 2) + pick('enkel', 'enkelin', 'enkelkind'));
  if (a === 1 && b === 1) return pick('Bruder', 'Schwester', 'Geschwister');
  if (b === 1) return a === 2 ? pick('Onkel', 'Tante', 'Onkel oder Tante') : (a === 3 ? pick('Großonkel', 'Großtante', 'Großonkel oder Großtante') : `${pick('Großonkel', 'Großtante', 'Großonkel/-tante')} (${a - 3}. Grades)`);
  if (a === 1) return b === 2 ? pick('Neffe', 'Nichte', 'Neffe oder Nichte') : (b === 3 ? pick('Großneffe', 'Großnichte', 'Großneffe oder Großnichte') : `${pick('Großneffe', 'Großnichte', 'Großneffe/-nichte')} (${b - 3}. Grades)`);
  const c = Math.min(a, b) - 1, r = Math.abs(a - b);
  return `${pick('Cousin', 'Cousine', 'Cousin/Cousine')} ${c}. Grades${r ? ` (${r} Generation${r > 1 ? 'en' : ''} Unterschied)` : ''}`;
}
/**
 * A path with marriages in it, told with kinship words: blood stretches (ups, then downs) become one word, marriages
 * stay "férje / felesége". Common in-laws get their own name (sógor, após, vő…). Null if the path does not split cleanly.
 */
function inLaw(path, lang) {
  const segs = []; let cur = [];
  for (let i = 1; i < path.length; i++) {
    const st = path[i];
    if (st.how === 'sp') { if (cur.length) segs.push({ blood: cur }); segs.push({ sp: st }); cur = []; }
    else cur.push(st);
  }
  if (cur.length) segs.push({ blood: cur });
  if (segs.filter(x => x.sp).length > 2) return null;
  const parts = [], shape = [];
  for (const sg of segs) {
    if (sg.sp) { parts.push(stepWord('sp', P(sg.sp.id)?.sx, lang)); shape.push('sp'); continue; }
    let a = 0, b = 0;
    for (const st of sg.blood) { if (st.how === 'up') { if (b) return null; a++; } else b++; }
    const last = P(sg.blood[sg.blood.length - 1].id);
    parts.push(kinTerm(a, b, last?.sx, lang)); shape.push(a + ':' + b);
  }
  const sx = P(path[path.length - 1].id)?.sx;
  const pick = (m, f, u) => sx === 'M' ? m : sx === 'F' ? f : u;
  const key = shape.join(' ');
  const names = {
    hu: { '1:1 sp': pick('sógora', 'sógornője', 'sógora vagy sógornője'), 'sp 1:1': pick('sógora', 'sógornője', 'sógora vagy sógornője'),
      'sp 1:0': pick('apósa', 'anyósa', 'apósa vagy anyósa'), '0:1 sp': pick('veje', 'menye', 'veje vagy menye') },
    en: { '1:1 sp': pick('brother-in-law', 'sister-in-law', 'sibling-in-law'), 'sp 1:1': pick('brother-in-law', 'sister-in-law', 'sibling-in-law'),
      'sp 1:0': pick('father-in-law', 'mother-in-law', 'parent-in-law'), '0:1 sp': pick('son-in-law', 'daughter-in-law', 'child-in-law') },
    de: { '1:1 sp': pick('Schwager', 'Schwägerin', 'Schwager oder Schwägerin'), 'sp 1:1': pick('Schwager', 'Schwägerin', 'Schwager oder Schwägerin'),
      'sp 1:0': pick('Schwiegervater', 'Schwiegermutter', 'Schwiegerelternteil'), '0:1 sp': pick('Schwiegersohn', 'Schwiegertochter', 'Schwiegerkind') },
  }[lang] || {};
  const chain = lang === 'en' ? parts.join("'s ") : lang === 'de' ? parts.slice().reverse().join(' von ') : parts.join(' ');
  return { name: names[key] || null, chain };
}
export function relationLabel(path, lang = S.lang) {
  const L = {
    hu: { none: 'A családfában nincs kimutatható kapcsolat kettejük között.', same: 'Ugyanazt a személyt választottad.' },
    en: { none: 'There is no traceable relationship between them in the family tree.', same: 'You picked the same person twice.' },
    de: { none: 'Im Stammbaum ist keine Verwandtschaft zwischen den beiden zu finden.', same: 'Du hast zweimal dieselbe Person gewählt.' },
  }[lang] || {};
  if (!path) return L.none;
  if (path.length === 1) return L.same;
  const steps = path.slice(1).map(s => s.how);
  const from = P(path[0].id), tgt = P(path[path.length - 1].id);
  let a = 0, b = 0, blood = true;
  for (const x of steps) { if (x === 'up') { if (b) blood = false; a++; } else if (x === 'down') b++; else blood = false; }
  const tn = personName(tgt, { withTitle: false }), fn = personName(from, { withTitle: false });
  const chain = path.slice(1).map(s => stepWord(s.how, P(s.id)?.sx, lang)).join(' → ');
  if (lang === 'en') {
    if (blood) return `${tn} is ${fn}'s ${kinTerm(a, b, tgt?.sx, 'en')}.`;
    if (steps.length === 1) return `${tn} is ${fn}'s ${stepWord('sp', tgt?.sx, 'en')}.`;
    const inl = inLaw(path, 'en');
    if (inl) return `${tn} is ${fn}'s ${inl.name ? inl.name + ' (' + inl.chain + ')' : inl.chain}.`;
    return `${tn} and ${fn} are connected in ${steps.length} steps: ${chain}.`;
  }
  if (lang === 'de') {
    if (blood) return `${tn}: ${kinTerm(a, b, tgt?.sx, 'de')} von ${fn}.`;
    if (steps.length === 1) return `${tn}: ${stepWord('sp', tgt?.sx, 'de')} von ${fn}.`;
    const inl = inLaw(path, 'de');
    if (inl) return `${tn}: ${inl.name ? inl.name + ' (' + inl.chain + ')' : inl.chain} von ${fn}.`;
    return `${tn} und ${fn} sind über ${steps.length} Schritte verbunden: ${chain}.`;
  }
  if (blood) return `${tn} – ${fn} ${kinTerm(a, b, tgt?.sx, 'hu')}.`;
  if (steps.length === 1) return `${tn} – ${fn} ${stepWord('sp', tgt?.sx, 'hu')}.`;
  const inl = inLaw(path, 'hu');
  if (inl) return `${tn} – ${fn} ${inl.name ? inl.name + ' (' + inl.chain + ')' : inl.chain}.`;
  return `${tn} és ${fn} kapcsolata ${steps.length} lépésben: ${chain}.`;
}
export function layoutRelation(a, b, o) {
  const { w, h: hh } = boxSize(o);
  const paths = findPaths(a, b, 4);
  const nodes = [], links = [], extra = [];
  if (!paths.length) return { nodes: [{ id: +a, x: 0, y: 0, w, h: hh, root: true }], links, extra, path: null, paths };
  let laneTop = 0;
  paths.forEach((path, li) => {
    // draw the lane at y = 0, then move it below the previous one
    const ln = [], ll = [], le = [];
    let x = 0, y = 0;
    path.forEach((s, i) => {
      if (i > 0) {
        if (s.how === 'up') { y -= hh + 56; x += w * 0.62; }
        else if (s.how === 'down') { y += hh + 56; x += w * 0.62; }
        else x += w + 60;
      }
      ln.push({ id: s.id, x, y, w, h: hh, root: i === 0 || i === path.length - 1 });
      if (i > 0) {
        const p = ln[i - 1], n = ln[i];
        const lab = stepWord(s.how, P(s.id)?.sx);
        if (s.how === 'sp') { ll.push({ x1: p.x + w, y1: p.y + hh / 2, x2: n.x, y2: p.y + hh / 2, kind: 'marr' }); le.push({ x: (p.x + w + n.x) / 2, y: p.y + hh / 2 - 8, t: lab }); }
        else {
          const up = s.how === 'up';
          const x1 = p.x + w / 2, y1 = up ? p.y : p.y + hh, x2 = n.x + w / 2, y2 = up ? n.y + hh : n.y;
          ll.push({ x1, y1, x2, y2 });
          le.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 7, t: lab });
        }
      }
    });
    const minY = Math.min(...ln.map(n => n.y)), maxY = Math.max(...ln.map(n => n.y + n.h));
    const head = paths.length > 1 ? 34 : 0;                      // room for the lane's own caption
    const dy = laneTop - minY + head;
    for (const n of ln) { n.y += dy; nodes.push(n); }
    for (const l of ll) {
      if (l.kind === 'marr') links.push({ d: `M${l.x1},${l.y1 + dy}H${l.x2}`, kind: 'marr' });
      else { const my = (l.y1 + l.y2) / 2 + dy; links.push({ d: `M${l.x1},${l.y1 + dy}V${my}H${l.x2}V${l.y2 + dy}` }); }
    }
    for (const e of le) extra.push({ ...e, y: e.y + dy });
    if (paths.length > 1) {
      const x1 = Math.max(...ln.map(n => n.x + n.w));
      extra.push({ x: 0, y: laneTop + 18, t: `${li + 1}. ${T('kapcsolat')}: ${relationLabel(path)}`, size: 14, ink: true, anchor: 'start' });
    }
    laneTop = maxY + dy + 70;
  });
  return { nodes, links, extra, path: paths[0], paths };
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

/** At most two given names when three would not fit ("Árpád István Ernő" → "Árpád István"). */
export function fitGiven(given, max) {
  given = String(given || '');
  if (given.length <= max) return given;
  const parts = given.split(/\s+/);
  if (parts.length > 2) { const two = parts.slice(0, 2).join(' '); if (two.length <= max) return two; }
  return clip(given, max);
}

function photoCircle(g, p, cx, cy, r, col, pal, defs, uid, n) {
  if (p.ph) {
    const cid = `c${uid}_${n.id}_${Math.round(n.x)}_${Math.round(n.y)}_${r}`.replace(/[^\w]/g, '_');
    defs.append(sv('clipPath', { id: cid }, sv('circle', { cx, cy, r })));
    const fx = p.fx ?? .5, fy = p.fy ?? .35;
    // emulate object-fit:cover with a focus point on a square crop
    g.append(sv('image', { href: p.ph, x: cx - r, y: cy - r, width: r * 2, height: r * 2, preserveAspectRatio: `x${fx < .34 ? 'Min' : fx > .66 ? 'Max' : 'Mid'}Y${fy < .34 ? 'Min' : fy > .66 ? 'Max' : 'Mid'} slice`, 'clip-path': `url(#${cid})` }));
    g.append(sv('circle', { cx, cy, r, fill: 'none', stroke: col, 'stroke-width': 1.5 }));
  } else {
    g.append(sv('circle', { cx, cy, r, fill: pal.surface2, stroke: pal.line }));
    g.append(sv('text', { x: cx, y: cy + r * 0.3, 'text-anchor': 'middle', 'font-size': Math.round(r * 0.62), 'font-weight': 700, fill: pal.muted, 'font-family': 'Alegreya, Georgia, serif' }, ((p.s || '')[0] || '') + ((p.g || '')[0] || '')));
  }
}

// a rounded-rectangle (ID-photo) portrait, the counterpart of photoCircle
function photoRect(g, p, x, y, w, hh, col, pal, defs, uid, n) {
  const rx = 10;
  if (p.ph) {
    const cid = `r${uid}_${n.id}_${Math.round(n.x)}_${Math.round(n.y)}_${w}`.replace(/[^\w]/g, '_');
    defs.append(sv('clipPath', { id: cid }, sv('rect', { x, y, width: w, height: hh, rx })));
    const fx = p.fx ?? .5, fy = p.fy ?? .35;
    g.append(sv('image', { href: p.ph, x, y, width: w, height: hh, preserveAspectRatio: `x${fx < .34 ? 'Min' : fx > .66 ? 'Max' : 'Mid'}Y${fy < .34 ? 'Min' : fy > .66 ? 'Max' : 'Mid'} slice`, 'clip-path': `url(#${cid})` }));
    g.append(sv('rect', { x, y, width: w, height: hh, rx, fill: 'none', stroke: col, 'stroke-width': 1.5 }));
  } else {
    g.append(sv('rect', { x, y, width: w, height: hh, rx, fill: pal.surface2, stroke: pal.line }));
    const fs = Math.round(Math.min(w, hh) * 0.36);
    g.append(sv('text', { x: x + w / 2, y: y + hh / 2 + fs * 0.35, 'text-anchor': 'middle', 'font-size': fs, 'font-weight': 700, fill: pal.muted, 'font-family': 'Alegreya, Georgia, serif' }, ((p.s || '')[0] || '') + ((p.g || '')[0] || '')));
  }
}

function personBox(n, o, pal, defs, uid) {
  const p = P(n.id) || { g: '?', sx: 'U' };
  const st = o.style || 'album';
  const outer = sv('g', { class: 'node' + (n.spouse ? ' spouse' : ''), transform: `translate(${n.x},${n.y})`, 'data-id': n.id, tabindex: 0, role: 'button', 'aria-label': personName(p) });
  // everything below is drawn at 100% and scaled as a whole (chart_font setting)
  const base = baseSize(o), tall = cardShape(o) === 'tall';
  const k = n.w / base.w || 1;
  const g = sv('g', k !== 1 ? { transform: `scale(${k})` } : {});
  outer.append(g);
  n = { ...n, w: n.w / k, h: n.h / k };
  const SDY = base.sdy;
  const col = sexColor(pal, p.sx);
  const sans = '"Alegreya Sans", "Segoe UI", sans-serif';
  // name typography (chart_name_style): serif, sans, or sans with capitalised names
  const ns = S.settings.chart_name_style || 'serif';
  const font = ns === 'serif' ? 'Alegreya, Georgia, serif' : sans;
  const caps = ns === 'sans_caps';
  const up = t => (caps ? String(t || '').toLocaleUpperCase('hu') : t);
  const cw = caps ? 10.6 : ns === 'sans' ? 8.0 : 8.4;   // average glyph width at 17px, for clipping
  const masked = p.masked && S.settings.privacy_living === 'names';
  if (n.spouse && tall) {
    // narrow card tucked behind the partner: a two-line strip (surname / given name + years) shows below it
    const fill = st === 'minimal' ? pal.paper : pal.surface2;
    g.append(sv('rect', { width: n.w, height: n.h, rx: st === 'classic' ? 3 : 9, fill, stroke: n.div ? pal.muted : pal.line, 'stroke-width': 1, ...(n.div ? { 'stroke-dasharray': '4 3' } : {}) }));
    g.append(sv('rect', { x: 0, y: n.h - SDY + 6, width: 4, height: SDY - 12, rx: 2, fill: col }));
    // a real photo on the left, then three short lines: surname / given name / years
    const mid = n.h - SDY / 2;
    let tx = 12;
    if (o.photos) { const r = Math.min(21, SDY / 2 - 6); photoCircle(g, p, 9 + r, mid, r, col, pal, defs, uid, n); tx = 9 + 2 * r + 7; }
    const west = S.settings.name_order === 'west';
    const room = Math.floor((n.w - tx - 5) / (caps ? 7.4 : 6.1));
    const a = masked ? T('Élő személy') : up((west ? p.g : p.s) || '');
    const b = masked ? '' : up(fitGiven((west ? p.s : p.g) || '', room));
    const yr = masked ? '' : years(p);
    const lines = [[(n.div ? '⚮ ' : '⚭ ') + clip(a || b, room - 2), 12.5, 700, pal.ink], a && b ? [clip(b, room), 12, 400, pal.ink] : null, yr ? [yr, 11, 400, pal.muted] : null].filter(Boolean);
    const lh = 14, y0 = mid - (lines.length - 1) * lh / 2 + 4;
    lines.forEach(([t, fs, fw, fill], i) => g.append(sv('text', { x: tx, y: y0 + i * lh, 'font-size': fs, 'font-weight': fw, fill, 'font-family': sans }, t)));
    return outer;
  }
  if (n.spouse) {
    // card tucked behind the partner: only the bottom strip (SDY high) is visible, the name lives there
    const fill = st === 'minimal' ? pal.paper : pal.surface2;
    g.append(sv('rect', { width: n.w, height: n.h, rx: st === 'classic' ? 3 : 9, fill, stroke: n.div ? pal.muted : pal.line, 'stroke-width': 1, ...(n.div ? { 'stroke-dasharray': '4 3' } : {}) }));
    g.append(sv('rect', { x: 0, y: n.h - SDY + 6, width: 4, height: SDY - 12, rx: 2, fill: col }));
    const sy = n.h - SDY / 2;
    let tx = 12;
    if (o.photos) { const r = Math.min(16, SDY / 2 - 5); photoCircle(g, p, 10 + r, sy, r, col, pal, defs, uid, n); tx = 10 + 2 * r + 9; }
    const nm = masked ? T('Élő személy') : up(personName(p, { short: true, withTitle: false }));
    const yr = years(p);
    const room = Math.floor((n.w - tx - 8) / (caps ? 8.6 : 6.6));
    const label = (n.div ? '⚮ ' : '⚭ ') + clip(nm, Math.max(6, room - (yr ? yr.length + 1 : 0)));
    const t = sv('text', { x: tx, y: sy + 4.5, 'font-size': caps ? 12.5 : 13.5, fill: pal.ink, 'font-family': sans, ...(caps ? { 'letter-spacing': '.02em' } : {}) }, label);
    if (yr && label.length + yr.length + 1 <= room) t.append(sv('tspan', { fill: pal.muted, dx: 6, 'font-size': 12 }, yr));
    g.append(t);
    return outer;
  }
  const fill = st === 'classic' ? pal.surface2 : st === 'minimal' ? pal.paper : pal.surface;
  const stroke = n.root ? pal.accent : st === 'classic' ? col : pal.line;
  if (tall) {
    // narrow card: photo on top, the names centred under it, then the years (and place)
    g.append(sv('rect', { width: n.w, height: n.h, rx: st === 'classic' ? 3 : 9, fill, stroke, 'stroke-width': n.root ? 2.6 : 1, ...(n.dup ? { 'stroke-dasharray': '4 3' } : {}) }));
    if (st === 'minimal') g.append(sv('rect', { x: 0, y: n.h - 2, width: n.w, height: 2, fill: col }));
    else g.append(sv('rect', { x: st === 'classic' ? 0 : 10, y: 0, width: st === 'classic' ? n.w : n.w - 20, height: 4, rx: 2, fill: col }));
    const cx = n.w / 2;
    let y = 28;
    if (o.photos) {
      const q = TALL_PHOTO[photoSize(o)];
      if (q.rect) { const [rx0, ry0, rw, rh] = q.rect; photoRect(g, p, rx0, ry0, rw, rh, col, pal, defs, uid, n); }
      else photoCircle(g, p, cx, q.cy, q.r, col, pal, defs, uid, n);
      y = q.ty;
    }
    const cwT = (caps ? 10.6 : ns === 'sans' ? 8.0 : 8.4) * 15.5 / 17;
    const maxT = Math.floor((n.w - 10) / cwT);
    const west = S.settings.name_order === 'west';
    const l1 = masked ? T('Élő személy') : up((west ? p.g : p.s) || '');
    const givenRaw = masked ? '' : ((west ? p.s : p.g) || '');
    const title = !masked && p.t ? p.t + ' ' : '';
    const l2 = givenRaw ? title + up(fitGiven(givenRaw, maxT + 1 - title.length)) : title.trim();
    const txt = (yy, size, t, extra = {}) => g.append(sv('text', { x: cx, y: yy, 'text-anchor': 'middle', 'font-size': size, fill: pal.ink, 'font-family': font, ...extra }, t));
    txt(y, 15.5, clip(l1 || l2 || '?', maxT), { 'font-weight': 700 });
    if (l1 && l2) { y += 18; txt(y, 14.5, clip(l2, maxT + 1)); }
    y += 17; txt(y, 12.5, years(p), { fill: pal.muted, 'font-family': sans });
    if (o.places && (p.bp || p.dp)) { y += 15; txt(y, 11.5, clip(p.bp || p.dp, maxT + 3), { fill: pal.muted, 'font-family': sans }); }
    return outer;
  }
  g.append(sv('rect', { width: n.w, height: n.h, rx: st === 'classic' ? 3 : 9, fill, stroke, 'stroke-width': n.root ? 2.6 : 1, ...(n.dup ? { 'stroke-dasharray': '4 3' } : {}) }));
  if (st !== 'minimal') g.append(sv('rect', { x: 0, y: st === 'classic' ? 0 : 8, width: 4, height: st === 'classic' ? n.h : n.h - 16, rx: 2, fill: col }));
  else g.append(sv('rect', { x: 0, y: n.h - 2, width: n.w, height: 2, fill: col }));
  let tx = 14, dy = 0;
  if (o.photos) {
    const ps = photoSize(o), q = WIDE_PHOTO[ps];
    if (ps === 'normal') { const r = Math.min(27, n.h / 2 - 8); photoCircle(g, p, 12 + r, o.places ? 38 : n.h / 2, r, col, pal, defs, uid, n); tx = 12 + r * 2 + 10; }
    else if (q.rect) { const [rx0, , rw] = q.rect; photoRect(g, p, rx0, 8, rw, n.h - 16, col, pal, defs, uid, n); tx = rx0 + rw + 10; }
    else { photoCircle(g, p, q.cx, n.h / 2, q.r, col, pal, defs, uid, n); tx = q.cx + q.r + 10; }
    // keep the text block vertically centred on the taller card
    dy = Math.round((n.h - (o.places ? 90 : 76)) / 2);
  }
  const maxC = Math.floor((n.w - tx - 6) / cw);
  const west = S.settings.name_order === 'west';
  const l1 = masked ? T('Élő személy') : up((west ? p.g : p.s) || '');
  const givenRaw = masked ? '' : ((west ? p.s : p.g) || '');
  const title = !masked && p.t ? p.t + ' ' : '';
  const l2 = givenRaw ? title + up(fitGiven(givenRaw, maxC + 1 - title.length)) : title.trim();
  const top = (o.places ? 22 : 26) + dy;
  g.append(sv('text', { x: tx, y: top, 'font-size': 17, 'font-weight': 700, fill: pal.ink, 'font-family': font }, clip(l1 || l2 || '?', maxC)));
  if (l1 && l2) g.append(sv('text', { x: tx, y: top + 19, 'font-size': 16, fill: pal.ink, 'font-family': font }, clip(l2, maxC + 1)));
  const yr = years(p);
  g.append(sv('text', { x: tx, y: top + (l1 && l2 ? 37 : 20), 'font-size': 13.5, fill: pal.muted, 'font-family': sans }, yr));
  if (o.places && (p.bp || p.dp)) g.append(sv('text', { x: tx, y: top + 54, 'font-size': 12.5, fill: pal.muted, 'font-family': sans }, clip(p.bp || p.dp, maxC + 4)));
  return outer;
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
    // name below the portrait (the fan leaves room under the centre), so the face stays uncovered
    cg.append(sv('text', { y: r0 + 18, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700, fill: pal.ink, 'font-family': font, 'paint-order': 'stroke', stroke: pal.paper, 'stroke-width': 4 }, clip(personName(rp, { short: true, withTitle: false }), 28)));
    cg.append(sv('text', { y: r0 + 35, 'text-anchor': 'middle', 'font-size': 12.5, fill: pal.muted, 'font-family': sans, 'paint-order': 'stroke', stroke: pal.paper, 'stroke-width': 4 }, years(rp)));
  } else {
    cg.append(sv('text', { y: -4, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700, fill: pal.ink, 'font-family': font }, clip((S.settings.name_order === 'west' ? rp?.g : rp?.s) || '', 16)));
    cg.append(sv('text', { y: 14, 'text-anchor': 'middle', 'font-size': 14, fill: pal.ink, 'font-family': font }, clip((S.settings.name_order === 'west' ? rp?.s : rp?.g) || '', 16)));
    cg.append(sv('text', { y: 32, 'text-anchor': 'middle', 'font-size': 12, fill: pal.muted, 'font-family': sans }, years(rp)));
  }
  g.append(cg);
  svgRoot.append(g);
  const R = r0 + G * ring;
  const lowY = Math.max(R * Math.sin(start + span), r0 + (o.photos && rp?.ph ? 44 : 0)); // span ends 30° below the horizon
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
  const svg = sv('svg', { xmlns: NS, 'xmlns:xlink': 'http://www.w3.org/1999/xlink', role: 'img', 'aria-label': T(CHART_KINDS[o.kind]?.label || 'Diagram') + ': ' + personName(P(o.root)) });
  const defs = sv('defs');
  svg.append(defs);
  const world = sv('g');
  svg.append(world);
  let bounds, info = {}, core = null, anchor = { x: 0, y: 0 };
  if (!P(o.root)) { host.replaceChildren(h('div', { class: 'empty', style: 'padding:30px' }, T('Válassz egy személyt.'))); return null; }

  if (o.kind === 'fan') {
    bounds = renderFan(o.root, o, pal, world, defs, uid);
  } else {
    let L;
    const orient = chartOrient(o);
    if (o.kind === 'ancestors') L = layoutAncestors(o.root, o, orient === 'v');
    else if (o.kind === 'descendants') L = orient === 'h' ? layoutDescendantsH(o.root, o) : layoutDescendants(o.root, o);
    else if (o.kind === 'family') L = layoutFamily(o.root, o);
    else if (o.kind === 'relation') {
      L = layoutRelation(o.root, o.other || o.root, o); info.path = L.path; info.paths = L.paths;
      info.label = L.paths?.length > 1 ? T('{0} úton is kapcsolódnak: ', L.paths.length) + L.paths.map((p, i) => `(${i + 1}) ${relationLabel(p)}`).join(' ') : relationLabel(L.path);
    }
    else L = o.graph || o.open?.length ? layoutGraph(o.root, o, orient) : layoutHourglass(o.root, o, orient);
    const lg = sv('g', { fill: 'none', stroke: pal.muted, 'stroke-width': 1.4, 'stroke-linejoin': 'round', opacity: .75, 'pointer-events': 'none' });
    for (const l of L.links) lg.append(sv('path', { d: l.d, ...(l.kind === 'marr' ? { stroke: pal.accent, 'stroke-width': 2.2 } : {}), ...(l.kind === 'div' ? { stroke: pal.muted, 'stroke-dasharray': '5 4' } : {}) }));
    if (!L.linksOnTop) world.append(lg);
    for (const e of L.extra || []) world.append(sv('text', { x: e.x, y: e.y, 'text-anchor': e.anchor || 'middle', 'font-size': e.size || 12, fill: e.ink ? pal.ink : pal.accent, 'font-family': '"Alegreya Sans", sans-serif', 'font-style': e.ink ? 'normal' : 'italic', 'font-weight': e.ink ? 600 : 400, 'paint-order': 'stroke', stroke: pal.paper, 'stroke-width': 4 }, e.t));
    // spouse cards first (deepest layer first) so their partner's card covers them
    const order = L.nodes.slice().sort((a, b) => (b.spouse ? b.layer : 0) - (a.spouse ? a.layer : 0));
    for (const n of order) world.append(personBox(n, o, pal, defs, uid));
    if (L.linksOnTop) world.append(lg);
    bounds = measureBounds(L.nodes);
    const rn = L.nodes.find(n => n.root) || L.nodes.find(n => n.id === o.root);
    if (rn) anchor = { x: rn.x, y: rn.y, w: rn.w, h: rn.h };
    // o.focusRow (home page on a phone): the bottom of this generation's row is the bottom of the first view
    const fr = o.focusRow != null ? L.nodes.filter(n => n.gen === o.focusRow) : [];
    if (fr.length) anchor.rowBottom = Math.max(...fr.map(n => n.y + n.h));
    // o.viewUp / o.viewDown: more generations are drawn than shown at first; the starting view covers these
    if (o.viewUp != null || o.viewDown != null) {
      const vu = o.viewUp ?? o.up, vd = o.viewDown ?? o.down;
      const cn = L.nodes.filter(n => n.gen == null || (n.gen <= vu && -n.gen <= vd));
      if (cn.length) {
        core = measureBounds(cn);
        // fitWidth: the lowest generation shown at first sets the width (e.g. all the grandchildren from one
        // end to the other) and sits at the bottom; wider rows above it may run off the sides
        const row = L.nodes.filter(n => n.gen === -vd);
        const rb = row.length ? measureBounds(row) : null;
        if (o.fitWidth && rb && rb.h < 3 * row[0].h) core = { x: rb.x, w: rb.w, y: core.y, h: core.h };
        if (cn.length === L.nodes.length && !(o.fitWidth && rb)) core = null;
      }
    }
    info.count = new Set(L.nodes.map(n => n.id)).size;
  }
  const pad = 30;
  bounds = { x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + 2 * pad, h: bounds.h + 2 * pad };
  // what the first view is fitted to (all of it, or the core generations)
  const vbounds = core ? { x: core.x - pad, y: core.y - pad, w: core.w + 2 * pad, h: core.h + 2 * pad } : bounds;
  host.replaceChildren(svg);

  // ---------------- viewBox pan/zoom
  let vb = { ...bounds };
  const apply = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const fit = (maxScale = 1.25, B = bounds) => {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height || !host.isConnected) return; // hidden or already replaced
    const W = r.width || 800, H = r.height || 500;
    const s = Math.min(W / B.w, H / B.h, maxScale);
    vb = { w: W / s, h: H / s, x: B.x + B.w / 2 - W / s / 2, y: B.y + B.h / 2 - H / s / 2 };
    apply();
  };
  // whole width visible (e.g. the full grandchild generation on the home page); vertically the root and
  // everything below it are kept in view, the oldest ancestors may be cut off at the top
  const fitWidth = () => {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height || !host.isConnected) return;
    const avail = r.width - (o.padRight || 0);   // room left of the zoom buttons
    const B = vbounds;
    const sc = Math.min(avail / B.w, o.maxScale || 1);
    vb = { w: r.width / sc, h: r.height / sc, x: B.x - (avail - B.w * sc) / 2 / sc, y: 0 };
    const extra = (o.padBottom || 0) / sc;
    vb.y = B.h + extra <= vb.h && !core ? B.y + B.h / 2 - vb.h / 2 + extra / 2 : B.y + B.h + extra - vb.h;
    // with more generations below: the lowest first-view row is the bottom line, the rest is out of view
    if (core) vb.y = B.y + B.h - pad + 10 / sc + extra - vb.h;
    apply();
  };
  // o.view (from getView() of the previous drawing): the same zoom and position, relative to the centre person
  // o.view: the previous drawing's view (a setting changed); o.zoom: only its zoom level, centred on the
  // (new) centre person – when someone else is put in the middle
  const kept = o.view || (o.zoom ? { x: (anchor.w || 0) / 2 - o.zoom.w / 2, y: (anchor.h || 0) / 2 - o.zoom.h / 2, w: o.zoom.w, h: o.zoom.h } : null);
  const initialView = () => kept ? (vb = { x: anchor.x + kept.x, y: anchor.y + kept.y, w: kept.w, h: kept.h }, apply()) : (o.fitWidth && host.clientWidth >= 640 ? fitWidth() : o.focus || host.clientWidth < 640 ? focusRoot() : fit(1.25, vbounds));
  if (kept) initialView();
  const focusRoot = () => {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height || !host.isConnected) return;
    const node = world.querySelector(`.node[data-id="${o.root}"]`);
    if (!node || o.kind === 'fan') return fit();
    const bb = node.getBBox(); const ctm = node.transform.baseVal.consolidate()?.matrix;
    const cx = (ctm ? ctm.e : 0) + bb.x + bb.width / 2, cy = (ctm ? ctm.f : 0) + bb.y + bb.height / 2 + (o.focusShift || 0);
    const s = Math.min(r.width / vbounds.w, r.height / vbounds.h);
    // fixed starting zoom (not "fit"), so the card font size setting shows up as real on-screen size
    const sc = o.minScale || (r.width < 640 ? 0.7 : 1);
    if (s >= sc) return fit(sc, vbounds);  // small chart: all of it, centred
    vb = { w: r.width / sc, h: r.height / sc, x: cx - r.width / sc / 2, y: cy - r.height / sc / 2 };
    if (anchor.rowBottom != null) {
      const y = anchor.rowBottom + ((o.padBottom || 0) + 10) / sc - vb.h;
      if (y <= anchor.y - 10 / sc) vb.y = y;   // only while the centre person stays in view
    }
    apply();
  };
  const zoom = (f, cx, cy) => {
    const r = host.getBoundingClientRect();
    const px = cx === undefined ? .5 : (cx - r.left) / r.width, py = cy === undefined ? .5 : (cy - r.top) / r.height;
    const nw = Math.min(Math.max(vb.w * f, 120), bounds.w * 6 + 2000), nh = nw * (vb.h / vb.w);
    vb.x += (vb.w - nw) * px; vb.y += (vb.h - nh) * py; vb.w = nw; vb.h = nh;
    apply();
  };
  requestAnimationFrame(initialView);
  // embedded charts: one finger scrolls the page, two fingers pinch-zoom the chart; full-screen explorer: all gestures go to the chart
  host.style.touchAction = o.wheel === false ? 'pan-y' : 'none';

  // ---------------- quick card (popover) for a clicked person
  let pop = null;
  const closePop = () => { if (pop) { pop.remove(); pop = null; } };
  const openPop = (id, nodeEl) => {
    closePop();
    const p = P(id); if (!p) return;
    const hr = host.getBoundingClientRect(), nr = nodeEl.getBoundingClientRect();
    const actions = (o.popActions || defaultPopActions)(id);
    pop = h('div', { class: 'chart-pop', role: 'dialog', 'aria-label': personName(p) },
      h('div', { class: 'cp-head' }, popAvatar(p), h('div', null, h('b', null, personName(p)), h('div', { class: 'cp-yr' }, [years(p), p.bp].filter(Boolean).join(' · ')))),
      h('div', { class: 'cp-act' }, actions.map(a => h('button', { type: 'button', class: 'btn btn-sm' + (a.primary ? ' btn-primary' : ''), onclick: ev => { ev.stopPropagation(); closePop(); a.run(id); } }, a.label))));
    host.append(pop);
    // place under the card, kept inside the chart area
    const pw = Math.min(300, hr.width - 16);
    let left = nr.left - hr.left + nr.width / 2 - pw / 2;
    left = Math.max(8, Math.min(left, hr.width - pw - 8));
    let top = nr.bottom - hr.top + 8;
    if (top + 140 > hr.height) top = Math.max(8, nr.top - hr.top - 148);
    Object.assign(pop.style, { left: left + 'px', top: top + 'px', width: pw + 'px' });
  };
  const defaultPopActions = id => [
    { label: T('Középre'), primary: true, run: x => recenter(x) },
    { label: T('Adatlap'), run: x => (o.onOpen ? o.onOpen(x) : (location.hash = '#/person/' + x)) },
  ];
  const popAvatar = p => {
    const el = h('span', { class: 'av ' + (p.sx || 'U'), style: '--sz:40px' });
    if (p.ph) el.append(h('img', { src: p.ph, alt: '' })); else el.append(((p.s || '')[0] || '') + ((p.g || '')[0] || ''));
    return el;
  };

  const cleanups = [];
  let touched = !!kept; // once the user zoomed/panned, resizes no longer reset the view
  if (o.interactive) {
    // pointers: 1 finger/mouse = pan, 2 fingers = pinch-zoom around their midpoint
    const pts = new Map();
    let drag = null, pinch = null, moved = false;
    const startDrag = (x, y) => { drag = { x, y, vx: vb.x, vy: vb.y }; };
    let downNode = null, multi = false;
    const down = e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (e.target.closest('.chart-ctl') || e.target.closest('.chart-pop')) return;
      if (pts.size === 0) { downNode = e.target.closest('.node'); multi = false; }
      else multi = true;
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
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) { if (!moved) closePop(); moved = true; touched = true; }
      vb.x = drag.vx - (e.clientX - drag.x) * sc; vb.y = drag.vy - (e.clientY - drag.y) * sc; apply();
    };
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      // a tap/click: pointer capture retargets the browser's click event, so it is recognised here
      if (pts.size === 0 && !moved && !multi && e.type === 'pointerup') tap(downNode);
      try { host.releasePointerCapture(e.pointerId); } catch (_) { }
      if (pts.size < 2) pinch = null;
      if (pts.size === 1) { const p = [...pts.values()][0]; startDrag(p.x, p.y); } else drag = null;
    };
    const wheel = e => { if (o.wheel === false && !e.ctrlKey && !e.metaKey) return; e.preventDefault(); touched = true; zoom(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY); };
    // click = quick card, double click / double tap = make that person the centre
    let lastTap = { id: null, t: 0 };
    const recenter = id => { closePop(); (o.onRecenter || (x => (location.hash = '#/person/' + x)))(id); };
    const tap = n => {
      if (!n) { closePop(); return; }
      const id = +n.dataset.id;
      const now = Date.now();
      if (lastTap.id === id && now - lastTap.t < 450) { lastTap = { id: null, t: 0 }; recenter(id); return; }
      lastTap = { id, t: now };
      openPop(id, n);
    };
    const key = e => {
      if (e.key === 'Escape') return closePop();
      const n = e.target.closest?.('.node'); if (!n) return;
      if (e.key === 'Enter') { e.preventDefault(); recenter(+n.dataset.id); }
      else if (e.key === ' ') { e.preventDefault(); openPop(+n.dataset.id, n); }
    };
    host.addEventListener('pointerdown', down); host.addEventListener('pointermove', move, { passive: false }); host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up);
    host.addEventListener('wheel', wheel, { passive: false }); host.addEventListener('keydown', key);
    cleanups.push(() => { host.removeEventListener('pointerdown', down); host.removeEventListener('pointermove', move); host.removeEventListener('pointerup', up); host.removeEventListener('pointercancel', up); host.removeEventListener('wheel', wheel); host.removeEventListener('keydown', key); });
    // on-screen zoom buttons (always available: touch screens, trackpads, embedded charts without wheel zoom)
    if (o.controls !== false) {
      const btn = (label, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', ev => { ev.stopPropagation(); touched = true; fn(); }); return b; };
      const ctl = document.createElement('div');
      ctl.className = 'chart-ctl';
      ctl.append(btn('+', T('Nagyítás'), () => zoom(0.75)), btn('−', T('Kicsinyítés'), () => zoom(1.33)), btn('⤢', T('Teljes nézet'), () => fit(3)));
      host.append(ctl);
    }
  } else {
    host.addEventListener('click', e => { const n = e.target.closest('.node'); if (n) (o.onOpen || (id => location.hash = '#/person/' + id))(+n.dataset.id); });
  }
  cleanups.push(closePop);
  const ro = new ResizeObserver(() => { if (!touched) initialView(); });
  ro.observe(host);
  cleanups.push(() => ro.disconnect());

  return {
    svg, bounds, info, opts: o, fit, zoom, focusRoot, closePop,
    getView: () => ({ x: vb.x - anchor.x, y: vb.y - anchor.y, w: vb.w, h: vb.h }),
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
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error(T('A diagram képpé alakítása nem sikerült.'))); img.src = url; });
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
