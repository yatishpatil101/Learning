import Icon from '../../../../components/Icon.jsx';
import { CHIP_ACCENT } from './helpers.js';

// One uniform stat chip used across the whole performance strip. Optional onClick
// turns it into a focusable button (e.g. Leads → jump to the leads tab).
export default function StatChip({ icon, value, label, tone = 'muted', onClick, title, ariaLabel }) {
  const accent = CHIP_ACCENT[tone] || CHIP_ACCENT.muted;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title}
      aria-label={onClick ? ariaLabel : undefined}
      className={
        'flex items-center gap-2 rounded-lg px-2 py-1 text-left ' +
        (onClick ? 'hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/50 transition' : '')
      }
    >
      <Icon name={icon} className={'w-4 h-4 flex-shrink-0 ' + accent} />
      <span className="leading-tight min-w-0">
        <span className={'block text-xs font-bold tabular-nums truncate ' + (tone === 'muted' ? 'text-white' : accent)}>{value}</span>
        <span className="block text-[10px] text-gray-500">{label}</span>
      </span>
    </Tag>
  );
}
