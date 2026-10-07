/* Tiny inline SVG trend line; renders nothing for fewer than 2 distinct points so a flat KPI never shows a misleading line. */
export default function Sparkline({ data = [], color = 'rgb(var(--dz-c-teal-400))', width = 120, height = 28, className = '' }) {
  const nums = (data || []).map((n) => Number(n) || 0);
  const distinct = new Set(nums);
  if (nums.length < 2 || distinct.size < 2) return null;

  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const span = max - min || 1;
  const stepX = width / (nums.length - 1);
  const pts = nums.map((v, i) => {
    const x = i * stepX;
    // pad 2px top/bottom so the stroke isn't clipped at the extremes
    const y = height - 2 - ((v - min) / span) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lastX = (nums.length - 1) * stepX;
  const lastY = height - 2 - ((nums[nums.length - 1] - min) / span) * (height - 4);

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      role="presentation"
    >
      <polyline
        points={pts.join(' ')}
        fill="none"
        style={{ stroke: color }}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r="2" style={{ fill: color }} />
    </svg>
  );
}
