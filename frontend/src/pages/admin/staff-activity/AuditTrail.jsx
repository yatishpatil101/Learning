import { useEffect, useState } from 'react';
import { Download, History } from 'lucide-react';
import { listAuditLog } from '../../../services/auditService.js';
import { exportCsv } from '../../../lib/csv.js';
import { useToast } from '../../../context/ToastContext.jsx';
import Table from '../../../components/ui/Table.jsx';

/** `from`/`to` lead because that pair is what an audit reader scans for first. */
export const describe = (metadata) => {
  if (!metadata || typeof metadata !== 'object') return '';
  const parts = [];
  if (metadata.from !== undefined || metadata.to !== undefined) {
    parts.push(`${metadata.from ?? '—'} → ${metadata.to ?? '—'}`);
  }
  for (const [k, v] of Object.entries(metadata)) {
    if (k === 'from' || k === 'to') continue;
    if (v === null || v === undefined || v === '') continue;
    parts.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  return parts.join(', ');
};

/** Shortened only visually; the full UUID remains in title text and CSV export. */
const shortId = (id) => {
  const s = String(id || '');
  return s.length > 8 ? `${s.slice(0, 8)}…` : s;
};

const when = (at) => new Date(at).toLocaleString('en-IN');

// Every actor, customers and system included; the staff feed is narrowed to back-office roles.
export default function AuditTrail() {
  const { toast } = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    listAuditLog({ size: 100 })
      .then((res) => { if (alive) setRows(res.items || []); })
      .catch(() => {
        if (!alive) return;
        setRows([]);
        setError('The audit trail could not be loaded. This is not an empty log — reload to try again.');
      });
    return () => { alive = false; };
  }, []);

  const exportAudit = () => {
    if (!rows?.length) { toast('Nothing to export'); return; }
    exportCsv(
      'draazy-audit-log.csv',
      ['When', 'Actor', 'Actor ID', 'Role', 'Action', 'Entity', 'Entity ID', 'Details'],
      rows.map((a) => [a.at, a.actorName, a.actor, a.actorRole, a.action, a.entity, a.entityId || '', describe(a.metadata)]),
    );
    toast('Audit log exported');
  };

  const columns = [
    { key: 'at', header: 'When', className: 'whitespace-nowrap text-gray-400', render: (a) => when(a.at) },
    {
      key: 'actor',
      header: 'Actor',
      render: (a) => (
        <span className="block">
          <span className="text-sm text-gray-200" title={a.actor}>{a.actorName === a.actor ? shortId(a.actor) : a.actorName}</span>
          {a.actorRole ? <span className="ml-2 text-[0.68rem] uppercase tracking-wide text-gray-500">{a.actorRole}</span> : null}
        </span>
      ),
    },
    { key: 'action', header: 'Action', className: 'text-xs text-indigo-300', render: (a) => a.action },
    {
      key: 'entity',
      header: 'Record',
      className: 'text-gray-300',
      render: (a) => (
        <span className="block">
          <span>{a.entity}</span>
          {a.entityId ? <span className="ml-2 font-mono text-xs text-gray-500" title={a.entityId}>{shortId(a.entityId)}</span> : null}
        </span>
      ),
    },
    { key: 'metadata', header: 'Details', className: 'text-xs text-gray-300', render: (a) => describe(a.metadata) || '—' },
  ];

  const card = (a) => (
    <div className="dz-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <span className="truncate text-sm font-semibold text-gray-200" title={a.actor}>{a.actorName === a.actor ? shortId(a.actor) : a.actorName} <span className="text-[0.68rem] uppercase text-gray-500">{a.actorRole}</span></span>
        <span className="shrink-0 text-xs text-gray-500">{when(a.at)}</span>
      </div>
      <div className="mt-2 text-xs text-indigo-300">{a.action}</div>
      <div className="mt-1 text-sm text-gray-300">
        {a.entity}
        {a.entityId ? <span className="ml-2 font-mono text-xs text-gray-500">{shortId(a.entityId)}</span> : null}
      </div>
      {describe(a.metadata) ? <div className="mt-1 text-xs text-gray-300">{describe(a.metadata)}</div> : null}
    </div>
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-gray-400">Latest 100 audited actions by anyone, including customers and the system. Read-only.</p>
        <button onClick={exportAudit} className="dz-btn dz-btn-ghost shrink-0"><Download className="h-4 w-4" /> Export CSV</button>
      </div>
      {error ? (
        <div role="alert" className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>
      ) : null}
      <Table
        columns={columns}
        rows={rows || []}
        rowKey={(a) => a.id}
        pageSize={12}
        label="entries"
        mobileCard={card}
        empty={rows === null ? 'Loading…' : (
          <span className="inline-flex items-center gap-2 text-gray-500"><History className="h-4 w-4" /> No audited actions recorded yet.</span>
        )}
      />
    </div>
  );
}
