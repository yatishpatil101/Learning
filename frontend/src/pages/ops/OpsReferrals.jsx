import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, Lock, RefreshCw, ShieldAlert, Undo2, X } from 'lucide-react';
import { approveReferral, clawbackReferral, listReferralQueue, rejectReferral } from '../../services/referralService.js';
import { fmtNum, classNames } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Loading from '../../components/ui/Loading.jsx';
import {
  BTN, CHIP, CHIP_TONE, FactRow, PageNav, QueuePanel, QueueTabs, RowCard, RowList, SearchBox, useClientPaging,
} from '../../components/admin/WorkQueue.jsx';

const RISK_TONE = { high: CHIP_TONE.red, medium: CHIP_TONE.amber, low: CHIP_TONE.green };
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN') : '—');
const Dot = () => <span className="text-gray-600" aria-hidden="true">·</span>;

/* A window, not a page: the tab counts describe what is in hand and the note says so when the
   server's total is larger, because a fraud queue this size is itself the signal. */
const WINDOW = 100;
const PAGE_SIZE = 20;

/* Background-check signals. goodWhenTrue=true → green when present; false → red when present. */
const SIGNALS = [
  ['identityVerified', 'Identity verified', true],
  ['identityUnique', 'Identity unique', true],
  ['activated', 'Activated', true],
  ['sameDevice', 'Same device', false],
  ['sameIp', 'Same IP', false],
  ['velocityHigh', 'High velocity', false],
];

/* A mirror of `ReferralService.approve`, never the rule itself: the server refuses with a sentence
   and this only spares the desk a pointless round trip. */
const canQualify = (r) => !!(r.identityVerified && r.identityUnique);
const isOpen = (r) => r.status === 'pending' || r.status === 'qualified';

/* Tabs match statuses the server actually has. Risk is a separate field, so **High risk** is a risk
   filter rather than a status one — a status tab for it would sit permanently empty. */
const TABS = [
  { key: 'pending', label: 'Pending', match: isOpen },
  { key: 'high-risk', label: 'High risk', match: (r) => r.risk === 'high' },
  { key: 'rewarded', label: 'Rewarded', match: (r) => r.status === 'rewarded' },
  { key: 'refused', label: 'Refused', match: (r) => r.status === 'rejected' || r.status === 'clawed-back' },
  { key: 'all', label: 'All', match: () => true },
];
const TAB_KEYS = TABS.map((t) => t.key);
const NOTE = 'A reward is released only once the referred person holds the Verified badge. Same device, same IP and high velocity score as high risk.';

export default function OpsReferrals() {
  const { toast } = useToast();
  const [state, setState] = useState({ status: 'loading', items: [], total: 0, error: '' });
  const [tab, setTab] = useTabParam(TAB_KEYS, 'pending');
  const [q, setQ] = useState('');
  const [nonce, setNonce] = useState(0);

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: s.status === 'ready' ? 'ready' : 'loading', error: '' }));
    listReferralQueue({ size: WINDOW })
      .then((page) => setState({ status: 'ready', items: page.items, total: page.total, error: '' }))
      .catch((e) => setState({ status: 'error', items: [], total: 0, error: e.message || 'Could not read the queue.' }));
  }, []);

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

  const active = TABS.find((t) => t.key === tab);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return state.items.filter((r) => active.match(r)
      && (!needle || `${r.id} ${r.referrer} ${r.referred}`.toLowerCase().includes(needle)));
  }, [state.items, active, q]);
  const { items: pageRows, paging } = useClientPaging(rows, PAGE_SIZE, `${tab}|${q}`);

  /* No offline fallback: referral decisions release money, and the offline store disagreed with the
     server about what a referral even is. The error branch below is the only failure left. */
  if (state.status === 'error') {
    return (
      <div>
        <PageHeader title="Referral Verification" subtitle="Keep referrals genuine — verify before reward." />
        <div className="dz-card flex items-start gap-3 p-6 text-sm text-gray-300">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
          <div>
            <div className="font-semibold text-gray-100">The queue could not be read.</div>
            <p className="mt-1 max-w-2xl text-gray-400">{state.error}</p>
            <button type="button" onClick={() => setNonce((n) => n + 1)} className="dz-btn dz-btn-ghost mt-3">
              <RefreshCw className="h-4 w-4" />Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'loading') return <Loading />;

  const windowed = state.total > state.items.length;

  const doExport = () => exportCsv('draazy-referrals.csv',
    ['ID', 'Referrer', 'Referred', 'Channel', 'Reward', 'Amount', 'Risk', 'Status', 'Identity verified', 'Identity unique', 'Same device', 'Same IP', 'High velocity', 'Redeemed'],
    rows.map((r) => [r.id, r.referrer, r.referred, r.channel, r.reward, r.rewardAmount, r.risk, r.status, r.identityVerified ? 'Yes' : 'No', r.identityUnique ? 'Yes' : 'No', r.sameDevice ? 'Yes' : 'No', r.sameIp ? 'Yes' : 'No', r.velocityHigh ? 'Yes' : 'No', fmtDate(r.at)]));

  const decisions = (r) => {
    if (isOpen(r)) {
      return (
        <>
          {canQualify(r)
            ? <button type="button" onClick={() => doAction(r, 'approve')} className={BTN.primary}><Check className="h-3.5 w-3.5" />Approve</button>
            : <button type="button" disabled title="The server refuses to release a reward until the referred party holds the Verified badge" className={classNames(BTN.ghost, 'cursor-not-allowed opacity-50')}><Lock className="h-3.5 w-3.5" />Blocked</button>}
          <button type="button" onClick={() => doAction(r, 'reject')} className={BTN.ghost}><X className="h-3.5 w-3.5" />Reject</button>
        </>
      );
    }
    if (r.status === 'rewarded') {
      return <button type="button" onClick={() => doAction(r, 'clawback')} className={BTN.danger}><Undo2 className="h-3.5 w-3.5" />Clawback</button>;
    }
    return null;
  };

  return (
    <div>
      <PageHeader title="Referral Verification" subtitle="Keep referrals genuine — verify before reward." />

      <QueueTabs
        label="Referral queues"
        active={tab}
        onChange={setTab}
        tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: state.items.filter(t.match).length }))}
      />

      <QueuePanel
        active={tab}
        note={windowed ? `${NOTE} Counts cover the ${fmtNum(state.items.length)} newest of ${fmtNum(state.total)} referrals.` : NOTE}
        toolbar={(
          <>
            <SearchBox value={q} onChange={setQ} placeholder="Referrer, referred or ID" label="Search referrals" />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setNonce((n) => n + 1)} className={BTN.ghost}><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
              <button type="button" onClick={doExport} className={BTN.ghost}><Download className="h-3.5 w-3.5" />Export CSV</button>
              <PageNav {...paging} />
            </div>
          </>
        )}
        footer={paging.pageCount > 1 ? <PageNav {...paging} /> : null}
      >
        <RowList isEmpty={!rows.length} empty={q.trim() ? 'No referrals match this search.' : 'No referrals here.'}>
          {pageRows.map((r) => (
            <RowCard
              key={r.id}
              id={r.id}
              title={<>{r.referrer} <span className="font-normal text-gray-500">→</span> {r.referred}</>}
              badges={<><Badge status={r.status} /><span className={classNames(CHIP, 'capitalize', RISK_TONE[r.risk] || CHIP_TONE.neutral)}>{r.risk} risk</span></>}
              meta={<><span className="font-mono">{r.id}</span><Dot /><span>{r.channel === 'owner' ? 'Owner referral' : 'Seeker referral'}</span><Dot /><span>Redeemed {fmtDate(r.at)}</span></>}
              facts={<FactRow label="Reward"><span className="col-span-full">{r.reward || '—'}</span></FactRow>}
              chips={SIGNALS.map(([key, label, goodWhenTrue]) => {
                const good = goodWhenTrue ? !!r[key] : !r[key];
                return (
                  <span key={key} className={classNames(CHIP, 'gap-1', good ? CHIP_TONE.green : CHIP_TONE.red)}>
                    {good ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{label}
                  </span>
                );
              })}
              primary={decisions(r)}
            />
          ))}
        </RowList>
      </QueuePanel>
    </div>
  );
}
