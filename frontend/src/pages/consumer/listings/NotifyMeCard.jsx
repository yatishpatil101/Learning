import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { recordSignal } from '../../../services/demandService.js';
import { myMobile } from '../../../lib/store.js';
import { useSavedSearches } from '../../../context/SavedSearchContext.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';
import { buildAlertRecord, criteriaChips } from './alertCriteria.js';

const CHANNELS = [
  { key: 'whatsapp', label: 'WhatsApp', icon: 'message-circle' },
  { key: 'sms', label: 'SMS', icon: 'smartphone' },
];

/**
 * "Create a property alert" card shown when a search returns no / few results.
 * Doubles as a cold-start lead capture: one submit (a) creates a user-owned
 * saved-search alert (manageable from the dashboard) — account-gated since D85, so a
 * signed-out visitor is redirected to `/signin?reason=alerts` instead — and (b) feeds
 * the admin demand-gap signal via `recordSignal`, which still fires for anonymous
 * visitors before the sign-in redirect.
 */
export default function NotifyMeCard({ filters, locNameBySlug, toast }) {
  const { t } = useTranslation();
  const [mobile, setMobile] = useState(() => myMobile() || '');
  const [channel, setChannel] = useState('whatsapp');
  const [sent, setSent] = useState(false);
  const [saving, setSaving] = useState(false);
  const { isIn } = useAuth();
  const { create: createSavedSearch } = useSavedSearches();
  const navigate = useNavigate();

  const record = buildAlertRecord(filters, locNameBySlug);
  const chips = criteriaChips(record, locNameBySlug);
  const label = record.label;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!/^[6-9]\d{9}$/.test(mobile)) { toast(t('listings.invalidMobile'), 'error'); return; }

    // Admin demand-gap signal — one per selected locality (or one blank if none). Captured for
    // signed-out visitors too, so cold-start demand is still measured even though the alert itself
    // now requires an account (D85).
    //
    // Slugs now, not display names: the server joins to `localities` on the slug. And no `mobile` --
    // the number is still collected on this form because the *alert* needs a channel to reach, but
    // it is no longer copied into the demand record. That table's only reader is a count, so a
    // contact detail there would have been held on people who never opened an account, for a report
    // that could not use it. Where the visitor does sign in, the saved search carries the number.
    const demandBhk = record.bhk.join('/');
    const targets = filters.localities.size ? [...filters.localities] : [''];
    targets.forEach((localitySlug) => {
      recordSignal({ kind: 'alert', localitySlug, deal: filters.deal, bhk: demandBhk });
    });

    // The alert is user-owned and lives in the login-only dashboard, so it needs an account. Signed
    // out → the demand above is recorded, then send them to sign in (matching the "Save search"
    // gate in Listings). Writing an anonymous localStorage alert produced one the user was told they
    // had but could never see once every read came from the server (D85).
    if (!isIn) {
      toast(t('listings.signInToAlert'), 'info');
      navigate(`/signin?reason=alerts&next=${encodeURIComponent('/listings?deal=' + filters.deal)}`);
      return;
    }

    // User-owned, manageable alert (surfaced in dashboard → Alerts). Persists the full filter set so
    // matching/display stays complete. Awaited, because against the live API this is a network write
    // that can fail — fire-and-forget showed the "first in line" confirmation unconditionally, so a
    // rejected create left the user certain they had an alert that was never recorded.
    setSaving(true);
    try {
      await createSavedSearch({ ...record, query: '', channel });
    } catch {
      setSaving(false);
      toast(t('listings.alertFailed'), 'error');
      return;
    }
    setSaving(false);

    setSent(true);
    toast(t('listings.alertCreated'), 'success');
  };

  if (sent) {
    return (
      <div className="mt-5 sm:mt-6 overflow-hidden rounded-2xl border border-teal-500/25 bg-gradient-to-br from-teal-500/10 to-emerald-500/[0.04] p-5 sm:p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-500/15">
          <Icon name="bell" className="h-6 w-6 text-teal-300" />
        </div>
        <p className="text-sm font-semibold text-white">{t('listings.firstInLine')}</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-gray-400">
          {t('listings.sentPre')} <span className="capitalize text-teal-300">{channel === 'sms' ? 'SMS' : 'WhatsApp'}</span> {t('listings.sentMid')}
          <span className="text-white"> {label}</span> {t('listings.sentSuf')}
        </p>
        <Link to="/dashboard#alerts" className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-teal-400/30 bg-teal-500/10 px-4 py-2 text-sm font-semibold text-teal-200 transition hover:bg-teal-500/20">
          <Icon name="sliders-horizontal" className="h-4 w-4" /> {t('listings.manageAlerts')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-5 sm:mt-6 overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.08] to-transparent">
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15">
            <Icon name="bell-plus" className="h-5 w-5 text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">{t('listings.notifyTitle')}</p>
            <p className="mt-0.5 text-xs text-gray-400">
              {t('listings.notifyBody')}
            </p>
          </div>
        </div>

        {/* Criteria summary */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {chips.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-gray-200">
              <Icon name={c.icon} className="h-3 w-3 text-amber-300/80" /> {c.text}
            </span>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {/* Channel choice */}
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-gray-500">{t('listings.notifyOn')}</p>
            <div className="flex gap-2">
              {CHANNELS.map((c) => {
                const on = channel === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setChannel(c.key)}
                    aria-pressed={on}
                    className={'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ' + (on ? 'border-teal-400/40 bg-teal-500/15 text-teal-200' : 'border-white/10 bg-white/5 text-gray-400 hover:text-white')}
                  >
                    <Icon name={c.icon} className="h-3.5 w-3.5" /> {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mobile + submit */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1 sm:max-w-[240px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">+91</span>
              <input
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                inputMode="numeric"
                aria-label={t('listings.mobileAria')}
                placeholder={t('listings.mobilePlaceholder')}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 pl-10 text-sm text-white placeholder:text-gray-600 outline-none focus:border-teal-400/50"
              />
            </div>
            <button type="submit" disabled={saving} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-teal-400 disabled:opacity-50 disabled:cursor-not-allowed">
              <Icon name="bell-plus" className="h-4 w-4" /> {t('listings.createAlert')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
