import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { addSavedSearch, myMobile } from '../../../lib/store.js';
import { useSavedSearches } from '../../../context/SavedSearchContext.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';
import { buildFlatmateAlertRecord, flatmateCriteriaChips } from './alertCriteria.js';
import { TAB_MOVE_IN } from './model.js';

const CHANNELS = [
  { key: 'whatsapp', label: 'WhatsApp', icon: 'message-circle' },
  { key: 'sms', label: 'SMS', icon: 'smartphone' },
];

/**
 * "Get alerted" card shown in a Flatmates empty state (no flatmates/rooms/groups
 * match). Mirrors the listings NotifyMeCard: one submit creates a user-owned,
 * dashboard-manageable saved-search alert keyed by the entered mobile — so even a
 * signed-out seeker's lead lands under their number and surfaces after sign-in.
 */
export default function FlatmateAlertCard({ filters, tab, toast }) {
  const { t } = useTranslation();
  const [mobile, setMobile] = useState(() => myMobile() || '');
  const [channel, setChannel] = useState('whatsapp');
  const [sent, setSent] = useState(false);
  const [saving, setSaving] = useState(false);
  const { isIn } = useAuth();
  const { create: createSavedSearch } = useSavedSearches();

  // Per-tab copy so the invitation reads naturally for each share intent. Keyed
  // off the two live tabs — and `word` is a plural NOUN, not the tab label, so the
  // sentence stays grammatical ("the moment rooms match", never "the moment move
  // in now match").
  const isMoveIn = tab === TAB_MOVE_IN;
  const intro = isMoveIn ? t('flatmates.copyRooms') : t('flatmates.copyFlatmates');
  const word = isMoveIn ? t('flatmates.kind_homes') : t('flatmates.kind_flatmates');
  const record = buildFlatmateAlertRecord(filters, tab);
  const chips = flatmateCriteriaChips(record);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!/^[6-9]\d{9}$/.test(mobile)) { toast(t('flatmates.invalidMobile'), 'error'); return; }
    /* Two paths, because the server only models one of them.

       Signed in → the seam. Ownership comes from the token, so `mobile` is redundant and is
       deliberately not sent; passing it would only invite the API's anonymous-capture guard.

       Signed out → localStorage, as before. `POST /me/saved-searches` is caller-scoped and takes
       no mobile, so there is nothing to call for a visitor who has not signed in — and this card
       exists precisely to capture that visitor. Keeping it local means the alert is still claimed
       when they later sign in on this device, which is the behaviour it has always had (D85).

       The signed-in branch is awaited: it is a network write against the live API, and showing the
       "first in line" confirmation before it settles told the user they had an alert that a
       rejected create never recorded. */
    if (isIn) {
      setSaving(true);
      try {
        await createSavedSearch({ ...record, channel });
      } catch {
        setSaving(false);
        toast(t('flatmates.alertFailed'), 'error');
        return;
      }
      setSaving(false);
    } else {
      addSavedSearch({ ...record, channel, mobile });
    }
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
