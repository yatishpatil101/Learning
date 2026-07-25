import { Link } from 'react-router';
import Icon from '../../../../components/Icon.jsx';

// Shown when the owner has posted nothing yet: a friendly prompt to either post a
// property or value one privately first — both routes land back in this panel.
export default function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-teal/10">
        <Icon name="building-2" className="h-6 w-6 text-brand-teal-3" />
      </div>
      <div>
        <p className="text-white text-sm font-semibold">No properties yet</p>
        <p className="text-gray-500 text-xs mt-1 max-w-xs">Post a property to reach buyers and tenants, or value one privately first — both land here.</p>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <Link to="/list-property" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-teal-1">
          <Icon name="plus" className="h-3.5 w-3.5" /> Post your property
        </Link>
        <button type="button" onClick={() => { const t = document.getElementById('rent-o-meter'); if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); t.focus?.({ preventScroll: true }); } }} className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-4 py-2 text-xs font-semibold text-gray-300 transition hover:bg-white/10">
          <Icon name="gauge" className="h-3.5 w-3.5" /> Value it first
        </button>
      </div>
    </div>
  );
}
