import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import DateField from '../../../components/ui/DateField.jsx';
import { todayIso, VISIT_SLOTS } from '../../../lib/visitWhen.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useSignInGate } from '../../../lib/useSignInGate.js';
import useScrollLock from '../../../hooks/useScrollLock.js';
import { scheduleVisit } from '../../../services/visitService.js';

const nextDayIso = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function ScheduleVisitModal({ p, isIn, onClose, toast }) {
  const { t } = useTranslation();
  const { isIn: authIn, loading: authLoading } = useAuth();
  const sendToSignIn = useSignInGate();
  const [mode, setMode] = useState('in-person');
  const [visitDate, setVisitDate] = useState(nextDayIso());
  const [visitTime, setVisitTime] = useState('10:30 AM');
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const signedIn = isIn ?? authIn;
  const returnPath = p?.id ? `/property/${encodeURIComponent(String(p.id))}?visit=1` : undefined;
  const gated = useRef(false);

  useScrollLock();
  useEffect(() => {
    if (authLoading || signedIn || gated.current) return;
    gated.current = true;
    if (sendToSignIn('schedule', returnPath)) onClose();
  }, [authLoading, onClose, returnPath, sendToSignIn, signedIn]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    if (busy) return;
    if (!signedIn) {
      if (sendToSignIn('schedule', returnPath)) onClose();
      return;
    }
    setBusy(true);
    setError('');
    let keepMounted = true;
    try {
      await scheduleVisit({
        propertyId: p?.id || '',
        listing: p?.title || [p?.bhk, p?.type, p?.locality].filter(Boolean).join(' ') || t('property.typeFallback'),
        ownerMobile: p?.ownerMobile || '',
        dateIso: visitDate,
        time: visitTime,
        mode,
        note: msg.trim(),
      });
      setDone(true);
      toast(t('property.visitRequestedToast'), 'success');
    } catch (e) {
      if (e?.status === 401) {
        if (sendToSignIn('schedule', returnPath)) {
          keepMounted = false;
          onClose();
        }
        return;
      }
      const message = e?.code === 'visit_exists' ? t('property.visitAlreadyBooked') : t('property.visitRequestFailed');
      setError(message);
      toast(message, e?.code === 'visit_exists' ? 'info' : 'error');
    } finally {
      if (keepMounted) setBusy(false);
    }
  };

  if (!authLoading && !signedIn) return null;

  return (
    <div className="dz-modal-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dz-modal" role="dialog" aria-modal="true" aria-label={t('property.scheduleVisit')} style={{ maxWidth: 600 }}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold text-white">{t('property.scheduleVisit')}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{t('property.scheduleVisitSub')}</p>
          </div>
          <button type="button" onClick={onClose} className="dz-modal-x min-h-[44px] min-w-[44px]" aria-label={t('property.close')}><Icon name="x" className="w-5 h-5" /></button>
        </div>
        {done ? (
          <div className="text-center py-5">
            <Icon name="calendar-check" className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
            <p className="text-white font-semibold">{t('property.visitRequested')}</p>
            <p className="text-slate-400 text-sm mt-1">{t('property.visitRequestedBody')}</p>
            <button type="button" onClick={onClose} className="btn-teal w-full mt-5 min-h-[44px] px-4">{t('property.done')}</button>
          </div>
        ) : (
          <>
            <div className="space-y-4 mb-4">
              <div>
                <p className="text-sm font-medium text-gray-300 mb-3">{t('property.visitType')}</p>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setMode('in-person')} className={'pick rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row items-center gap-2 sm:gap-3 text-center sm:text-left' + (mode === 'in-person' ? ' sel' : '')}>
                    <div className="w-10 h-10 rounded-xl bg-teal-400/15 flex items-center justify-center shrink-0"><Icon name="map-pin" className="w-5 h-5 text-teal-400" /></div>
                    <div className="min-w-0"><p className="text-white text-sm font-semibold leading-tight">{t('property.inPerson')}</p><p className="text-gray-500 text-xs mt-0.5 sm:mt-0">{t('property.visitSite')}</p></div>
                  </button>
                  <button type="button" onClick={() => setMode('video')} className={'pick rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row items-center gap-2 sm:gap-3 text-center sm:text-left' + (mode === 'video' ? ' sel' : '')}>
                    <div className="w-10 h-10 rounded-xl bg-teal-400/15 flex items-center justify-center shrink-0"><Icon name="video" className="w-5 h-5 text-teal-400" /></div>
                    <div className="min-w-0"><p className="text-white text-sm font-semibold leading-tight">{t('property.videoTour')}</p><p className="text-gray-500 text-xs mt-0.5 sm:mt-0">{t('property.liveWalkthrough')}</p></div>
                  </button>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-300 mb-3">{t('property.selectDate')}</p>
                <DateField value={visitDate} onChange={setVisitDate} min={todayIso()} ariaLabel={t('property.selectDate')} className="field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-300 mb-3">{t('property.selectTimeSlot')}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {VISIT_SLOTS.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      aria-pressed={visitTime === slot}
                      onClick={() => setVisitTime(slot)}
                      className={'min-h-[44px] rounded-xl border px-3 text-sm font-semibold transition-smooth ' + (visitTime === slot ? 'border-teal-400/70 bg-teal-400/15 text-teal-100' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10')}
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">{t('property.message')} <span className="text-gray-500 font-normal">{t('property.optional')}</span></label>
                <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} placeholder={t('property.anyRequirements')} className="field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500 resize-none" />
              </div>
            </div>
            {error ? <p className="mb-3 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p> : null}
            <button type="button" onClick={submit} disabled={busy} className="btn-teal w-full min-h-[44px] flex items-center justify-center gap-2 px-4 disabled:opacity-60"><Icon name="calendar-check" className="w-4 h-4" /> {t('property.confirmVisit')}</button>
          </>
        )}
      </div>
    </div>
  );
}
