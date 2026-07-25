import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Copy, Check, X, MapPin, User, Calendar, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { findDuplicateClusters, resolveDuplicate, dismissDuplicate } from '../../../lib/data/properties-admin.js';
import { logAudit } from '../../../lib/mockApi.js';
import { useToast } from '../../../context/ToastContext.jsx';

const REASON_LABEL = {
  address: 'same address / electricity meter',
  image: 'matching photos',
  'address+image': 'same address and matching photos',
  'image+address': 'same address and matching photos',
};

const fmtDate = (ts) => {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
};

function ListingColumn({ listing: l, isNewest, onKeep, disabled }) {
  const addr = [l.flatNumber && `Flat ${l.flatNumber}`, l.society, l.pincode].filter(Boolean).join(' · ') || l.locality || '—';
  return (
    <div className="flex flex-1 min-w-[240px] flex-col rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
      <div className="relative h-32 bg-white/5">
        {l.image ? (
          <img src={l.image} alt={l.title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="grid h-full place-items-center text-gray-600 text-xs">No photo</div>
        )}
        {isNewest && <span className="absolute left-2 top-2 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold text-ink">NEWEST</span>}
        <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-mono text-gray-200">{l.id}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-white leading-tight">{l.title || 'Untitled listing'}</p>
          <Link to={`/property/${l.id}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-gray-400 hover:text-brand-teal" title="Open listing"><ArrowUpRight className="h-4 w-4" /></Link>
        </div>
        <p className="text-base font-extrabold text-brand-teal">{l.price || '—'}</p>
        <p className="flex items-center gap-1.5 text-xs text-gray-300"><User className="h-3.5 w-3.5 text-gray-500" /> {l.owner || 'Unknown'} · {l.ownerMobile || '—'}</p>
        <p className="flex items-start gap-1.5 text-xs text-gray-400"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" /> {addr}</p>
        <p className="flex items-center gap-1.5 text-xs text-gray-400"><Calendar className="h-3.5 w-3.5 text-gray-500" /> Listed {fmtDate(l.createdAt)}</p>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 capitalize text-gray-300">{l.status || 'pending'}</span>
          {l.verified && <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-emerald-300"><ShieldCheck className="h-3 w-3" /> Verified</span>}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onKeep(l.id)}
          className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-teal px-3 py-2 text-xs font-semibold text-ink transition hover:brightness-110 disabled:opacity-50"
        >
          <Check className="h-4 w-4" /> Keep this, archive the rest
        </button>
      </div>
    </div>
  );
}

export default function DuplicatesTab({ onRefresh }) {
  const { toast } = useToast();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

  // Recomputed whenever we act (tick) — clusters are derived from live DB state.
  const clusters = useMemo(() => findDuplicateClusters(), [tick]);

  const reload = () => { setTick((t) => t + 1); onRefresh?.(); };

  const keepOne = (cluster, keepId) => {
    if (busy) return;
    setBusy(true);
    const drops = cluster.listings.filter((l) => l.id !== keepId);
    drops.forEach((d) => resolveDuplicate(keepId, d.id));
    logAudit('Listings', `Merged ${drops.length} duplicate(s) into ${keepId}`);
    toast(`Kept ${keepId}, archived ${drops.length} duplicate${drops.length !== 1 ? 's' : ''}`, 'success');
    setBusy(false);
    reload();
  };

  const notDup = (cluster) => {
    if (busy) return;
    setBusy(true);
    dismissDuplicate(cluster.listings.map((l) => l.id));
    logAudit('Listings', `Dismissed duplicate cluster (${cluster.listings.map((l) => l.id).join(', ')})`);
    toast('Marked as not a duplicate', 'success');
    setBusy(false);
    reload();
  };

  return (
    <div>
      <p className="pn-card mb-4 flex items-start gap-2 px-4 py-3 text-xs text-gray-400">
        <Copy className="mt-0.5 h-4 w-4 shrink-0 text-brand-teal" />
        <span>Listings that look like the <strong className="text-gray-200">same physical property</strong> — matched by electricity meter / tax ID, structured address, or perceptually similar photos. Keep the best one and archive the rest, or dismiss if they're genuinely different.</span>
      </p>

      <div className="mb-4 flex items-center">
        <span className="text-sm text-gray-400">{clusters.length} duplicate cluster{clusters.length !== 1 ? 's' : ''}</span>
      </div>

      {clusters.length === 0 ? (
        <p className="pn-card p-8 text-center text-gray-500">No duplicate clusters — supply looks clean.</p>
      ) : (
        <div className="space-y-4">
          {clusters.map((cluster) => (
            <div key={cluster.id} className="pn-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-300">
                  <Copy className="h-3.5 w-3.5" /> {cluster.listings.length} listings · {REASON_LABEL[cluster.reason] || cluster.reason}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => notDup(cluster)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:bg-white/5 disabled:opacity-50"
                >
                  <X className="h-4 w-4" /> Not a duplicate
                </button>
              </div>
              <div className="flex flex-wrap gap-3">
                {cluster.listings.map((l, i) => (
                  <ListingColumn key={l.id} listing={l} isNewest={i === 0} onKeep={(id) => keepOne(cluster, id)} disabled={busy} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
