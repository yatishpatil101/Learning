import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { firstName, initial, roleLabel } from '../../../lib/auth.js';

/* Desktop sidebar navigation for the consumer Dashboard. Presentational only —
   all state and routing live in the Dashboard container and arrive via props. */
export default function DashboardSidebar({ tabs, activeTab, onSelect, attentionCounts, user, onLogout }) {
  const { t: tr } = useTranslation();
  return (
    <aside className="hidden lg:block">
      <div className="glass-card rounded-2xl p-4 sticky top-24">
        <div className="flex items-center gap-3 px-2 pb-4 mb-3 border-b border-white/8">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white font-bold">{initial(user)}</div>
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold truncate">{firstName(user)}</p>
            <p className="text-gray-500 text-xs">{roleLabel(user?.role)}</p>
          </div>
        </div>
        <nav className="space-y-1">
          {tabs.map((t) => (
            <button
              key={t.tab}
              onClick={() => onSelect(t.tab)}
              className={'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition ' + (activeTab === t.tab ? 'bg-brand-teal/15 text-brand-teal' : 'text-gray-400 hover:text-white hover:bg-white/5')}
            >
              <Icon name={t.icon} className="w-4 h-4" /> <span className="flex-1 text-left">{tr('dashboard.tabs.' + t.tab, { defaultValue: t.label })}</span>
              {attentionCounts[t.tab] > 0 && (
                <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-rose-500/20 px-1.5 text-[11px] font-bold text-rose-300">{attentionCounts[t.tab]}</span>
              )}
            </button>
          ))}
          <div className="h-px bg-white/8 my-2" />
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-rose-400 hover:bg-rose-500/10 transition"
          >
            <Icon name="log-out" className="w-4 h-4" /> {tr('dashboard.logout')}
          </button>
        </nav>
      </div>
    </aside>
  );
}
