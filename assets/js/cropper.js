// Photo cropper for uploads: a fixed frame over the picture; drag to move, pinch / wheel / slider to zoom,
// 90° rotation, a few frame shapes. Works with mouse and touch. Resolves to a JPEG Blob (or null if cancelled).
import { T, h, icon, modal } from './core.js';

/** Load a File/Blob as an image; browsers apply the EXIF orientation when drawing it. */
export function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error(T('A kép nem olvasható.'))); };
    img.src = url;
  });
}

const toBlob = (canvas, q = 0.92) => new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', q));

/** Downscale (never upscale) to fit max×max; returns a JPEG blob, or the original file if it already fits. */
export async function shrinkImage(file, max) {
  let img;
  try { img = await loadImage(file); } catch (e) { return file; }
  const w = img.naturalWidth, hh = img.naturalHeight;
  if (Math.max(w, hh) <= max && file.size < 1.5 * 1024 * 1024) return file;
  const s = Math.min(1, max / Math.max(w, hh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(hh * s));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  const b = await toBlob(c);
  return b ? new File([b], (file.name || 'foto').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
}

const SHAPES = [['1:1', 1], ['3:4', 3 / 4], ['4:3', 4 / 3], ['free', 0]];

/**
 * Open the cropper. max: longest side of the result in pixels.
 * shape: initial frame shape ('1:1' for a face, 'free' = the whole picture's proportions).
 */
export async function cropImage(file, { max = 1600, shape = '1:1' } = {}) {
  const img0 = await loadImage(file);
  return new Promise(resolve => {
    let rot = 0;                                   // 0, 90, 180, 270
    let src = img0;                                // rotated source (canvas) or the image
    let aspect = (SHAPES.find(s => s[0] === shape) || SHAPES[0])[1];
    let s = 1, ix = 0, iy = 0;                     // image scale and top-left in stage pixels
    let fr = { x: 0, y: 0, w: 100, h: 100 };       // crop frame in stage pixels
    let done = false;
    const cv = h('canvas', { class: 'crop-cv' });
    const stage = h('div', { class: 'crop-stage' }, cv);
    const zoom = h('input', { type: 'range', min: 0, max: 100, value: 0, 'aria-label': T('Nagyítás') });
    const srcW = () => src.naturalWidth || src.width, srcH = () => src.naturalHeight || src.height;
    const minS = () => Math.max(fr.w / srcW(), fr.h / srcH());
    const maxS = () => Math.max(minS() * 8, minS() * 1.01);
    const clamp = () => {
      s = Math.min(maxS(), Math.max(minS(), s));
      ix = Math.min(fr.x, Math.max(fr.x + fr.w - srcW() * s, ix));
      iy = Math.min(fr.y, Math.max(fr.y + fr.h - srcH() * s, iy));
      zoom.value = Math.round(100 * Math.log(s / minS()) / Math.log(maxS() / minS()));
    };
    const draw = () => {
      const W = stage.clientWidth, H = stage.clientHeight, dpr = window.devicePixelRatio || 1;
      if (!W || !H) return;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#111'; g.fillRect(0, 0, W, H);
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, ix, iy, srcW() * s, srcH() * s);
      // dim everything outside the frame
      g.fillStyle = 'rgba(0,0,0,.55)';
      g.beginPath(); g.rect(0, 0, W, H); g.rect(fr.x, fr.y, fr.w, fr.h); g.fill('evenodd');
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(fr.x, fr.y, fr.w, fr.h);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath();
      for (const t of [1 / 3, 2 / 3]) { g.moveTo(fr.x + fr.w * t, fr.y); g.lineTo(fr.x + fr.w * t, fr.y + fr.h); g.moveTo(fr.x, fr.y + fr.h * t); g.lineTo(fr.x + fr.w, fr.y + fr.h * t); }
      g.stroke();
      if (aspect === 1) { g.strokeStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.arc(fr.x + fr.w / 2, fr.y + fr.h / 2, fr.w / 2, 0, Math.PI * 2); g.stroke(); }
    };
    // (re)build the frame for the current stage size and shape, keeping the centre of what was in it
    const layout = (keep = true) => {
      const W = stage.clientWidth, H = stage.clientHeight;
      if (!W || !H) return;
      const cx = keep ? (fr.x + fr.w / 2 - ix) / s : srcW() / 2, cy = keep ? (fr.y + fr.h / 2 - iy) / s : srcH() / 2;
      const rel = keep ? fr.w / (srcW() * s) : 1;
      const a = aspect || srcW() / srcH();
      const m = 18, aw = W - 2 * m, ah = H - 2 * m;
      const fw = Math.min(aw, ah * a), fh = fw / a;
      fr = { x: (W - fw) / 2, y: (H - fh) / 2, w: fw, h: fh };
      s = keep ? fr.w / (rel * srcW()) : minS();
      ix = fr.x + fr.w / 2 - cx * s; iy = fr.y + fr.h / 2 - cy * s;
      clamp(); draw();
    };
    const zoomAt = (ns, px, py) => {
      const ox = (px - ix) / s, oy = (py - iy) / s;
      s = ns; ix = px - ox * s; iy = py - oy * s; clamp(); draw();
    };
    zoom.addEventListener('input', () => { const ns = minS() * Math.pow(maxS() / minS(), zoom.value / 100); zoomAt(ns, fr.x + fr.w / 2, fr.y + fr.h / 2); });

    // pointers: one = move, two = pinch
    const pts = new Map(); let drag = null, pinch = null;
    const pos = e => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    stage.addEventListener('pointerdown', e => {
      try { stage.setPointerCapture(e.pointerId); } catch (_) { }
      pts.set(e.pointerId, pos(e));
      if (pts.size === 1) { const p = pos(e); drag = { x: p.x, y: p.y, ix, iy }; }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s }; drag = null; }
    });
    stage.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      e.preventDefault();
      pts.set(e.pointerId, pos(e));
      if (pinch && pts.size >= 2) { const [a, b] = [...pts.values()]; zoomAt(pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) || 1) / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2); return; }
      if (drag) { const p = pos(e); ix = drag.ix + p.x - drag.x; iy = drag.iy + p.y - drag.y; clamp(); draw(); }
    });
    const up = e => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 1) { const p = [...pts.values()][0]; drag = { x: p.x, y: p.y, ix, iy }; } else if (!pts.size) drag = null;
    };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', e => { e.preventDefault(); const p = pos(e); zoomAt(s * Math.exp(-e.deltaY * 0.0015), p.x, p.y); }, { passive: false });

    const rotate = () => {
      rot = (rot + 90) % 360;
      const c = document.createElement('canvas');
      const w0 = img0.naturalWidth, h0 = img0.naturalHeight;
      c.width = rot % 180 ? h0 : w0; c.height = rot % 180 ? w0 : h0;
      const g = c.getContext('2d');
      g.translate(c.width / 2, c.height / 2); g.rotate(rot * Math.PI / 180); g.drawImage(img0, -w0 / 2, -h0 / 2);
      src = rot ? c : img0;
      layout(false);
    };
    const shapeBtns = h('div', { class: 'crop-shapes', role: 'group', 'aria-label': T('Kivágás alakja') }, SHAPES.map(([k, a]) => h('button', {
      type: 'button', class: 'btn btn-sm' + (a === aspect ? ' on' : ''), 'data-k': k,
      onclick: e => { aspect = a; shapeBtns.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.currentTarget)); layout(false); },
    }, k === 'free' ? T('Teljes kép') : k)));

    const body = h('div', { class: 'cropper' }, stage,
      h('div', { class: 'crop-tools' },
        h('label', { class: 'crop-zoom' }, h('span', null, '−'), zoom, h('span', null, '+')),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: rotate, title: T('Forgatás 90°-kal') }, '⟳ ', T('Forgatás')),
        shapeBtns),
      h('p', { class: 'hint' }, T('Húzással mozgatod a képet, két ujjal, görgővel vagy a csúszkával nagyítod. A kereten belüli rész kerül fel.')));

    const finish = async () => {
      // the frame in source pixels, then scaled down to max
      const sx = (fr.x - ix) / s, sy = (fr.y - iy) / s, sw = fr.w / s, sh = fr.h / s;
      const k = Math.min(1, max / Math.max(sw, sh));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
      const b = await toBlob(c);
      done = true;
      resolve(b ? new File([b], (file.name || 'foto').replace(/\.\w+$/, '') + '-kivagas.jpg', { type: 'image/jpeg' }) : null);
    };
    const m = modal({ title: T('Kivágás'), wide: true, body,
      actions: [{ label: T('Teljes kép marad') }, { label: T('Kivágás'), cls: 'btn-primary', onClick: finish }],
      onClose: () => { ro.disconnect(); URL.revokeObjectURL(img0.src); if (!done) resolve(null); } });
    m.el.classList.add('crop-modal');
    const ro = new ResizeObserver(() => layout(fr.w !== 100 || fr.h !== 100));
    ro.observe(stage);
    requestAnimationFrame(() => layout(false));
  });
}
