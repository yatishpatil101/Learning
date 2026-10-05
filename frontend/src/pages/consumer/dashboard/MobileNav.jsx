import Icon from '../../../components/Icon.jsx';
import { SubNav } from './components.jsx';

/* A single row shows the current section; tapping opens a bottom sheet listing every section with its attention
   badge, so no pending work is hidden behind a horizontal scroll. */
const groupCount = (group, attentionCounts) =>
  group.sections.reduce((sum, section) => sum + (attentionCounts[section.tab] || 0), 0);

  // Sum of pending items across sections other than the current one — the badge
  // on the collapsed switcher tells the user "there's work waiting elsewhere".
const activeGroupOf = (groups, activeTab) =>
  groups.find((group) => group.sections.some((section) => section.tab === activeTab)) || groups[0];

// While the sheet is open, behave like a modal and return focus only after an actual close.
export default function MobileNav({ groups = [], activeTab, onSelect, attentionCounts = {}, loading = false, labelFor }) {
  if (loading || !groups.length) {
    return (
      <div className="sticky top-16 z-30 -mx-4 mb-5 border-y border-white/10 bg-ink/95 px-4 py-2 backdrop-blur lg:hidden sm:-mx-6 sm:px-6">
        <div className="grid grid-cols-4 gap-1.5">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 rounded-xl skeleton" />)}
        </div>
      </div>
    );
  }

  const activeGroup = activeGroupOf(groups, activeTab);
  const subItems = activeGroup.sections.map((section) => ({
    key: section.tab,
    label: labelFor(section),
    icon: section.icon,
    count: attentionCounts[section.tab] || 0,
  }));

  return (
    <div className="sticky top-16 z-30 -mx-4 mb-5 border-y border-white/10 bg-ink/95 px-4 py-2 backdrop-blur lg:hidden sm:-mx-6 sm:px-6" data-testid="dashboard-mobile-nav">
      <div
        role="tablist"
        aria-label="Dashboard sections"
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }}
      >
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, */}
        {/* jsx-a11y/no-noninteractive-element-interactions */}
        {groups.map((group) => {
          const isActive = group.id === activeGroup?.id;
          const count = groupCount(group, attentionCounts);
          const firstSection = group.sections[0];
          return (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? 'page' : undefined}
              data-dashboard-group={group.id}
              onClick={() => onSelect(firstSection.tab)}
              className={
                'relative flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-center text-[11px] font-semibold leading-tight transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 ' +
                (isActive ? 'bg-brand-teal/15 text-brand-teal ring-1 ring-inset ring-brand-teal/35' : 'bg-white/[0.04] text-gray-300 hover:bg-white/[0.07] hover:text-white')
              }
            >
              <Icon name={group.icon} className="h-4 w-4 flex-shrink-0" />
              <span className="line-clamp-2 max-w-full">{group.label}</span>
              {isActive ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-teal" /> : null}
              {count > 0 ? (
                <span className="absolute right-1 top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-4 text-white">
                  {count > 9 ? '9+' : count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {subItems.length > 1 ? (
        <div className="mt-2" data-testid="dashboard-section-subnav">
          <SubNav items={subItems} active={activeTab} onChange={onSelect} variant="underline" />
        </div>
      ) : null}
    </div>
  );
}
