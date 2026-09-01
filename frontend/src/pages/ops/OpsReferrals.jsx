import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Check, Clock, Download, Flame, Lock, RefreshCw, ShieldAlert, ShieldCheck, Undo2, X, XCircle } from 'lucide-react';
import { approveReferral, clawbackReferral, listReferralQueue, rejectReferral } from '../../services/referralService.js';
import { isHttpDomain } from '../../services/config.js';
import { fmtNum, classNames } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { useToast } from '../../context/ToastContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Loading from '../../components/ui/Loading.jsx';

const RISK = { high: 'text-red-300', medium: 'text-amber-300', low: 'text-emerald-300' };
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN') : '—');

/**
 * How many rows the desk pulls.
 *
 * A window, not a page: the tabs and stat tiles count what is in hand, and the banner above the
 * table says so when the server's total is larger. A fraud queue this size is a queue with a
 * problem, and a desk should be told rather than shown the first hundred as if that were all.
 */
const WINDOW = 100;

/* Background-check signals. goodWhenTrue=true → green when present; false → red when present. */
const SIGNALS = [
  ['aadhaarVerified', 'Aadhaar verified', true],
  ['aadhaarUnique', 'Aadhaar unique', true],
  ['activated', 'Activated', true],
  ['sameDevice', 'Same device', false],
  ['sameIp', 'Same IP', false],
  ['velocityHigh', 'High velocity', false],
];

/**
 * Whether Approve is offered.
 *
 * A **mirror** of `ReferralService.approve`, not the rule itself — that distinction is the whole
 * point of wave 2c here. Until then this function was the only thing standing between an unverified
 * referee and a released reward, while the endpoint would have paid anyone who called it directly.
 * Now the server refuses with a sentence and this only spares the desk a pointless round trip.
 *
 * `aadhaarUnique` is checked alongside `aadhaarVerified` because the desk's banner promises both,
 * even though the server derives the second from the first (a second account cannot verify an
 * identity hash the platform already holds).
 */
function canQualify(r) {
  return !!(r.aadhaarVerified && r.aadhaarUnique);
}

/**
 * The tabs, and the query each one asks.
 *
 * `flagged` is gone. There is no such status — `ReferralStatuses` is
 * `pending | qualified | rewarded | rejected | clawed-back` — and risk is a separate field, so the
 * tab would have sat permanently empty while telling a fraud desk there was nothing suspicious.
 * **High risk** asks the question it was reaching for, using a filter the server already has.
 */
const TABS = [
  { id: 'pending', label: 'Pending', match: (r) => r.status === 'pending' || r.status === 'qualified' },
  { id: 'high-risk', label: 'High risk', match: (r) => r.risk === 'high' },
  { id: 'rewarded', label: 'Rewarded', match: (r) => r.status === 'rewarded' },
  { id: 'all', label: 'All', match: () => true },
];

export default function OpsReferrals() {
  const { toast } = useToast();
  const liveApi = isHttpDomain('referral');
  const [state, setState] = useState({ status: liveApi ? 'loading' : 'offline', items: [], total: 0, error: '' });
  const [tab, setTab] = useState('pending');
  const [nonce, setNonce] = useState(0);

  const load = useCallback(() => {
    if (!liveApi) return;
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    listReferralQueue({ size: WINDOW })
      .then((page) => setState({ status: 'ready', items: page.items, total: page.total, error: '' }))
      .catch((e) => setState({ status: 'error', items: [], total: 0, error: e.message || 'Could not read the queue.' }));
  }, [liveApi]);

  useEffect(() => { load(); }, [load, nonce]);

  const doAction = async (r, act) => {
    try {
      if (act === 'approve') {
        await approveReferral(r.id);
        toast('Approved — reward released');
      } else if (act === 'reject') {
        await rejectReferral(r.id);
        toast('Rejected', 'error');
      } else {
        await clawbackReferral(r.id);
        toast('Reward clawed back', 'error');
      }
      setNonce((n) => n + 1);
    } catch (e) {
      // The server's own sentence. Its refusals name the reason - an unverified referee, or a
      // state this decision cannot be made from - and paraphrasing them here would lose that.
      toast(e.message || 'That decision was refused.', 'error');
    }
  };

  const stats = useMemo(() => {
    const list = state.items;
    return {
      pending: list.filter((r) => r.status === 'pending' || r.status === 'qualified').length,
      highRisk: list.filter((r) => r.risk === 'high').length,
      rewarded: list.filter((r) => r.status === 'rewarded').length,
      refused: list.filter((r) => r.status === 'rejected' || r.status === 'clawed-back').length,
    };
  }, [state.items]);

  const rows = useMemo(() => {
    const match = TABS.find((t) => t.id === tab)?.match || (() => true);
    return state.items.filter(match);
  }, [state.items, tab]);

  if (state.status === 'offline') {
    return (
      <div>
        <PageHeader title="Referral Verification" subtitle="Keep referrals genuine — verify before reward." />
        <div className="pn-card flex items-start gap-3 p-6 text-sm text-gray-300">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <div>
            <div className="font-semibold text-gray-100">This desk needs the live API.</div>
            <p className="mt-1 max-w-2xl text-gray-400">
              Referral decisions release money, and the offline store disagrees with the server about
              what a referral is — it knows a <code>flagged</code> status the server does not,
              carries phone numbers the server masks, and grants its reward by looking the referrer
              up by that same number, which the wire no longer carries.
              A desk shown that data would be approving something else. Enable the
              <code className="mx-1">referral</code> domain to work the queue.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div>
        <PageHeader title="Referral Verification" subtitle="Keep referrals genuine — verify before reward." />
        <div className="pn-card flex items-start gap-3 p-6 text-sm text-gray-300">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
          <div>
            <div className="font-semibold text-gray-100">The queue could not be read.</div>
            <p className="mt-1 max-w-2xl text-gray-400">{state.error}</p>
            <button onClick={() => setNonce((n) => n + 1)} className="pn-btn pn-btn-ghost mt-3">
              <RefreshCw className="h-4 w-4" />Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'loading') return <Loading />;

  const windowed = state.total > state.items.length;

  const doExport = () => exportCsv('punenest-referrals.csv',
    ['ID', 'Referrer', 'Referred', 'Channel', 'Reward', 'Amount', 'Risk', 'Status', 'Aadhaar verified', 'Aadhaar unique', 'Same device', 'Same IP', 'High velocity', 'Redeemed'],
    rows.map((r) => [r.id, r.referrer, r.referred, r.channel, r.reward, r.rewardAmount, r.risk, r.status, r.aadhaarVerified ? 'Yes' : 'No', r.aadhaarUnique ? 'Yes' : 'No', r.sameDevice ? 'Yes' : 'No', r.sameIp ? 'Yes' : 'No', r.velocityHigh ? 'Yes' : 'No', fmtDate(r.at)]));

  const STAT_TILES = [
    { label: 'Pending', value: stats.pending, icon: Clock, tab: 'pending' },
    { label: 'High risk', value: stats.highRisk, icon: Flame, tab: 'high-risk' },
    { label: 'Rewarded', value: stats.rewarded, icon: BadgeCheck, tab: 'rewarded' },
    { label: 'Refused', value: stats.refused, icon: XCircle, tab: null },
  ];

  return (
    <div>
      <PageHeader title="Referral Verification" subtitle="Keep referrals genuine — verify before reward." actions={<>
        <button onClick={() => setNonce((n) => n + 1)} className="pn-btn pn-btn-ghost"><RefreshCw className="h-4 w-4" />Refresh</button>
        <button onClick={doExport} className="pn-btn pn-btn-ghost"><Download className="h-4 w-4" />Export CSV</button>
      </>} />

      {windowed && (
        <p className="mb-3 text-xs text-gray-400">
          Showing the {fmtNum(state.items.length)} newest of {fmtNum(state.total)} referrals. The
          counts below describe those, not the whole queue.
        </p>
      )}

      {/* 4 stat cards */}
      <div role="group" aria-label="Referral counts" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <div>A referral is paid only after background checks pass. <b className="text-gray-200">Mandatory:</b> the referred tenant must be <b className="text-gray-200">Aadhaar-verified</b> — the server refuses to release a reward without it. Self/duplicate-device and high-velocity referrals are scored <b className="text-gray-200">high risk</b> for review.</div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/5 p-1 w-full sm:w-max">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} aria-pressed={tab === t.id} className={classNames('rounded-lg px-3 py-1.5 text-sm font-medium transition', tab === t.id ? 'bg-brand-teal text-ink' : 'text-gray-300 hover:bg-white/5')}>
            {t.label} <span className="opacity-70">({fmtNum(state.items.filter(t.match).length)})</span>
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
                  <td className="p-3"><div className="font-semibold">{r.referrer} <span className="text-gray-500">→</span> {r.referred}</div><div className="text-xs text-gray-400">{r.channel === 'owner' ? 'Owner referral' : 'Seeker referral'} · {fmtDate(r.at)}</div></td>
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
                      {(r.status === 'pending' || r.status === 'qualified') ? <>
                        {canApprove
                          ? <button onClick={() => doAction(r, 'approve')} className="inline-flex items-center gap-1 rounded-lg border border-brand-teal/30 bg-brand-teal/10 px-2 py-1 text-xs text-brand-teal"><Check className="h-3 w-3" />Approve</button>
                          : <button disabled title="The server refuses to release a reward until the referred party is Aadhaar-verified" className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-500 opacity-50"><Lock className="h-3 w-3" />Blocked</button>}
                        <button onClick={() => doAction(r, 'reject')} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5"><X className="h-3 w-3" />Reject</button>
                      </> : r.status === 'rewarded' ? (
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
