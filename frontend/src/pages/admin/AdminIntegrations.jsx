import { useEffect, useState } from 'react';
import { ExternalLink, Mail, MessageCircle, CreditCard } from 'lucide-react';
import { getProviderHealth, listProviderCalls } from '../../services/integrationsService.js';
import { classNames, fmtAgo, fmtNum } from '../../lib/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Loading from '../../components/ui/Loading.jsx';
import {
  CHIP, CHIP_TONE, Chips, PageNav, QueuePanel, RowCard, RowList, SearchBox,
} from '../../components/admin/WorkQueue.jsx';

const PAGE_SIZE = 20;

const PROVIDERS = {
  zeptomail: { label: 'Email', vendor: 'Zoho ZeptoMail', icon: Mail, console: 'https://cpaas.zoho.in' },
  whatsapp: { label: 'WhatsApp', vendor: 'Meta Cloud API', icon: MessageCircle, console: 'https://business.facebook.com/wa/manage/home/' },
  cashfree: { label: 'Payments', vendor: 'Cashfree', icon: CreditCard, console: 'https://merchant.cashfree.com' },
};

const OPERATIONS = {
  email: 'Email',
  otp: 'Login OTP',
  'identity-decision': 'KYC decision',
  'create-order': 'Payment order',
  refund: 'Refund',
  webhook: 'Payment webhook',
};

const OUTCOME_TONE = { ok: 'green', failed: 'red', skipped: 'neutral' };
const OUTCOME_LABEL = { ok: 'OK', failed: 'Failed', skipped: 'Not sent' };

const PROVIDER_CHIPS = [{ value: '', label: 'All' }, ...Object.entries(PROVIDERS).map(([value, p]) => ({ value, label: p.label }))];
const OUTCOME_CHIPS = [{ value: '', label: 'All' }, { value: 'failed', label: 'Failed' }, { value: 'ok', label: 'OK' }, { value: 'skipped', label: 'Not sent' }];

const Dot = () => <span className="text-gray-600" aria-hidden="true">·</span>;

function Stat({ label, ok, failed }) {
  return (
    <div className="rounded-xl bg-white/[0.04] p-2.5">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">
        {fmtNum(ok)} ok
        {failed ? <span className="text-rose-300"> · {fmtNum(failed)} failed</span> : null}
      </div>
    </div>
  );
}

function HealthCard({ h }) {
  const p = PROVIDERS[h.provider] || { label: h.provider, vendor: '', icon: Mail };
  const failing = h.failed24h > 0;
  return (
    <section className="dz-card p-4" data-testid={`provider-${h.provider}`}>
      <div className="flex items-start gap-3">
        <span className={classNames('grid h-9 w-9 shrink-0 place-items-center rounded-xl', failing ? 'bg-rose-500/15 text-rose-300' : 'bg-brand-teal/15 text-brand-teal')}>
          <p.icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold">{p.label}</h3>
          <p className="text-xs text-gray-500">{p.vendor}</p>
        </div>
        <span className={classNames(CHIP, CHIP_TONE[h.live ? 'teal' : 'amber'])}>{h.live ? 'Live' : 'Mock'}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat label="Last 24h" ok={h.ok24h} failed={h.failed24h} />
        <Stat label="Last 7 days" ok={h.ok7d} failed={h.failed7d} />
      </div>
      <dl className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between gap-2"><dt className="text-gray-500">Last success</dt><dd>{h.lastOkAt ? fmtAgo(h.lastOkAt) : '—'}</dd></div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">Last failure</dt>
          <dd className={classNames('truncate', h.lastFailureAt && 'text-rose-300')} title={h.lastFailureDetail || undefined}>
            {h.lastFailureAt ? `${fmtAgo(h.lastFailureAt)} · ${h.lastFailureDetail || 'error'}` : '—'}
          </dd>
        </div>
      </dl>
      {p.console ? (
        <a href={p.console} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-brand-teal hover:underline">
          Open {p.vendor} <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </section>
  );
}

function CallRow({ c }) {
  const p = PROVIDERS[c.provider];
  return (
    <RowCard
      id={c.id}
      testId="provider-call"
      title={OPERATIONS[c.operation] || c.operation}
      badges={<span className={classNames(CHIP, CHIP_TONE[OUTCOME_TONE[c.outcome] || 'neutral'])}>{OUTCOME_LABEL[c.outcome] || c.outcome}</span>}
      meta={(
        <>
          <span>{p?.label || c.provider}</span><Dot />
          <span title={c.createdAt}>{fmtAgo(c.createdAt)}</span>
          {c.recipient ? <><Dot /><span className="font-mono">{c.recipient}</span></> : null}
          {c.durationMs != null ? <><Dot /><span>{fmtNum(c.durationMs)} ms</span></> : null}
        </>
      )}
      chips={c.reference || c.detail ? (
        <>
          {c.reference ? <span className="truncate font-mono text-[11px] text-gray-400" title={c.reference}>{c.reference}</span> : null}
          {c.detail ? <span className={classNames(CHIP, CHIP_TONE[c.outcome === 'failed' ? 'red' : 'neutral'])}>{c.detail}</span> : null}
        </>
      ) : null}
    />
  );
}

export default function AdminIntegrations() {
  const [health, setHealth] = useState(null);
  const [calls, setCalls] = useState(null);
  const [provider, setProvider] = useState('');
  const [outcome, setOutcome] = useState('');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [healthFailed, setHealthFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    getProviderHealth()
      .then((h) => { if (alive) { setHealth(h); setHealthFailed(false); } })
      .catch(() => { if (alive) { setHealth([]); setHealthFailed(true); } });
    return () => { alive = false; };
  }, [attempt]);

  useEffect(() => {
    const id = setTimeout(() => { setTerm(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [q]);

  const filterBy = (set) => (value) => { set(value); setPage(1); };

  useEffect(() => {
    let alive = true;
    setCalls((prev) => (prev ? { ...prev, stale: true } : prev));
    listProviderCalls({ provider, outcome, q: term, page: page - 1, size: PAGE_SIZE })
      .then((res) => { if (alive) setCalls(res); })
      .catch(() => { if (alive) setCalls({ items: [], total: 0, totalPages: 0, failed: true }); });
    return () => { alive = false; };
  }, [provider, outcome, term, page, attempt]);

  if (!health) return <Loading />;

  const failedParts = [healthFailed && 'provider health', calls?.failed && 'call log'].filter(Boolean);

  return (
    <div>
      <PageHeader title="Integrations" subtitle="Email, WhatsApp and payment calls, kept for 90 days." />

      {failedParts.length ? (
        <div role="alert" className="mb-4 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
          Could not load the {failedParts.join(' and ')}. What is shown below is missing data, not a quiet period.{' '}
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="underline underline-offset-2">Retry</button>
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        {health.map((h) => <HealthCard key={h.provider} h={h} />)}
      </div>

      <QueuePanel
        toolbar={(
          <>
            <SearchBox value={q} onChange={setQ} placeholder="Full email, mobile or order id" label="Search calls" />
            <Chips label="Provider" options={PROVIDER_CHIPS} value={provider} onChange={filterBy(setProvider)} />
            <Chips label="Outcome" options={OUTCOME_CHIPS} value={outcome} onChange={filterBy(setOutcome)} />
            <div className="ml-auto">
              <PageNav
                page={page}
                pageCount={Math.max(1, calls?.totalPages || 1)}
                total={calls?.total || 0}
                size={PAGE_SIZE}
                onPage={setPage}
                stale={!calls || calls.stale}
              />
            </div>
          </>
        )}
      >
        {calls ? (
          <RowList isEmpty={!calls.items.length} empty={calls.failed ? 'Call log unavailable.' : 'No calls match.'}>
            {calls.items.map((c) => <CallRow key={c.id} c={c} />)}
          </RowList>
        ) : <Loading />}
      </QueuePanel>
    </div>
  );
}
