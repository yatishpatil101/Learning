import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Check, Clock, Download, Flag, Lock, ShieldAlert, ShieldCheck, Undo2, X, XCircle } from 'lucide-react';
import { listReferrals, mutateDb, logAudit } from '../../lib/mockApi.js';
import { creditReferrer } from '../../lib/store/referrals.js';
import { fmtNum, classNames } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { useToast } from '../../context/ToastContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Loading from '../../components/ui/Loading.jsx';

const RISK = { high: 'text-red-300', medium: 'text-amber-300', low: 'text-emerald-300' };
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN') : '—');

/* Background-check signals. goodWhenTrue=true → green when present; false → red when present. */
const SIGNALS = [
  ['aadhaarVerified', 'Aadhaar verified', true],
  ['aadhaarUnique', 'Aadhaar unique', true],
  ['activated', 'Activated', true],
  ['sameDevice', 'Same device', false],
  ['sameIp', 'Same IP', false],
  ['velocityHigh', 'High velocity', false],
];

/* A referral can only be approved once the referred tenant is Aadhaar-verified AND that Aadhaar is unique. */
function canQualify(r) {
  return !!(r.aadhaarVerified && r.aadhaarUnique);
}

function setReferralStatus(id, status) {
  mutateDb((db) => { const r = (db.referrals || []).find((x) => x.id === id); if (r) { r.status = status; r.handledAt = Date.now(); } });
}

export default function OpsReferrals() {
  const { toast } = useToast();
  const [all, setAll] = useState(null);
  const [tab, setTab] = useState('pending');

  const reload = () => listReferrals().then((r) => setAll(r));
  useEffect(() => { let alive = true; reload().then(() => !alive); return () => { alive = false; }; }, []); // eslint-disable-line

  const doAction = (r, act) => {
    if (act === 'approve') {
      if (!canQualify(r)) { toast('Blocked — needs Aadhaar verification + uniqueness', 'error'); return; }
      // Actually grant it: queue a credit the referrer collects on next sign-in.
      // 'owner' channel unlocks a free listing slot, 'seeker' unlocks +15 contacts.
      creditReferrer({ mobile: r.referrerMobile, kind: r.channel === 'owner' ? 'listing' : 'join', dedupeKey: 'ops:' + r.id });
      setReferralStatus(r.id, 'rewarded'); logAudit('Referrals', `Approved ${r.id}`); toast('Approved — reward granted');
    } else if (act === 'reject') {
      setReferralStatus(r.id, 'rejected'); logAudit('Referrals', `Rejected ${r.id}`); toast('Rejected', 'error');
    } else if (act === 'clawback') {
      setReferralStatus(r.id, 'rejected'); logAudit('Referrals', `Clawback ${r.id}`); toast('Reward clawed back', 'error');
    }
    reload();
  };

  const stats = useMemo(() => {
    const list = all || [];
    return {
      pending: list.filter((r) => r.status === 'pending').length,
      flagged: list.filter((r) => r.status === 'flagged').length,
      qualified: list.filter((r) => r.status === 'qualified' || r.status === 'rewarded').length,
      rejected: list.filter((r) => r.status === 'rejected').length,
    };
  }, [all]);

  const rows = useMemo(() => {
    const list = all || [];
    if (tab === 'pending') return list.filter((r) => r.status === 'pending');
    if (tab === 'flagged') return list.filter((r) => r.status === 'flagged');
    if (tab === 'qualified') return list.filter((r) => r.status === 'qualified' || r.status === 'rewarded');
    return list;
  }, [all, tab]);

  if (!all) return <Loading />;

  const doExport = () => exportCsv('punenest-referrals.csv',
    ['ID', 'Referrer', 'Referred', 'Channel', 'Reward', 'Risk', 'Status', 'Aadhaar verified', 'Aadhaar unique', 'Same device', 'Same IP', 'High velocity'],
    rows.map((r) => [r.id, r.referrer, r.referred, r.channel, r.reward, r.risk, r.status, r.aadhaarVerified ? 'Yes' : 'No', r.aadhaarUnique ? 'Yes' : 'No', r.sameDevice ? 'Yes' : 'No', r.sameIp ? 'Yes' : 'No', r.velocityHigh ? 'Yes' : 'No']));

  const STAT_TILES = [
    { label: 'Pending', value: stats.pending, icon: Clock, tab: 'pending' },
    { label: 'Flagged', value: stats.flagged, icon: Flag, tab: 'flagged' },
    { label: 'Qualified', value: stats.qualified, icon: BadgeCheck, tab: 'qualified' },
    { label: 'Rejected', value: stats.rejected, icon: XCircle, tab: null },
  ];

  const TABS = [['pending', 'Pending', stats.pending], ['flagged', 'Flagged', stats.flagged], ['qualified', 'Qualified', stats.qualified], ['all', 'All', all.length]];

  return (
    <div>
      <PageHeader title="Referral Verification" subtitle="Keep referrals genuine — verify before reward." actions={<button onClick={doExport} className="pn-btn pn-btn-ghost"><Download className="h-4 w-4" />Export CSV</button>} />

      {/* 4 stat cards */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STAT_TILES.map((s) => (
          <div key={s.label} onClick={s.tab ? () => setTab(s.tab) : undefined} className={classNames('pn-card p-4', s.tab && 'cursor-pointer hover:bg-white/5')}>
            <div className="flex items-start justify-between">
              <div><div className="text-xs text-gray-400">{s.label}</div><div className="mt-1 text-2xl font-extrabold">{fmtNum(s.value)}</div></div>
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-teal/15 text-brand-teal"><s.icon className="h-4 w-4" /></span>
            </div>
          </div>
        ))}
      </div>

      {/* Mandatory-Aadhaar banner */}
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-brand-teal/25 bg-brand-teal/5 p-4 text-sm text-gray-300">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-teal" />
        <div>A referral is paid only after background checks pass. <b className="text-gray-200">Mandatory:</b> the referred tenant must be <b className="text-gray-200">Aadhaar-verified</b> and that Aadhaar must be <b className="text-gray-200">unique</b>. Self/duplicate-device and high-velocity referrals are flagged for review.</div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/5 p-1 w-full sm:w-max">
        {TABS.map(([id, label, count]) => (
          <button key={id} onClick={() => setTab(id)} className={classNames('rounded-lg px-3 py-1.5 text-sm font-medium transition', tab === id ? 'bg-brand-teal text-ink' : 'text-gray-300 hover:bg-white/5')}>
            {label} <span className="opacity-70">({fmtNum(count)})</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="pn-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs font-semibold text-gray-400">
              <th className="p-3">ID</th><th className="p-3">Referrer → Referred</th><th className="p-3">Reward</th><th className="p-3">Background checks</th><th className="p-3">Risk</th><th className="p-3">Status</th><th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((r) => {
              const canApprove = canQualify(r);
              return (
                <tr key={r.id} className="border-t border-white/5 align-top">
                  <td className="p-3 font-mono text-xs text-gray-400">{r.id}</td>
                  <td className="p-3"><div className="font-semibold">{r.referrer} <span className="text-gray-500">→</span> {r.referred}</div><div className="text-xs text-gray-400">{r.channel === 'owner' ? 'Owner referral' : 'Seeker referral'}</div></td>
                  <td className="p-3 text-gray-300">{r.reward}</td>
                  <td className="p-3">
                    <div className="flex max-w-xs flex-wrap gap-1">
                      {SIGNALS.map(([key, label, goodWhenTrue]) => {
                        const on = !!r[key];
                        const good = goodWhenTrue ? on : !on;
                        return <span key={key} className={classNames('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px]', good ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-red-400/30 bg-red-500/10 text-red-300')}>{good ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}{label}</span>;
                      })}
                    </div>
                  </td>
                  <td className="p-3"><span className={classNames('font-medium capitalize', RISK[r.risk])}>{r.risk}</span></td>
                  <td className="p-3"><Badge status={r.status} /></td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {(r.status === 'pending' || r.status === 'flagged') ? <>
                        {canApprove
                          ? <button onClick={() => doAction(r, 'approve')} className="inline-flex items-center gap-1 rounded-lg border border-brand-teal/30 bg-brand-teal/10 px-2 py-1 text-xs text-brand-teal"><Check className="h-3 w-3" />Approve</button>
                          : <button disabled title="Aadhaar verify + uniqueness required" className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-500 opacity-50"><Lock className="h-3 w-3" />Blocked</button>}
                        <button onClick={() => doAction(r, 'reject')} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5"><X className="h-3 w-3" />Reject</button>
                      </> : (r.status === 'qualified' || r.status === 'rewarded') ? (
                        <button onClick={() => doAction(r, 'clawback')} className="inline-flex items-center gap-1 rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-300"><Undo2 className="h-3 w-3" />Clawback</button>
                      ) : <span className="text-xs text-gray-500">—</span>}
                    </div>
                  </td>
                </tr>
              );
            }) : (
              <tr><td colSpan={7} className="p-10 text-center text-sm text-gray-500">No referrals here 🎁</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
