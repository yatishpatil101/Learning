import { useCallback, useEffect, useState } from 'react';
import { fmtNum } from '../../lib/format.js';
import { canWriteModule } from '../../lib/adminModules.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { listAdminLocalities, restoreLocality, retireLocality } from '../../services/localityService.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Loading from '../../components/ui/Loading.jsx';
import Modal from '../../components/ui/Modal.jsx';
import {
  BTN, Chips, ClearFilters, PageNav, QueuePanel, SearchBox, useClientPaging,
} from '../../components/admin/WorkQueue.jsx';

const coordStr = (l) => (l.lat != null && l.lng != null ? `${(+l.lat).toFixed(4)}, ${(+l.lng).toFixed(4)}` : '—');

const NOTE = 'Areas appear when someone picks them from Google Maps suggestions. Retiring an area stops new listings there; its existing listings and page stay. Restore reopens it.';

const stateBadge = (l) => <Badge status={l.archived ? 'rejected' : 'approved'}>{l.archived ? 'Retired' : 'Active'}</Badge>;

const consequence = (l) => (l.archived
  ? `${l.name} will be open for new listings again.`
  : `${l.name} will stop accepting new listings. ${l.liveListings ? `Its ${fmtNum(l.liveListings)} live ${l.liveListings === 1 ? 'listing stays' : 'listings stay'} online, and the area page stays.` : 'Its area page stays.'}`);

export default function AdminLocalities() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canWrite = canWriteModule(user, 'localities');
  const [directory, setDirectory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setDirectory(await listAdminLocalities());
    } catch (e) {
      toast(e?.message || 'Could not load localities', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { reload(); }, [reload]);

  const confirm = async () => {
    if (!target || busy) return;
    setBusy(true);
    try {
      await (target.archived ? restoreLocality : retireLocality)(target.slug);
      toast(target.archived ? `${target.name} restored` : `${target.name} retired`, 'success');
      setTarget(null);
      await reload();
    } catch (e) {
      toast(e?.message || 'Could not update that area', 'error');
    } finally {
      setBusy(false);
    }
  };

  const needle = q.trim().toLowerCase();
  const rows = directory.filter((l) => (!status || (status === 'retired') === !!l.archived)
    && (!needle || [l.name, l.slug].join(' ').toLowerCase().includes(needle)));
  const page = useClientPaging(rows, 20, `${status}|${q}`);

  const action = (l) => (canWrite ? (
    <button type="button" onClick={() => setTarget(l)} className={l.archived ? BTN.primary : BTN.danger} aria-label={`${l.archived ? 'Restore' : 'Retire'} ${l.name}`}>
      {l.archived ? 'Restore' : 'Retire'}
    </button>
  ) : null);

  const columns = [
    { key: 'name', header: 'Locality', render: (l) => <div><div className="font-semibold">{l.name}</div><div className="text-xs text-gray-400">{l.slug}</div></div> },
    { key: 'coords', header: 'Pin', render: (l) => <span className="text-xs text-gray-300">{coordStr(l)}</span> },
    { key: 'listings', header: 'Live listings', render: (l) => <span className="text-xs text-gray-300">{fmtNum(l.liveListings)}</span> },
    { key: 'archived', header: 'Status', render: stateBadge },
    ...(canWrite ? [{ key: 'action', header: 'Action', render: action }] : []),
  ];
  const card = (l) => (
    <div className="dz-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{l.name}</div>
          <div className="mt-0.5 text-xs text-gray-400">{l.slug}</div>
        </div>
        <div className="shrink-0">{stateBadge(l)}</div>
      </div>
      <div className="mt-2.5 text-xs text-gray-400">{coordStr(l)} · {fmtNum(l.liveListings)} live listings</div>
      {canWrite ? <div className="mt-2.5">{action(l)}</div> : null}
    </div>
  );

  const count = (pred) => fmtNum(directory.filter(pred).length);
  const statusChips = [
    { value: '', label: `All ${fmtNum(directory.length)}` },
    { value: 'active', label: `Active ${count((l) => !l.archived)}` },
    { value: 'retired', label: `Retired ${count((l) => l.archived)}` },
  ];

  return (
    <div>
      <PageHeader title="Localities" subtitle="Every area buyers can search, and how many live listings each has." />

      <QueuePanel
        note={NOTE}
        toolbar={(
          <>
            <SearchBox value={q} onChange={setQ} placeholder="Locality or slug" label="Search localities" />
            <Chips label="Status" options={statusChips} value={status} onChange={setStatus} />
            {status || q ? <ClearFilters onClick={() => { setStatus(''); setQ(''); }} /> : null}
            <div className="ml-auto"><PageNav {...page.paging} /></div>
          </>
        )}
        footer={page.paging.pageCount > 1 ? <PageNav {...page.paging} /> : null}
      >
        {loading ? <Loading label="Loading localities…" /> : null}
        {!loading ? (
          <div className="p-3">
            <Table columns={columns} rows={page.items} rowKey={(l) => l.slug} label="localities" empty={status || q ? 'No localities match these filters.' : 'No localities.'} mobileCard={card} />
          </div>
        ) : null}
      </QueuePanel>

      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title={target?.archived ? 'Restore area' : 'Retire area'}
        footer={(
          <>
            <button type="button" onClick={() => setTarget(null)} className="dz-btn dz-btn-ghost">Cancel</button>
            <button type="button" onClick={confirm} disabled={busy} className="dz-btn dz-btn-primary disabled:opacity-50">{busy ? 'Working…' : target?.archived ? 'Restore' : 'Retire'}</button>
          </>
        )}
      >
        {target ? <p className="text-sm text-gray-300">{consequence(target)}</p> : null}
      </Modal>
    </div>
  );
}