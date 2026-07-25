import { Link } from 'react-router';
import { fmtINR } from '../../../lib/format.js';
import { Card, SectionHead } from './components.jsx';

export default function RecentPanel({ recent }) {
  return (
    <Card className="p-6">
      <SectionHead icon="history" title="Recently Viewed" />
      {recent.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-8">Nothing viewed yet. <Link to="/listings" className="text-teal-400 hover:text-teal-300">Browse listings</Link> and the homes you open will show up here.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {recent.map((p) => (
            <Link key={p.id} to={`/property/${p.id}`} className="rounded-xl overflow-hidden border border-white/8 hover:border-teal-400/30 transition-all">
              <img src={p.image} alt={p.title} className="h-32 w-full object-cover" />
              <div className="p-3">
                <p className="text-white text-sm font-semibold truncate">{p.title}</p>
                <p className="text-teal-400 text-sm font-bold mt-0.5">{fmtINR(p.price)}{p.deal === 'rent' ? '/mo' : ''}</p>
                <p className="text-gray-500 text-xs mt-1">{p.locality}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
