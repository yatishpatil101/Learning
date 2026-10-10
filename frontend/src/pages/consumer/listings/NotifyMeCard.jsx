import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { recordSignal } from '../../../services/demandService.js';
import { useSavedSearchCreate } from '../../../context/SavedSearchContext.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useSignInGate } from '../../../lib/useSignInGate.js';
import { buildAlertRecord, criteriaChips } from './alertCriteria.js';

const ALERT_FLAG = 'createAlert';
const ALERT_NONCE = 'alertNonce';
const INTENT_PREFIX = 'draazy:listing-alert:';

export default function NotifyMeCard({ filters, locNameBySlug, toast }) {
  const { t } = useTranslation();
  const { isIn } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sent, setSent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingReturn, setConfirmingReturn] = useState(false);
  const createSavedSearch = useSavedSearchCreate();
  const sendToSignIn = useSignInGate();
  const signalled = useRef(new Set());
  const consumedReturn = useRef(false);

  const record = useMemo(() => buildAlertRecord(filters, locNameBySlug), [filters, locNameBySlug]);
  const chips = useMemo(() => criteriaChips(record, locNameBySlug), [record, locNameBySlug]);
  const label = record.label;

  const stripAlertIntent = useCallback(() => {
    const params = new URLSearchParams(location.search);
    params.delete(ALERT_FLAG);
    params.delete(ALERT_NONCE);
    params.delete('alertIntent');
    params.delete('alertChannel');
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ''}${location.hash}`, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate]);

  const saveAlert = useCallback(async (alertRecord) => {
    setSaving(true);
    try {
      await createSavedSearch({ ...alertRecord, query: '', channel: 'push' });
    } catch {
      setSaving(false);
      toast(t('listings.alertFailed'), 'error');
      return false;
    }
    setSaving(false);
    setSent(true);
    toast(t('listings.alertCreated'), 'success');
    return true;
  }, [createSavedSearch, t, toast]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!isIn || sent || params.get(ALERT_FLAG) !== 'listings' || consumedReturn.current) return;
    consumedReturn.current = true;
    const nonce = params.get(ALERT_NONCE);
    const stored = nonce ? sessionStorage.getItem(INTENT_PREFIX + nonce) : null;
    if (nonce) sessionStorage.removeItem(INTENT_PREFIX + nonce);
    stripAlertIntent();
    if (stored) {
      try {
        if (JSON.parse(stored)?.surface === 'listings') setConfirmingReturn(true);
      } catch {
        setConfirmingReturn(false);
      }
    }
  }, [isIn, location.search, sent, stripAlertIntent]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const demandBhk = record.bhk.join('/');
    const targets = filters.localities.size ? [...filters.localities] : [''];
    targets.forEach((localitySlug) => {
      const once = `${localitySlug}|${filters.deal}|${demandBhk}`;
      if (signalled.current.has(once)) return;
      signalled.current.add(once);
      recordSignal({ kind: 'alert', localitySlug, deal: filters.deal, bhk: demandBhk });
    });

    if (!isIn) {
      const nonce = window.crypto?.randomUUID?.() || String(Date.now());
      sessionStorage.setItem(INTENT_PREFIX + nonce, JSON.stringify({ surface: 'listings' }));
      const params = new URLSearchParams(location.search);
      params.set(ALERT_FLAG, 'listings');
      params.set(ALERT_NONCE, nonce);
      sendToSignIn('alerts', `${location.pathname}?${params.toString()}${location.hash}`);
      return;
    }

    await saveAlert(record);
  };

  if (sent) {
    return (
      <div className="mt-5 sm:mt-6 overflow-hidden rounded-2xl border border-teal-500/25 bg-gradient-to-br from-teal-500/10 to-emerald-500/[0.04] p-5 sm:p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-500/15">
          <Icon name="bell" className="h-6 w-6 text-teal-300" />
        </div>
        <p className="text-sm font-semibold text-white">{t('listings.firstInLine')}</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-gray-400">
          {t('listings.sentInApp')} <span className="text-white"> {label}</span>
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

        <div className="mt-4 flex flex-wrap gap-1.5">
          {chips.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-gray-200">
              <Icon name={c.icon} className="h-3 w-3 text-amber-300/80" /> {c.text}
            </span>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {confirmingReturn ? (
            <p className="rounded-xl border border-teal-400/20 bg-teal-500/10 px-3 py-2 text-xs text-teal-100">
              {t('listings.confirmAlertFor', { label })}
            </p>
          ) : null}
          <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-400">
            {t('listings.inAppAlertNotice')}
          </p>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-teal-400 disabled:opacity-50 disabled:cursor-not-allowed">
              <Icon name="bell-plus" className="h-4 w-4" /> {t('listings.createAlert')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
