/*
 * Floor-plan asset generator.
 *
 * Produces clean schematic SVG floor plans that genuinely reflect a property's
 * type + bedroom count, then writes them to public/floorplans/*.svg.
 *
 * Run:  node scripts/gen-floorplans.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'floorplans');

const W = 960;
const H = 640;

/* ---- palette ---- */
const C = {
  paper: '#f8fafc',
  grid: '#e6ebf2',
  outer: '#1e293b',
  wall: '#334155',
  room: '#ffffff',
  roomAlt: '#f5f8fc',
  label: '#475569',
  sub: '#94a3b8',
  fixture: '#cbd5e1',
  fixtureFill: '#eef2f7',
  accent: '#0f766e',
  outdoor: '#eaf3ee',
  outdoorLine: '#bcd8c8',
};

/* ---- primitives ---- */
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function label(x, y, w, text, sub) {
  const cx = x + w / 2;
  let out = `<text x="${cx}" y="${y}" text-anchor="middle" font-family="'Segoe UI',Arial,sans-serif" font-size="15" font-weight="700" letter-spacing="1.2" fill="${C.label}">${esc(text)}</text>`;
  if (sub) out += `<text x="${cx}" y="${y + 18}" text-anchor="middle" font-family="'Segoe UI',Arial,sans-serif" font-size="12" fill="${C.sub}">${esc(sub)}</text>`;
  return out;
}

/* generic room: rect + centred label + optional furniture glyph */
function room(x, y, w, h, name, furnish, sub, alt) {
  const fill = alt ? C.roomAlt : C.room;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${C.wall}" stroke-width="3"/>`;
  s += furniture(x, y, w, h, furnish);
  s += label(x, y + h / 2 - (sub ? 8 : 0), w, name, sub);
  return s;
}

function outdoor(x, y, w, h, name) {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.outdoor}" stroke="${C.outdoorLine}" stroke-width="2" stroke-dasharray="6 5"/>`;
  // hatch lines to read as open/outdoor space
  for (let lx = x + 16; lx < x + w; lx += 26) {
    s += `<line x1="${lx}" y1="${y + 6}" x2="${lx - 16}" y2="${y + h - 6}" stroke="${C.outdoorLine}" stroke-width="1.2"/>`;
  }
  s += label(x, y + h / 2, w, name);
  return s;
}

/* ---- furniture glyphs (light gray, schematic) ---- */
function fx(inner) { return `<g stroke="${C.fixture}" stroke-width="1.8" fill="${C.fixtureFill}" stroke-linejoin="round">${inner}</g>`; }

function furniture(x, y, w, h, kind) {
  const pad = 12;
  switch (kind) {
    case 'bed-master':
    case 'bed': {
      const bw = Math.min(w - 2 * pad, kind === 'bed-master' ? 150 : 120);
      const bh = Math.min(h - 2 * pad, 130);
      const bx = x + w - bw - pad;
      const by = y + pad;
      return fx(
        `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="6"/>` +
        `<rect x="${bx + 8}" y="${by + 8}" width="${bw - 16}" height="${bh * 0.26}" rx="4"/>` +
        `<rect x="${x + pad}" y="${y + pad}" width="20" height="${Math.min(h - 2 * pad, 70)}" rx="3"/>`
      );
    }
    case 'living': {
      const sy = y + h - 44;
      return fx(
        `<rect x="${x + pad}" y="${sy - 8}" width="${Math.min(160, w - 2 * pad)}" height="34" rx="8"/>` +
        `<rect x="${x + pad}" y="${sy - 30}" width="${Math.min(160, w - 2 * pad)}" height="16" rx="6"/>` +
        `<rect x="${x + w - pad - 90}" y="${y + pad}" width="90" height="14" rx="3"/>`
      );
    }
    case 'kitchen': {
      return fx(
        `<rect x="${x + pad}" y="${y + pad}" width="${w - 2 * pad}" height="22" rx="3"/>` +
        `<rect x="${x + pad}" y="${y + pad}" width="22" height="${h - 2 * pad}" rx="3"/>` +
        `<circle cx="${x + pad + 60}" cy="${y + pad + 11}" r="6"/>`
      );
    }
    case 'bath': {
      const s = Math.min(w, h) * 0.28;
      return fx(
        `<rect x="${x + pad}" y="${y + pad}" width="26" height="34" rx="10"/>` +
        `<rect x="${x + pad}" y="${y + h - pad - 22}" width="30" height="22" rx="4"/>` +
        `<rect x="${x + w - pad - s}" y="${y + pad}" width="${s}" height="${s}" rx="3"/>`
      );
    }
    case 'balcony': {
      let s = '';
      for (let lx = x + 18; lx < x + w - 8; lx += 22) s += `<line x1="${lx}" y1="${y + 10}" x2="${lx}" y2="${y + h - 10}" stroke="${C.fixture}" stroke-width="1.6"/>`;
      return s;
    }
    case 'desks': {
      let s = '';
      const dw = 54, dh = 30, gx = 20, gy = 22;
      for (let ry = y + 18; ry + dh < y + h - 8; ry += dh + gy) {
        for (let rx = x + 18; rx + dw < x + w - 8; rx += dw + gx) {
          s += `<rect x="${rx}" y="${ry}" width="${dw}" height="${dh}" rx="3"/><circle cx="${rx + dw / 2}" cy="${ry + dh + 9}" r="6"/>`;
        }
      }
      return fx(s);
    }
    case 'meeting': {
      const tw = w - 2 * pad - 40, th = h - 2 * pad - 40;
      let s = `<rect x="${x + pad + 20}" y="${y + pad + 20}" width="${tw}" height="${th}" rx="${Math.min(tw, th) / 2}"/>`;
      return fx(s);
    }
    case 'reception': {
      return fx(
        `<path d="M ${x + pad} ${y + h - pad} L ${x + pad} ${y + h - pad - 40} L ${x + pad + 40} ${y + h - pad - 40} L ${x + pad + 40} ${y + h - pad - 16} L ${x + w - pad} ${y + h - pad - 16} L ${x + w - pad} ${y + h - pad} Z"/>`
      );
    }
    case 'lounge': {
      return fx(
        `<rect x="${x + pad}" y="${y + pad}" width="70" height="30" rx="8"/>` +
        `<rect x="${x + w - pad - 70}" y="${y + h - pad - 30}" width="70" height="30" rx="8"/>` +
        `<rect x="${x + w / 2 - 22}" y="${y + h / 2 - 14}" width="44" height="28" rx="5"/>`
      );
    }
    case 'cabin': {
      return fx(
        `<rect x="${x + pad}" y="${y + pad}" width="${Math.min(90, w - 2 * pad)}" height="26" rx="3"/>` +
        `<circle cx="${x + pad + 30}" cy="${y + pad + 46}" r="8"/>`
      );
    }
    case 'racks': {
      let s = '';
      for (let ry = y + 20; ry < y + h - 16; ry += 30) s += `<rect x="${x + pad}" y="${ry}" width="${w - 2 * pad}" height="12" rx="2"/>`;
      return fx(s);
    }
    case 'aisles': {
      let s = '';
      for (let rx = x + 24; rx < x + w - 16; rx += 44) s += `<rect x="${rx}" y="${y + 16}" width="16" height="${h - 32}" rx="3"/>`;
      return fx(s);
    }
    case 'machines': {
      return fx(
        `<rect x="${x + pad}" y="${y + pad}" width="64" height="64" rx="4"/><circle cx="${x + pad + 32}" cy="${y + pad + 32}" r="16"/>` +
        `<rect x="${x + pad + 100}" y="${y + h - pad - 70}" width="80" height="70" rx="4"/>` +
        `<rect x="${x + w - pad - 90}" y="${y + pad + 10}" width="90" height="50" rx="4"/><circle cx="${x + w - pad - 45}" cy="${y + pad + 35}" r="14"/>`
      );
    }
    case 'dock': {
      let s = '';
      for (let dx = x + 24; dx < x + w - 24; dx += 90) s += `<rect x="${dx}" y="${y + h - 30}" width="60" height="18" rx="2" stroke-dasharray="5 4"/>`;
      return fx(s);
    }
    default:
      return '';
  }
}

function scaffold(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img">
  <defs>
    <pattern id="g" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M32 0H0V32" fill="none" stroke="${C.grid}" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="${C.paper}"/>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  ${inner}
</svg>
`;
}

function titleBand(title, sub) {
  return `<text x="40" y="44" font-family="'Segoe UI',Arial,sans-serif" font-size="22" font-weight="800" fill="${C.outer}">${esc(title)}</text>` +
    (sub ? `<text x="${W - 40}" y="44" text-anchor="end" font-family="'Segoe UI',Arial,sans-serif" font-size="13" font-weight="600" letter-spacing="1.5" fill="${C.accent}">${esc(sub)}</text>` : '') +
    `<line x1="40" y1="60" x2="${W - 40}" y2="60" stroke="${C.grid}" stroke-width="2"/>`;
}

function outerShell(x, y, w, h) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${C.outer}" stroke-width="6"/>`;
}

/* ---- residential generator ---- */
function residential(beds, variant) {
  const TITLES = {
    flat: `${beds} BHK Apartment`,
    villa: `${beds} BHK Villa`,
    penthouse: `${beds} BHK Penthouse`,
    rowhouse: `${beds} BHK Row House`,
  };
  const SUBS = { flat: 'TYPICAL FLOOR', villa: 'GROUND FLOOR', penthouse: 'UPPER LEVEL', rowhouse: 'GROUND FLOOR' };
  const topName = variant === 'penthouse' ? 'TERRACE' : (variant === 'villa' || variant === 'rowhouse') ? 'GARDEN / DECK' : 'BALCONY';

  const X = 40, Y = 72, WI = W - 80, HI = H - Y - 40; // plan area
  let s = titleBand(TITLES[variant], SUBS[variant]);
  s += outerShell(X, Y, WI, HI);

  // top outdoor strip (balcony/terrace/garden)
  const topH = 70;
  if (variant === 'villa' || variant === 'rowhouse' || variant === 'penthouse') {
    s += outdoor(X, Y, WI, topH, topName);
  } else {
    s += room(X, Y, WI, topH, topName, 'balcony', null, true);
  }

  const bodyY = Y + topH;
  const bodyH = HI - topH;
  const leftW = Math.round(WI * 0.44);
  const rightX = X + leftW;
  const rightW = WI - leftW;

  // left: living (top) + kitchen (bottom)
  const livH = Math.round(bodyH * 0.6);
  s += room(X, bodyY, leftW, livH, 'LIVING / DINING', 'living');
  s += room(X, bodyY + livH, leftW, bodyH - livH, 'KITCHEN', 'kitchen', null, true);

  // right: bedrooms stacked + bathroom row
  const bathH = 118;
  const bedsArea = bodyH - bathH;
  // master gets extra weight
  const weights = Array.from({ length: beds }, (_, i) => (i === 0 ? 1.35 : 1));
  const wSum = weights.reduce((a, b) => a + b, 0);
  let cy = bodyY;
  for (let i = 0; i < beds; i++) {
    const rh = Math.round((bedsArea * weights[i]) / wSum);
    const isLast = i === beds - 1;
    const h = isLast ? bodyY + bedsArea - cy : rh;
    const name = i === 0 ? 'MASTER BEDROOM' : `BEDROOM ${i + 1}`;
    s += room(rightX, cy, rightW, h, name, i === 0 ? 'bed-master' : 'bed', null, i % 2 === 1);
    cy += h;
  }
  // bath row
  const bathCount = beds >= 4 ? 3 : beds >= 2 ? 2 : 1;
  const bw = Math.round(rightW / bathCount);
  for (let b = 0; b < bathCount; b++) {
    const bx = rightX + b * bw;
    const w2 = b === bathCount - 1 ? rightX + rightW - bx : bw;
    const nm = b === 0 ? 'BATH' : b === 1 && bathCount > 1 ? 'BATH' : 'W.C.';
    s += room(bx, bodyY + bedsArea, w2, bathH, nm, 'bath', null, b % 2 === 0);
  }
  return scaffold(s);
}

function studio() {
  const X = 40, Y = 72, WI = W - 80, HI = H - Y - 40;
  let s = titleBand('Studio Apartment', 'COMPACT LIVING');
  s += outerShell(X, Y, WI, HI);
  const topH = 70;
  s += room(X, Y, WI, topH, 'BALCONY', 'balcony', null, true);
  const bodyY = Y + topH, bodyH = HI - topH;
  const liveW = Math.round(WI * 0.62);
  s += room(X, bodyY, liveW, bodyH, 'LIVING / SLEEPING', 'bed-master', 'Open-plan studio');
  const rx = X + liveW, rw = WI - liveW;
  const kH = Math.round(bodyH * 0.55);
  s += room(rx, bodyY, rw, kH, 'KITCHENETTE', 'kitchen', null, true);
  s += room(rx, bodyY + kH, rw, bodyH - kH, 'BATH', 'bath');
  return scaffold(s);
}

/* ---- commercial generator ---- */
function commercial(title, sub, zones) {
  const X = 40, Y = 72, WI = W - 80, HI = H - Y - 40;
  let s = titleBand(title, sub);
  s += outerShell(X, Y, WI, HI);
  for (const z of zones) {
    s += room(X + z.x, Y + z.y, z.w, z.h, z.name, z.f, z.sub, z.alt);
  }
  return scaffold(s);
}

const COMMERCIAL = {
  office: () => commercial('Office Space', 'FLOOR PLAN', [
    { x: 0, y: 0, w: 220, h: 150, name: 'RECEPTION', f: 'reception' },
    { x: 0, y: 150, w: 220, h: 180, name: 'WAITING', f: 'lounge', alt: 1 },
    { x: 0, y: 330, w: 220, h: 198, name: 'PANTRY', f: 'kitchen' },
    { x: 220, y: 0, w: 400, h: 330, name: 'OPEN WORKSPACE', f: 'desks', alt: 1 },
    { x: 220, y: 330, w: 400, h: 198, name: 'MEETING ROOM', f: 'meeting' },
    { x: 620, y: 0, w: 260, h: 200, name: 'MANAGER CABIN', f: 'cabin', alt: 1 },
    { x: 620, y: 200, w: 130, h: 130, name: 'STORE', f: 'racks' },
    { x: 750, y: 200, w: 130, h: 130, name: 'WASHROOM', f: 'bath', alt: 1 },
    { x: 620, y: 330, w: 260, h: 198, name: 'CONFERENCE', f: 'meeting' },
  ]),
  shop: () => commercial('Shop / Showroom', 'FLOOR PLAN', [
    { x: 0, y: 0, w: 560, h: 528, name: 'DISPLAY / SHOP FLOOR', f: 'aisles' },
    { x: 560, y: 0, w: 320, h: 150, name: 'BILLING COUNTER', f: 'reception', alt: 1 },
    { x: 560, y: 150, w: 320, h: 230, name: 'STORAGE', f: 'racks' },
    { x: 560, y: 380, w: 160, h: 148, name: 'STAFF', f: 'lounge', alt: 1 },
    { x: 720, y: 380, w: 160, h: 148, name: 'WASHROOM', f: 'bath' },
  ]),
  retail: () => commercial('Retail / Mall Unit', 'FLOOR PLAN', [
    { x: 0, y: 0, w: 600, h: 430, name: 'RETAIL FLOOR', f: 'aisles' },
    { x: 0, y: 430, w: 600, h: 98, name: 'CHECKOUT COUNTERS', f: 'reception', alt: 1 },
    { x: 600, y: 0, w: 280, h: 250, name: 'STOCKROOM', f: 'racks', alt: 1 },
    { x: 600, y: 250, w: 280, h: 130, name: 'STAFF ROOM', f: 'lounge' },
    { x: 600, y: 380, w: 280, h: 148, name: 'WASHROOMS', f: 'bath', alt: 1 },
  ]),
  warehouse: () => commercial('Warehouse / Godown', 'FLOOR PLAN', [
    { x: 0, y: 0, w: 400, h: 330, name: 'STORAGE BAY A', f: 'racks' },
    { x: 0, y: 330, w: 400, h: 198, name: 'STORAGE BAY B', f: 'racks', alt: 1 },
    { x: 400, y: 0, w: 480, h: 150, name: 'LOADING DOCK', f: 'dock', alt: 1 },
    { x: 400, y: 150, w: 300, h: 180, name: 'STAGING AREA', f: null },
    { x: 700, y: 150, w: 180, h: 180, name: 'OFFICE', f: 'desks', alt: 1 },
    { x: 400, y: 330, w: 180, h: 198, name: 'WASHROOM', f: 'bath' },
    { x: 580, y: 330, w: 300, h: 198, name: 'PACKING / UTILITY', f: null, alt: 1 },
  ]),
  industrial: () => commercial('Industrial / Factory', 'FLOOR PLAN', [
    { x: 0, y: 0, w: 560, h: 330, name: 'PRODUCTION FLOOR', f: 'machines' },
    { x: 0, y: 330, w: 280, h: 198, name: 'RAW MATERIAL', f: 'racks', alt: 1 },
    { x: 280, y: 330, w: 280, h: 198, name: 'FINISHED GOODS', f: 'racks' },
    { x: 560, y: 0, w: 320, h: 150, name: 'QUALITY CONTROL', f: null, alt: 1 },
    { x: 560, y: 150, w: 160, h: 180, name: 'OFFICE', f: 'desks' },
    { x: 720, y: 150, w: 160, h: 180, name: 'WASHROOM', f: 'bath', alt: 1 },
    { x: 560, y: 330, w: 320, h: 198, name: 'UTILITY / POWER', f: null },
  ]),
  coworking: () => commercial('Co-working Space', 'FLOOR PLAN', [
    { x: 0, y: 0, w: 420, h: 330, name: 'HOT DESKS', f: 'desks' },
    { x: 0, y: 330, w: 200, h: 198, name: 'PRIVATE CABIN', f: 'cabin', alt: 1 },
    { x: 200, y: 330, w: 220, h: 198, name: 'PRIVATE CABIN', f: 'cabin' },
    { x: 420, y: 0, w: 240, h: 200, name: 'MEETING', f: 'meeting', alt: 1 },
    { x: 420, y: 200, w: 240, h: 130, name: 'PHONE BOOTHS', f: null },
    { x: 420, y: 330, w: 240, h: 198, name: 'LOUNGE / CAFÉ', f: 'lounge', alt: 1 },
    { x: 660, y: 0, w: 220, h: 150, name: 'RECEPTION', f: 'reception' },
    { x: 660, y: 150, w: 220, h: 180, name: 'PANTRY', f: 'kitchen', alt: 1 },
    { x: 660, y: 330, w: 220, h: 198, name: 'WASHROOMS', f: 'bath' },
  ]),
};

/* ---- build ---- */
mkdirSync(OUT_DIR, { recursive: true });
const written = [];
function emit(key, svg) { writeFileSync(join(OUT_DIR, `${key}.svg`), svg); written.push(key); }

emit('studio', studio());
for (const b of [1, 2, 3, 4]) emit(`${b}bhk`, residential(b, 'flat'));
for (const variant of ['villa', 'penthouse', 'rowhouse']) {
  for (const b of [2, 3, 4]) emit(`${variant}-${b}`, residential(b, variant));
}
for (const [key, fn] of Object.entries(COMMERCIAL)) emit(key, fn());

console.log(`Wrote ${written.length} SVGs to public/floorplans:`, written.join(', '));
