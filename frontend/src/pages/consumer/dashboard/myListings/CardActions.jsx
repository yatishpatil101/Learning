import { Link } from 'react-router';
import Icon from '../../../../components/Icon.jsx';

const PRIMARY_TONE = {
  emerald: 'bg-emerald-500 hover:bg-emerald-600',
  teal: 'bg-brand-teal hover:bg-brand-teal-1',
};
const PRIMARY = 'text-xs px-3.5 py-1.5 rounded-lg font-semibold text-white inline-flex items-center justify-center gap-1.5 transition-colors min-h-[44px] sm:min-h-[36px] ';
const BASE = 'flex flex-col items-center justify-center gap-1 min-h-[56px] px-1.5 py-2 rounded-lg text-[11px] leading-tight text-center font-semibold transition-colors '
  + 'sm:flex-row sm:min-h-[36px] sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs';
const TONE = {
  default: 'bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white',
  danger: 'bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 sm:ml-auto',
};

function Action({ it }) {
  const cls = BASE + ' ' + TONE[it.tone === 'danger' ? 'danger' : 'default'] + (it.disabled ? ' opacity-50 cursor-not-allowed' : '');
  const body = <><Icon name={it.icon} className="w-4 h-4 flex-shrink-0 sm:w-3.5 sm:h-3.5" /><span>{it.label}</span></>;
  if (it.to && !it.disabled) return <Link to={it.to} className={cls}>{body}</Link>;
  return <button type="button" onClick={it.onClick} disabled={it.disabled} className={cls}>{body}</button>;
}

export default function CardActions({ primary, items }) {
  const actions = items.filter(Boolean);
  if (!primary && actions.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 p-3 border-t border-white/6 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 sm:px-4">
      {primary && (
        <button type="button" onClick={primary.onClick} className={PRIMARY + (PRIMARY_TONE[primary.tone] || PRIMARY_TONE.teal)}>
          <Icon name={primary.icon} className="w-3.5 h-3.5" /> {primary.label}
        </button>
      )}
      <div className="grid grid-cols-3 gap-1.5 sm:contents">
        {actions.map((it) => <Action key={it.label} it={it} />)}
      </div>
    </div>
  );
}
