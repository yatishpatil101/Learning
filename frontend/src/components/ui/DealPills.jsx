import { classNames } from '../../lib/format.js';

const OPTIONS = [
  { value: '', label: 'All' },
  { value: 'buy', label: 'Buy' },
  { value: 'rent', label: 'Rent' },
];

export default function DealPills({ value, onChange }) {
  return (
    <div
      className="inline-flex items-center gap-0.5 px-1"
      style={{ height: 'var(--control-h, 40px)', borderRadius: 'var(--dd-trigger-radius, 999px)', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)' }}
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={classNames(
            'rounded-full px-3 py-1 text-sm font-medium transition',
            value === o.value ? 'bg-brand-teal text-ink' : 'text-gray-400 hover:text-white',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
