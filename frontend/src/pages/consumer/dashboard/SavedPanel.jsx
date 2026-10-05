import { Link } from 'react-router';
import { fmtINR } from '../../../lib/format.js';
import { useSaved } from '../../../context/SavedContext.jsx';
import PropertyImage from '../../../components/ui/PropertyImage.jsx';
import { CARD_SIZES } from '../../../lib/imgSrcSet.js';
import { Card, SectionHead } from './components.jsx';

export default function SavedPanel() {
  // SavedContext already holds resolved rows; resolving ids here would mean fetching the whole catalogue.
  const { items, status, reload } = useSaved();
  const saved = items.slice(0, 6);

  return (
    <Card className="p-6">
      <SectionHead icon="heart" iconCls="text-red-400" title="Saved Properties" action={<Link to="/saved" className="tap-target inline-flex items-center text-teal-400 text-sm font-medium hover:text-teal-300">View all →</Link>} />
      {status === 'loading' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Loading saved homes">
          {[0, 1, 2].map((n) => (
            <div key={n} className="rounded-xl overflow-hidden border border-white/8 animate-pulse">
              <div className="h-32 w-full bg-white/10" />
              <div className="space-y-2 p-3">
                <span className="block h-3 w-2/3 rounded bg-white/10" />
                <span className="block h-3 w-1/3 rounded bg-white/5" />
              </div>
            </div>
          ))}
        </div>
      ) : status === 'error' ? (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-5 py-8 text-center">
          <p className="text-sm font-semibold text-white">Couldn't load your saved homes.</p>
          <button type="button" onClick={() => { void reload().catch(() => {}); }} className="mt-4 min-h-[44px] rounded-xl border border-white/10 px-5 text-sm font-semibold text-teal-200">Retry</button>
        </div>
      ) : saved.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-8">No saved properties yet. <Link to="/listings" className="text-teal-400 hover:text-teal-300">Browse listings</Link> and tap the heart to save homes here.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {saved.map((c) => (
            <Link key={c.id} to={`/property/${c.id}`} className="rounded-xl overflow-hidden border border-white/8 hover:border-teal-400/30 transition-all">
              <PropertyImage src={c.img || c.image} sizes={CARD_SIZES} alt={c.title} className="h-32 w-full object-cover" />
              <div className="p-3">
                <p className="text-white text-sm font-semibold truncate">{c.title}</p>
                <p className="text-teal-400 text-sm font-bold mt-0.5">{c.price ? (typeof c.price === 'number' ? fmtINR(c.price) + (c.deal === 'rent' ? '/mo' : '') : c.price) : ''}</p>
                <p className="text-gray-500 text-xs mt-1">{[c.bhk, c.locality].filter(Boolean).join(' · ')}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
