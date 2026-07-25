import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  RadarController,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';

/* ------------------------------------------------------------------ *
 * Colour helpers — derive 3D face shades from each series' base hex.
 * No new deps; only solid #rgb / #rrggbb inputs get the 3D treatment.
 * ------------------------------------------------------------------ */
function hexToRgb(c) {
  if (typeof c !== 'string') return null;
  let h = c.trim();
  if (h[0] !== '#') return null;
  h = h.slice(1);
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
function shade(rgb, amt, a = 1) {
  // amt > 0 lightens toward white, amt < 0 darkens toward black.
  const t = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  const r = clamp(rgb.r + (t - rgb.r) * p);
  const g = clamp(rgb.g + (t - rgb.g) * p);
  const b = clamp(rgb.b + (t - rgb.b) * p);
  return `rgba(${r},${g},${b},${a})`;
}

/* ------------------------------------------------------------------ *
 * bar3d — isometric extrusion (gradient front + light top cap + dark
 * side). Stack-aware: only the outermost segment of a stack gets the
 * cap so stacked bars read as clean layered blocks.
 * ------------------------------------------------------------------ */
const bar3d = {
  id: 'bar3d',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.enabled === false) return;
    const depth = opts.depth ?? 9;
    const dx = depth;
    const dy = -depth;
    const { ctx } = chart;
    const horizontal = chart.options.indexAxis === 'y';

    const visible = [];
    chart.data.datasets.forEach((_ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden || meta.type !== 'bar') return;
      visible.push({ di, meta });
    });

    // Is this segment the outermost one at its slot (topmost / rightmost)?
    const isOuter = (di, i, bar) => {
      for (const other of visible) {
        if (other.di === di) continue;
        const ob = other.meta.data[i];
        if (!ob) continue;
        if (horizontal) {
          if (Math.abs(ob.y - bar.y) < 0.5 && ob.x > bar.x + 0.5) return false;
        } else if (Math.abs(ob.x - bar.x) < 0.5 && ob.y < bar.y - 0.5) return false;
      }
      return true;
    };

    ctx.save();
    for (const { di, meta } of visible) {
      const raw = chart.data.datasets[di].backgroundColor;
      const rawIsString = typeof raw === 'string';
      // Skip only when no per-bar hex is resolvable (gradient/function fills).
      if (!rawIsString && !Array.isArray(raw)) continue;

      meta.data.forEach((bar, i) => {
        const rawI = rawIsString ? raw : raw[i];
        const base = hexToRgb(typeof rawI === 'string' ? rawI : null);
        if (!base) return; // this bar keeps default rendering
        const top = shade(base, 0.16);
        const side = shade(base, -0.28);

        const { x, y, base: b, width, height } = bar.getProps(
          ['x', 'y', 'base', 'width', 'height'],
          true,
        );
        let left, right, tp, bt;
        if (horizontal) {
          tp = y - height / 2;
          bt = y + height / 2;
          left = b;
          right = x;
          if (Math.abs(right - left) < 0.5) return;
        } else {
          left = x - width / 2;
          right = x + width / 2;
          tp = y;
          bt = b;
          if (Math.abs(bt - tp) < 0.5) return;
        }

        // Front face — gradient along the growth axis.
        const grad = horizontal
          ? ctx.createLinearGradient(left, 0, right, 0)
          : ctx.createLinearGradient(0, tp, 0, bt);
        if (horizontal) {
          grad.addColorStop(0, shade(base, -0.06));
          grad.addColorStop(1, shade(base, 0.12));
        } else {
          grad.addColorStop(0, shade(base, 0.12));
          grad.addColorStop(1, shade(base, -0.06));
        }
        ctx.fillStyle = grad;
        ctx.fillRect(left, tp, right - left, bt - tp);

        const outer = isOuter(di, i, bar);

        // Side face (right) — always drawn to give depth.
        ctx.fillStyle = side;
        ctx.beginPath();
        ctx.moveTo(right, tp);
        ctx.lineTo(right + dx, tp + dy);
        ctx.lineTo(right + dx, bt + dy);
        ctx.lineTo(right, bt);
        ctx.closePath();
        ctx.fill();

        // Cap — only on the outermost segment of a stack.
        if (outer) {
          ctx.fillStyle = top;
          ctx.beginPath();
          if (horizontal) {
            ctx.moveTo(right, tp);
            ctx.lineTo(right + dx, tp + dy);
            ctx.lineTo(right + dx, bt + dy);
            ctx.lineTo(right, bt);
          } else {
            ctx.moveTo(left, tp);
            ctx.lineTo(right, tp);
            ctx.lineTo(right + dx, tp + dy);
            ctx.lineTo(left + dx, tp + dy);
          }
          ctx.closePath();
          ctx.fill();
        }
      });
    }
    ctx.restore();
  },
};

/* ------------------------------------------------------------------ *
 * doughnut3d — tilted perspective 3D donut. Chart.js still paints the
 * top faces (so legend, tooltips, borders, cutout keep working); we
 * squash them into an ellipse via a vertical-scale transform and draw
 * layered per-segment coloured side walls + a soft ground shadow below.
 * ------------------------------------------------------------------ */
const doughnut3d = {
  id: 'doughnut3d',
  beforeDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.enabled === false) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta || meta.type !== 'doughnut' || meta.hidden) return;
    const ds = chart.data.datasets[0];
    if (!ds || !meta.data.length) return;
    const { ctx } = chart;
    const colors = ds.backgroundColor || [];
    const p0 = meta.data[0].getProps(['x', 'y', 'outerRadius'], true);
    const cx = p0.x;
    const cy = p0.y;
    const tilt = opts.tilt ?? 0.6; // vertical squash → perspective ellipse
    const depth = opts.depth ?? Math.max(14, Math.round(p0.outerRadius * 0.3));

    // Ground shadow.
    ctx.save();
    const g = ctx.createRadialGradient(cx, cy + depth, p0.outerRadius * 0.25, cx, cy + depth, p0.outerRadius * 1.25);
    g.addColorStop(0, 'rgba(0,0,0,0.28)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy + depth * 0.9, p0.outerRadius * 1.12, p0.outerRadius * tilt * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();

    // Layered colored side walls (bottom-up) → clean, same-hue coloured 3D edge
    // per slice. Kept gently darker than the top (not toward black) so each
    // slice reads as its true palette colour instead of a muddy brown.
    for (let z = depth; z >= 1; z--) {
      const t = z / depth; // 1 at bottom → subtle roundness on the lift
      meta.data.forEach((arc, i) => {
        const { innerRadius, outerRadius, startAngle, endAngle } = arc.getProps(
          ['innerRadius', 'outerRadius', 'startAngle', 'endAngle'],
          true,
        );
        const base = hexToRgb(colors[i % colors.length]);
        ctx.fillStyle = base ? shade(base, -0.14 - 0.12 * t) : 'rgba(20,20,28,1)';
        ctx.beginPath();
        ctx.ellipse(cx, cy + z, outerRadius, outerRadius * tilt, 0, startAngle, endAngle, false);
        ctx.ellipse(cx, cy + z, innerRadius, innerRadius * tilt, 0, endAngle, startAngle, true);
        ctx.closePath();
        ctx.fill();
      });
    }
    ctx.restore();

    // Squash the top faces into the matching ellipse (Chart draws them next).
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, tilt);
    ctx.translate(-cx, -cy);
  },
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.enabled === false) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta || meta.type !== 'doughnut' || meta.hidden || !meta.data.length) return;
    chart.ctx.restore();
  },
};

ChartJS.register(CategoryScale, LinearScale, RadialLinearScale, PointElement, LineElement, BarElement, ArcElement, RadarController, Tooltip, Legend, Filler, bar3d, doughnut3d);

export const PALETTE = ['#e6482e', '#2e86de', '#22c55e', '#f7b731', '#8854d0', '#0fb9b1'];

const BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#cbd5e1', font: { family: 'Inter' }, boxWidth: 12 } },
    tooltip: { titleColor: '#fff', bodyColor: '#cbd5e1', backgroundColor: 'rgba(15,13,26,.95)', borderColor: 'rgba(255,255,255,.1)', borderWidth: 1 },
  },
  scales: {
    x: { ticks: { color: '#94a3b8', font: { family: 'Inter' } }, grid: { color: 'rgba(255,255,255,.05)' } },
    y: { ticks: { color: '#94a3b8', font: { family: 'Inter' } }, grid: { color: 'rgba(255,255,255,.05)' } },
  },
};

function merge(extra) {
  const out = {
    ...BASE,
    ...extra,
    plugins: { ...BASE.plugins, ...(extra?.plugins || {}) },
  };
  // Replace scales when explicitly provided (e.g. doughnut passes {} for no axes).
  out.scales = extra && 'scales' in extra ? extra.scales : BASE.scales;
  return out;
}

export function LineChart({ labels, datasets, height = 240, options }) {
  const data = {
    labels,
    datasets: datasets.map((d, i) => ({
      tension: 0.35,
      borderColor: d.color || PALETTE[i % PALETTE.length],
      backgroundColor: (d.color || PALETTE[i % PALETTE.length]) + '33',
      pointRadius: 0,
      borderWidth: 2,
      fill: d.fill ?? true,
      ...d,
    })),
  };
  return (
    <div style={{ position: 'relative', height }}>
      <Line data={data} options={merge(options)} />
    </div>
  );
}

export function BarChart({ labels, datasets, height = 240, options, horizontal, flat }) {
  const data = {
    labels,
    datasets: datasets.map((d, i) => ({
      backgroundColor: d.color || PALETTE[i % PALETTE.length],
      borderRadius: flat ? 6 : 2,
      borderSkipped: false,
      ...d,
    })),
  };
  const three = flat ? { bar3d: { enabled: false } } : { bar3d: { enabled: true } };
  return (
    <div style={{ position: 'relative', height }}>
      <Bar data={data} options={merge({ indexAxis: horizontal ? 'y' : 'x', ...options, plugins: { ...three, ...(options?.plugins || {}) } })} />
    </div>
  );
}

export function DoughnutChart({ labels, values, height = 240, colors, options, flat }) {
  const data = {
    labels,
    datasets: [{ data: values, backgroundColor: colors || PALETTE, borderWidth: 0, spacing: 0 }],
  };
  const three = flat ? { doughnut3d: { enabled: false } } : { doughnut3d: { enabled: true } };
  return (
    <div style={{ position: 'relative', height }}>
      <Doughnut data={data} options={merge({ cutout: '58%', scales: {}, ...options, plugins: { ...three, ...(options?.plugins || {}) } })} />
    </div>
  );
}
