import { useEffect, useMemo, useState } from 'react';
import { MapPin, Building2, Sparkles, BadgeCheck } from 'lucide-react';
import { logAudit } from '../../lib/mockApi.js';
import { fmtNum, classNames } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import { allLocalities } from '../../data/localities.js';
import {
  pendingCommunityLocalities, verifyCommunityLocality, dismissCommunityLocality, getLocalityLeads,
} from '../../lib/store.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';

const fmtDate = (ts) => { try { return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return ''; } };
const coordStr = (l) => (l.lat != null && l.lng != null ? `${(+l.lat).toFixed(4)}, ${(+l.lng).toFixed(4)}` : '—');

const Chip = ({ tone, icon, children }) => (
  <span className={classNames('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]', tone)}>{icon}{children}</span>
);

export default function AdminLocalities() {
  const { toast } = useToast();
  const { user } = useAuth();
  const by = (user && user.name) || 'Admin';
  const [tab, setTab] = useTabParam(['pending', 'directory'], 'pending');
  const [pending, setPending] = useState([]);
  const [bump, setBump] = useState(0);

  const reload = () => setPending(pendingCommunityLocalities());
  useEffect(() => { reload(); }, [bump]);

  const directory = useMemo(() => allLocalities(), [bump]);
  const leadBySlug = useMemo(() => {
    const m = {};
    getLocalityLeads().forEach((l) => { if (l.slug && !m[l.slug]) m[l.slug] = l; });
    return m;
  }, [bump]);
  const communityCount = directory.filter((l) => l.tier === 'community').length;

  const verify = (l) => {
    verifyCommunityLocality(l.slug, by);
    logAudit('Localities', `Verified community locality ${l.slug}`);
    setBump((n) => n + 1);
    toast(`“${l.name}” promoted to a curated locality`, 'success');
  };
  const dismiss = (l) => {
    dismissCommunityLocality(l.slug);
    logAudit('Localities', `Dismissed community locality ${l.slug}`);
    setBump((n) => n + 1);
    toast(`“${l.name}” dismissed`, 'info');
  };

  const actBtn = (label, tone, onClick) => (
    <button onClick={onClick} className={classNames('rounded-lg border px-2 py-1 text-xs', tone)}>{label}</button>
  );
  const teal = 'border-brand-teal/30 bg-brand-teal/10 text-brand-teal';
  const plain = 'border-white/10 bg-white/5 text-gray-200';

  const pendCols = [
    { key: 'name', header: 'Locality', render: (l) => (
      <div>
        <div className="font-semibold">{l.name}</div>
        <div className="text-xs text-gray-400">{l.slug} · {fmtDate(l.at)}</div>
      </div>
    ) },
    { key: 'coords', header: 'Pin', render: (l) => <span className="text-xs text-gray-300">{coordStr(l)}</span> },
    { key: 'pincode', header: 'PIN', render: (l) => <span className="text-xs text-gray-300">{l.pincode || '—'}</span> },
    { key: 'source', header: 'Source', render: (l) => (
      <Chip tone="bg-sky-500/15 text-sky-200" icon={<Building2 className="h-3 w-3" />}>{(leadBySlug[l.slug] && leadBySlug[l.slug].source) || l.source || 'listing'}</Chip>
    ) },
    { key: 'status', header: 'Status', render: () => <Badge status="pending">Community</Badge> },
    { key: 'actions', header: '', className: 'whitespace-nowrap', render: (l) => (
      <div className="flex flex-wrap gap-1">
        {actBtn('Verify', teal, () => verify(l))}
        {actBtn('Dismiss', plain, () => dismiss(l))}
      </div>
    ) },
  ];

  const dirCols = [
    { key: 'name', header: 'Locality', render: (l) => <div><div className="font-semibold">{l.name}</div><div className="text-xs text-gray-400">{l.slug}</div></div> },
    { key: 'coords', header: 'Pin', render: (l) => <span className="text-xs text-gray-300">{coordStr(l)}</span> },
    { key: 'tier', header: 'Tier', render: (l) => <Badge status={l.tier === 'community' ? 'pending' : 'approved'}>{l.tier === 'community' ? 'Community' : 'Curated'}</Badge> },
  ];

  /* Stacked-card fallback below `sm` (see Table.jsx). Both tabs share one renderer;
     Verify/Dismiss only appear on the pending tab, at 44px. */
  const localityCard = (l) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{l.name}</div>
          <div className="mt-0.5 text-xs text-gray-400">{l.slug}{tab === 'pending' ? ` · ${fmtDate(l.at)}` : ''}</div>
        </div>
        <div className="shrink-0">
          {tab === 'pending'
            ? <Badge status="pending">Community</Badge>
            : <Badge status={l.tier === 'community' ? 'pending' : 'approved'}>{l.tier === 'community' ? 'Community' : 'Curated'}</Badge>}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
        <span>{coordStr(l)}</span>
        {tab === 'pending' ? (<><span className="text-gray-600">·</span><span>PIN {l.pincode || '—'}</span></>) : null}
      </div>
      {tab === 'pending' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
          {actBtn('Verify', teal, () => verify(l))}
          {actBtn('Dismiss', plain, () => dismiss(l))}
        </div>
      ) : null}
    </div>
  );

  const KPIS = [
    { label: 'Localities', value: fmtNum(directory.length), icon: MapPin, tab: 'directory' },
    { label: 'Pending review', value: fmtNum(pending.length), icon: Sparkles, tab: 'pending' },
    { label: 'Curated', value: fmtNum(directory.length - communityCount), icon: BadgeCheck, tab: 'directory' },
  ];

  const rows = tab === 'pending' ? pending : directory;
  const cols = tab === 'pending' ? pendCols : dirCols;
  const empty = tab === 'pending' ? 'No community localities awaiting review. Auto-minted localities land here.' : 'No localities.';

  return (
    <div>
      <PageHeader title="Localities" subtitle="Review auto-minted localities and promote the real ones to the curated registry." />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {KPIS.map((k) => (
          <div key={k.label} onClick={() => setTab(k.tab)} className="pn-card p-4 cursor-pointer hover:bg-white/5">
            <div className="flex items-start justify-between">
              <div><div className="text-xs text-gray-400">{k.label}</div><div className="mt-1 text-2xl font-extrabold">{k.value}</div></div>
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-teal/15 text-brand-teal"><k.icon className="h-4 w-4" /></span>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
        {[['pending', 'Pending Review'], ['directory', 'Directory']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={classNames('flex-1 rounded-lg px-4 py-2 text-sm font-medium transition', tab === id ? 'bg-brand-teal text-ink' : 'text-gray-300 hover:text-white')}>
            {label}
          </button>
        ))}
      </div>

      <p className="mb-2 text-xs text-gray-400">
        {tab === 'pending'
          ? 'Localities auto-minted when a lister picked a place that matched no curated locality. Verify the real ones to promote them into the canonical registry; dismiss mistakes and duplicates.'
          : 'Every locality search, filters and SEO key off — curated seed set plus promoted community localities.'}
      </p>

      <Table columns={cols} rows={rows} rowKey={(l) => l.slug} pageSize={10} label={tab} empty={empty} mobileCard={localityCard} />
    </div>
  );
}
