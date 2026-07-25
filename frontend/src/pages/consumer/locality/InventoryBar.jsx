import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { fmtRs } from './helpers.js';

export default function InventoryBar({ inv, activeName }) {
  return inv && inv.count ? (
    <Link to={`/listings?q=${encodeURIComponent(activeName)}`} className="glass-card rounded-2xl px-5 py-3.5 flex items-center justify-between gap-3 hover:border-teal-400/30 transition-all group">
      <span className="flex items-center gap-2.5 text-sm text-gray-200">
        <Icon name="home" className="w-4.5 h-4.5 text-teal-400" />
        <span><span className="font-bold text-white">{inv.count}</span> verified {inv.count > 1 ? 'homes' : 'home'} in {activeName}{inv.from < Infinity ? <> · from <span className="font-semibold text-white">{fmtRs(inv.from)}</span></> : null}</span>
      </span>
      <span className="text-teal-400 text-sm font-semibold inline-flex items-center gap-1 flex-shrink-0">View <Icon name="arrow-right" className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" /></span>
    </Link>
  ) : (
    <Link to="/list-property" className="glass-card rounded-2xl px-5 py-3.5 flex items-center justify-between gap-3 hover:border-teal-400/30 transition-all group">
      <span className="flex items-center gap-2.5 text-sm text-gray-300"><Icon name="plus-circle" className="w-4.5 h-4.5 text-teal-400" /> No live listings in {activeName} yet — be the first to list.</span>
      <span className="text-teal-400 text-sm font-semibold inline-flex items-center gap-1 flex-shrink-0">List free <Icon name="arrow-right" className="w-4 h-4" /></span>
    </Link>
  );
}
