import Icon from '../../../../components/Icon.jsx';
import Menu from '../../../../components/ui/Menu.jsx';

// Render the overflow bucket: a single Delete collapses to an inline danger
// button (no menu for one action); multiple actions fold into a "More" menu.
export function renderOverflow(raw, navigate) {
  const items = raw.filter(Boolean);
  const actions = items.filter((it) => !it.divider);
  if (actions.length === 0) return null;
  if (actions.length === 1 && actions[0].tone === 'danger') {
    const it = actions[0];
    return (
      <button onClick={it.onClick} className="text-[11px] px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-300 font-semibold hover:bg-rose-500/20 inline-flex items-center gap-1 ml-0 sm:ml-auto transition-colors">
        <Icon name={it.icon} className="w-3.5 h-3.5" /> {it.label}
      </button>
    );
  }
  return <div className="ml-0 sm:ml-auto"><Menu items={items} onNavigate={navigate} ariaLabel="More actions" /></div>;
}
