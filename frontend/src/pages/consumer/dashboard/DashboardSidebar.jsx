import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { firstName, initial, roleLabel } from '../../../lib/auth.js';

/* Desktop sidebar navigation for the consumer Dashboard. */
const groupCount = (group, attentionCounts) =>
  group.sections.reduce((sum, section) => sum + (attentionCounts[section.tab] || 0), 0);

const activeGroupOf = (groups, activeTab) =>
  groups.find((group) => group.sections.some((section) => section.tab === activeTab)) || groups[0];

export default function DashboardSidebar({ groups = [], activeTab, onSelect, attentionCounts = {}, user, onLogout, loading = false }) {
  const { t: tr } = useTranslation();
  const activeGroup = activeGroupOf(groups, activeTab);

  return (
    <aside className="hidden lg:block">
      <div className="glass-card sticky top-24 rounded-2xl p-4">
        <div className="mb-3 flex items-center gap-3 border-b border-white/8 px-2 pb-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-600 font-bold text-white">{initial(user)}</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{firstName(user)}</p>
            <p className="text-xs text-gray-500">{roleLabel(user?.role)}</p>
          </div>
        </div>
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl skeleton" />)}
          </div>
        ) : (
          <nav className="space-y-3" aria-label="Dashboard sections">
            {groups.map((group) => {
              const groupActive = group.id === activeGroup?.id;
              const count = groupCount(group, attentionCounts);
              return (
                <div key={group.id} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => onSelect(group.sections[0].tab)}
                    aria-current={groupActive ? 'page' : undefined}
                    className={
                      'flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ' +
                      (groupActive ? 'bg-brand-teal/15 text-brand-teal' : 'text-gray-300 hover:bg-white/5 hover:text-white')
                    }
                  >
                    <Icon name={group.icon} className="h-4 w-4" />
                    <span className="min-w-0 flex-1 text-left">{group.label}</span>
                    {count > 0 ? (
                      <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-rose-500/20 px-1.5 text-[11px] font-bold text-rose-300">{count}</span>
                    ) : null}
                  </button>
                  {group.sections.length > 1 ? (
                    <div className="space-y-0.5 pl-8">
                      {group.sections.map((section) => (
                        <button
                          key={section.tab}
                          type="button"
                          onClick={() => onSelect(section.tab)}
                          aria-current={activeTab === section.tab ? 'page' : undefined}
                          className={
                            'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium transition ' +
                            (activeTab === section.tab ? 'bg-white/8 text-white' : 'text-gray-500 hover:bg-white/5 hover:text-gray-200')
                          }
                        >
                          <span className="min-w-0 flex-1 truncate">{tr('dashboard.tabs.' + section.tab, { defaultValue: section.label })}</span>
                          {(attentionCounts[section.tab] || 0) > 0 ? (
                            <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-rose-500/20 px-1.5 text-[10px] font-bold text-rose-300">{attentionCounts[section.tab]}</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div className="h-px bg-white/8" />
            <button
              type="button"
              onClick={onLogout}
              className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-rose-400 transition hover:bg-rose-500/10"
            >
              <Icon name="log-out" className="h-4 w-4" /> {tr('dashboard.logout')}
            </button>
          </nav>
        )}
      </div>
    </aside>
  );
}
