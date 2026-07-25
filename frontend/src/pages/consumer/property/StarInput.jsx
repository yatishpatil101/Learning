import Icon from '../../../components/Icon.jsx';

export function StarInput({ value, onChange, size = 24 }) {
  return (
    <span className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" onClick={() => onChange(i)} className="p-0.5 leading-none">
          <Icon name="star" style={{ width: size, height: size }} className={i <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-600'} />
        </button>
      ))}
    </span>
  );
}
