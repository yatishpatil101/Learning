import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { useSavedSearches } from '../../../context/SavedSearchContext.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useSignInGate } from '../../../lib/useSignInGate.js';
import { buildFlatmateAlertRecord, flatmateCriteriaChips } from './alertCriteria.js';
import { TAB_MOVE_IN } from './model.js';

const CHANNELS = [
  { key: 'whatsapp', label: 'WhatsApp', icon: 'message-circle' },
  { key: 'sms', label: 'SMS', icon: 'smartphone' },
];

/* "Get alerted" card for a Flatmates empty state. The managed alert is account-gated, so a
   signed-out seeker is redirected to sign in and no anonymous lead is captured here. */
export default function FlatmateAlertCard({ filters, tab, toast }) {
  const { t } = useTranslation();
  const { isIn, user } = useAuth();
  /* Seeded from the session once, as a convenience only — the field stays editable and is validated
     on submit either way. Deliberately not kept in step with the context: a profile change mid-form
     must not overwrite what the seeker has typed. Empty means signed out, not "not read yet". */
  const [mobile, setMobile] = useState(() => user?.mobile ?? '');
  const [channel, setChannel] = useState('whatsapp');
  const [sent, setSent] = useState(false);
  const [saving, setSaving] = useState(false);
  const { create: createSavedSearch } = useSavedSearches();
  const sendToSignIn = useSignInGate();

  // Per-tab copy so the invitation reads naturally for each share intent. `word` is a plural noun
  // rather than the tab label, or the sentence stops being grammatical.
  const isMoveIn = tab === TAB_MOVE_IN;
  const intro = isMoveIn ? t('flatmates.copyRooms') : t('flatmates.copyFlatmates');
  const word = isMoveIn ? t('flatmates.kind_homes') : t('flatmates.kind_flatmates');
  const record = buildFlatmateAlertRecord(filters, tab);
  const chips = flatmateCriteriaChips(record);

  const handleSubmit = async (e) => {
    e.preventDefault();
    /* The alert is user-owned and dashboard-managed, so it needs an account — an anonymous one is
       something the user is told they have but can never see. Ownership comes from the token, so
       `mobile` is deliberately not sent. The create is awaited: confirming "first in line" before it
       settles promises an alert a rejected create never recorded. */
    if (!isIn) {
      sendToSignIn('alerts');
      return;
    }
    if (!/^[6-9]\d{9}$/.test(mobile)) { toast(t('flatmates.invalidMobile'), 'error'); return; }
    setSaving(true);
    try {
      await createSavedSearch({ ...record, channel });
    } catch {
      setSaving(false);
      toast(t('flatmates.alertFailed'), 'error');
      return;
    }
    setSaving(false);
    setSent(true);
    toast(t('flatmates.alertCreatedChannel', { channel: channel === 'sms' ? 'SMS' : 'WhatsApp' }), 'success');
  };

  if (sent) {
    return (
      <div className="mt-6 overflow-hidden rounded-2xl border border-teal-500/25 bg-gradient-to-br from-teal-500/10 to-emerald-500/[0.04] p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-500/15">
          <Icon name="bell" className="h-6 w-6 text-teal-300" />
        </div>
        <p className="text-sm font-semibold text-white">{t('flatmates.firstInLine')}</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-gray-400">
          {t('flatmates.pingPre')} <span className="capitalize text-teal-300">{channel === 'sms' ? 'SMS' : 'WhatsApp'}</span> {t('flatmates.pingMid')}
          <span className="text-white"> {record.label}</span> {t('flatmates.pingSuf')}
        </p>
        <Link to="/dashboard#alerts" className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-teal-400/30 bg-teal-500/10 px-4 py-2 text-sm font-semibold text-teal-200 transition hover:bg-teal-500/20">
          <Icon name="sliders-horizontal" className="h-4 w-4" /> {t('flatmates.manageAlerts')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.08] to-transparent">
      <div className="p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15">
            <Icon name="bell-plus" className="h-5 w-5 text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">{t('flatmates.nothingHereTitle')}</p>
            <p className="mt-0.5 text-xs text-gray-400">
              {intro} {t('flatmates.notifyBody', { word })}
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
            <p className="mb-1.5 text-[11px] font-medium text-gray-500">{t('flatmates.notifyOn')}</p>
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
                aria-label={t('flatmates.ariaMobileAlerts')}
                placeholder={t('flatmates.mobilePlaceholder')}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 pl-10 text-sm text-white placeholder:text-gray-600 outline-none focus:border-teal-400/50"
              />
            </div>
            <button type="submit" disabled={saving} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-teal-400 disabled:opacity-50 disabled:cursor-not-allowed">
              <Icon name="bell-plus" className="h-4 w-4" /> {t('flatmates.createAlert')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
