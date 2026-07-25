import Icon from '../../../components/Icon.jsx';

export default function DocSection({ id, icon, iconCls, title, sub, count, total, open, onToggle, children }) {
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <button onClick={() => onToggle(id)} className="w-full flex items-center gap-3 p-5 text-left hover:bg-white/[0.02] transition">
        <div className={'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ' + (iconCls || 'bg-white/10')}><Icon name={icon} className="w-5 h-5" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-white text-sm font-semibold">{title}</p>
            {total > 0 && <span className={'text-[10px] px-2 py-0.5 rounded-full font-semibold ' + (count === total ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300')}>{count}/{total}</span>}
          </div>
          {sub && <p className="text-gray-500 text-xs mt-0.5">{sub}</p>}
        </div>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} className="w-4 h-4 text-gray-500 flex-shrink-0" />
      </button>
      {open && <div className="px-5 pb-5 border-t border-white/5 pt-4">{children}</div>}
    </div>
  );
}
