import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { fmtINR } from '../../../lib/format.js';
import { getSavedProps } from '../../../lib/store.js';
import { listProperties } from '../../../services/propertyService.js';
import { Card, SectionHead } from './components.jsx';

export default function SavedPanel() {
  // The user's REAL saved properties (per-user store), resolved against the live
  // catalog — no seed placeholders masquerading as saved homes.
  const [saved, setSaved] = useState([]);
  useEffect(() => {
    let alive = true;
    const ids = getSavedProps();
    if (!ids.length) { setSaved([]); return undefined; }
    listProperties({ includeAllStatuses: true }, 'newest').then((all) => {
      if (!alive) return;
      const byId = new Map(all.map((p) => [p.id, p]));
      setSaved(ids.map((id) => byId.get(id)).filter(Boolean).slice(0, 6));
    });
    return () => { alive = false; };
  }, []);

  return (
    <Card className="p-6">
      <SectionHead icon="heart" iconCls="text-red-400" title="Saved Properties" action={<Link to="/saved" className="text-teal-400 text-sm font-medium hover:text-teal-300">View all →</Link>} />
      {saved.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-8">No saved properties yet. <Link to="/listings" className="text-teal-400 hover:text-teal-300">Browse listings</Link> and tap the heart to save homes here.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {saved.map((c) => (
            <Link key={c.id} to={`/property/${c.id}`} className="rounded-xl overflow-hidden border border-white/8 hover:border-teal-400/30 transition-all">
              <img src={c.img || c.image} alt={c.title} className="h-32 w-full object-cover" />
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
