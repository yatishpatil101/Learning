import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import MobileField from '../../../components/MobileField.jsx';
import DateField from '../../../components/ui/DateField.jsx';
import TimeField from '../../../components/ui/TimeField.jsx';
import { todayIso } from '../../../lib/visitWhen.js';

export function ScheduleVisitModal({ p, isIn, onClose, toast }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState('in-person');
  const [visitDate, setVisitDate] = useState(todayIso());
  const [visitTime, setVisitTime] = useState('10:30 AM');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const submit = () => {
    const d = (phone || '').replace(/\D/g, '').replace(/^91/, '');
    if (!name.trim()) { toast(t('property.enterName'), 'info'); return; }
    if (!/^[6-9]\d{9}$/.test(d)) { toast(t('property.validMobile'), 'info'); return; }
    setDone(true);
    toast(t('property.visitRequestedToast'), 'success');
  };

  return (
    <div className="pn-modal-backdrop" role="dialog" aria-modal="true" aria-label={t('property.scheduleVisit')} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pn-modal" style={{ maxWidth: 600 }}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold text-white">{t('property.scheduleVisit')}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{t('property.scheduleVisitSub')}</p>
          </div>
          <button onClick={onClose} className="pn-modal-x" aria-label={t('property.close')}><Icon name="x" className="w-5 h-5" /></button>
        </div>
        {done ? (
          <div className="text-center py-5">
            <Icon name="calendar-check" className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
            <p className="text-white font-semibold">{t('property.visitRequested')}</p>
            <p className="text-slate-400 text-sm mt-1">{t('property.visitRequestedBody')}</p>
            <button onClick={onClose} className="btn-teal w-full mt-5 py-2.5 px-4">{t('property.done')}</button>
          </div>
        ) : (
          <>
            <div className="space-y-4 mb-4">
              <div>
                <p className="text-sm font-medium text-gray-300 mb-3">{t('property.visitType')}</p>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setMode('in-person')} className={'pick rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row items-center gap-2 sm:gap-3 text-center sm:text-left' + (mode === 'in-person' ? ' sel' : '')}>
                    <div className="w-10 h-10 rounded-xl bg-teal-400/15 flex items-center justify-center shrink-0"><Icon name="map-pin" className="w-5 h-5 text-teal-400" /></div>
                    <div className="min-w-0"><p className="text-white text-sm font-semibold leading-tight">{t('property.inPerson')}</p><p className="text-gray-500 text-xs mt-0.5 sm:mt-0">{t('property.visitSite')}</p></div>
                  </button>
                  <button onClick={() => setMode('video')} className={'pick rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row items-center gap-2 sm:gap-3 text-center sm:text-left' + (mode === 'video' ? ' sel' : '')}>
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
                <TimeField value={visitTime} onChange={setVisitTime} ariaLabel={t('property.selectTimeSlot')} className="field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('property.fullName')} <span className="text-rose-400">*</span></label>
                  <input value={name} onChange={(e) => setName(e.target.value)} type="text" placeholder={t('property.yourName')} className="field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('property.mobileNumber')} <span className="text-rose-400">*</span></label>
                  <MobileField value={phone} onChange={setPhone} placeholder={t('property.enterMobile')} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('property.message')} <span className="text-gray-500 font-normal">({t('property.optional')})</span></label>
                  <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} placeholder={t('property.anyRequirements')} className="field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500 resize-none" />
                </div>
              </div>
            </div>
            <button onClick={submit} className="btn-teal w-full flex items-center justify-center gap-2 py-3"><Icon name="calendar-check" className="w-4 h-4" /> {t('property.confirmVisit')}</button>
          </>
        )}
      </div>
    </div>
  );
}
