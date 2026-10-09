import { useNavigate } from 'react-router';

// Equirectangular at Pune's latitude (cos 18.5° ≈ 0.948), so a kilometre is the same length both ways.
const W = 400;
const H = 250;
const x = (lng) => (lng - 73.71) * 1600;
const y = (lat) => (18.62 - lat) * 1688;

const CENTRE = { x: x(73.85), y: y(18.525) };

// Hand-traced from the river courses; good to a few hundred metres at this scale.
const RIVERS = [
  'M 0 82 C 30 74, 70 54, 100 56 S 140 80, 160 92 S 190 80, 205 86 S 228 128, 240 143',
  'M 150 250 C 165 222, 178 205, 190 196 S 222 165, 240 143',
  'M 240 143 C 255 132, 268 126, 285 124 S 320 116, 336 128 S 358 150, 372 152 S 395 150, 400 150',
];

const LABEL = {
  above: { dx: 0, dy: -11, anchor: 'middle' },
  below: { dx: 0, dy: 19, anchor: 'middle' },
  left: { dx: -10, dy: 4, anchor: 'end' },
  right: { dx: 10, dy: 4, anchor: 'start' },
};
const SIDE = {
  hinjawadi: 'below', wakad: 'above', 'pimple-saudagar': 'right', balewadi: 'right', baner: 'left', aundh: 'right',
  kothrud: 'right', 'koregaon-park': 'above', 'viman-nagar': 'above', kharadi: 'above', magarpatta: 'left', hadapsar: 'below',
};

export const ZONE_TONE = {
  west: { fill: 'fill-teal-400', text: 'text-teal-400', bg: 'bg-teal-400' },
  east: { fill: 'fill-amber-400', text: 'text-amber-400', bg: 'bg-amber-400' },
};

const HALO = { stroke: 'rgb(var(--dz-c-ink-card))', strokeWidth: 4, strokeLinejoin: 'round', paintOrder: 'stroke' };

export default function PuneMap({ guides, active, onActive }) {
  const navigate = useNavigate();
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Map of Pune showing ${guides.length} localities`} className="block h-auto w-full select-none">
      <defs>
        <pattern id="pune-grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" className="fill-gray-500" opacity="0.35" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#pune-grid)" />
      <circle cx={CENTRE.x} cy={CENTRE.y} r="62" className="fill-none stroke-gray-500" strokeOpacity="0.35" strokeDasharray="2 4" />
      {RIVERS.map((d) => <path key={d} d={d} className="fill-none stroke-sky-400" strokeOpacity="0.45" strokeWidth="3" strokeLinecap="round" />)}
      <rect x={CENTRE.x - 3.5} y={CENTRE.y - 3.5} width="7" height="7" rx="1" transform={`rotate(45 ${CENTRE.x} ${CENTRE.y})`} className="fill-gray-400" />
      <text x={CENTRE.x - 9} y={CENTRE.y + 4} textAnchor="end" className="fill-gray-400 text-[11px] font-medium max-sm:text-[13px]" style={HALO}>City centre</text>

      {guides.map((g) => {
        const px = x(g.lng);
        const py = y(g.lat);
        const label = LABEL[SIDE[g.slug] || 'right'];
        const on = active === g.slug;
        return (
          <g
            key={g.slug}
            className="cursor-pointer"
            onClick={() => navigate(`/locality/${g.slug}`)}
            onMouseEnter={() => onActive(g.slug)}
            onMouseLeave={() => onActive('')}
          >
            <circle cx={px} cy={py} r="14" fill="transparent" />
            <circle cx={px} cy={py} r={on ? 11 : 8} className={`${ZONE_TONE[g.zone].fill} motion-safe:transition-all motion-safe:duration-200`} opacity={on ? 0.35 : 0.18} />
            <circle cx={px} cy={py} r="4.5" className={ZONE_TONE[g.zone].fill} />
            <text
              x={px + label.dx}
              y={py + label.dy}
              textAnchor={label.anchor}
              className={`fill-current text-[12px] max-sm:text-[15px] ${on ? 'font-extrabold text-white' : 'font-semibold text-gray-300'}`}
              style={HALO}
            >
              {g.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
