import Icon from '../../../components/Icon.jsx';

export function Stars({ value, size = 16 }) {
  const v = Math.round(Number(value) || 0);
  return (
    <span className="inline-flex items-center" style={{ gap: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" style={{ width: size, height: size }} className={i <= v ? 'fill-amber-400 text-amber-400' : 'text-slate-600'} />
      ))}
    </span>
  );
}
