import { useState, useRef, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import MobileField from '../../components/MobileField.jsx';
import DateField from '../../components/ui/DateField.jsx';
import TimeField from '../../components/ui/TimeField.jsx';
import { useScrollReveal } from '../../lib/useScrollReveal.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { scheduleVisit } from '../../services/visitService.js';
import { getProperty } from '../../services/propertyService.js';
import { priceLabel, fmtNum, avatarFor } from '../../lib/format.js';
import { cityLabelFor } from '../../lib/geoConfig.js';
import { displayDate, todayIso } from '../../lib/visitWhen.js';
import AutosaveBanner from '../../components/AutosaveBanner.jsx';
import FieldError from '../../components/ui/FieldError.jsx';
import { useFormDraft, useFieldErrors } from '../../lib/hooks.js';

const FALLBACK_IMG = 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600&q=80';

export default function ScheduleVisit() {
  const rootRef = useScrollReveal();
  const { t } = useTranslation();
  const { isIn } = useAuth();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const title = (params.get('title') || '').replace(/[<>]/g, '');
  const listingId = params.get('p') || params.get('listing') || '';
  const ownerParam = params.get('o') || '';

  const [listing, setListing] = useState(null);
  const [mode, setMode] = useState('in-person');
  const [visitDate, setVisitDate] = useState(todayIso());
  const [visitTime, setVisitTime] = useState('10:30 AM');
  const [form, setForm] = useState({ name: '', phone: '', msg: '' });
  const [booked, setBooked] = useState(false);
  // Booking is a network write now: hold the button so a double-tap cannot fire two requests, the
  // second of which the server would reject as a duplicate live visit.
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const draft = useFormDraft('pnDraft:schedule-visit', form, setForm);
  const formRef = useRef(null);
  const err = useFieldErrors(formRef);

  // Resolve the real listing so the page always shows the correct property
  // context (title, price, owner) rather than a hardcoded placeholder.
  useEffect(() => {
    if (!listingId) { setListing(null); return undefined; }
    let alive = true;
    getProperty(listingId).then((l) => { if (alive) setListing(l || null); });
    return () => { alive = false; };
  }, [listingId]);

  const propTitle = listing?.title || title || '';
  const ownerMobile = ownerParam || listing?.ownerMobile || '';

  const confirm = () => {
    const d = (form.phone || '').replace(/\D/g, '').replace(/^91/, '');
    const ok = err.check([
      { name: 'name', ok: !!form.name.trim(), msg: t('misc1.svErrName') },
      { name: 'phone', ok: /^[6-9]\d{9}$/.test(d), msg: t('misc1.svErrPhone') },
    ], toast);
    if (!ok) return;
    if (!isIn) {
      draft.clear();
      setBooked(true);
      toast(t('misc1.svToastRequested'), 'success');
      return;
    }

    /* One write, not two. This used to call `scheduleVisit` (the global collection) *and*
       `addVisitRequest` (the owner's bucket) — two records of one real-world event, which then
       drifted the moment either was updated alone. The seam writes once; the mock provider still
       feeds the admin collection internally until that slice ships. */
    setBusy(true);
    scheduleVisit({
      propertyId: listingId || listing?.id || '',
      listing: propTitle || 'Property visit',
      ownerMobile,
      visitorName: form.name,
      phone: form.phone,
      dateIso: visitDate,
      time: visitTime,
      mode,
      note: form.msg,
    })
      .then(() => {
        draft.clear();
        setBooked(true);
        toast(t('misc1.svToastRequested'), 'success');
      })
      .catch((e) => {
        // A live visit already exists on this listing. The server refuses rather than moving the
        // slot, so say so instead of showing a success screen for a booking that did not happen.
        if (e?.code === 'visit_exists') toast(t('misc1.svToastAlreadyBooked'), 'info');
        else toast(t('misc1.svToastFailed'), 'error');
      })
      .finally(() => setBusy(false));
  };

  const field = 'field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500';

  return (
    <div ref={rootRef}>
      <div className="pt-8 lg:pt-10 pb-20 min-h-[100dvh]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link to={listingId ? `/property/${listingId}` : '/listings'} className="inline-flex items-center gap-2 text-gray-400 hover:text-teal-400 text-sm mb-6 transition-colors"><Icon name="arrow-left" className="w-4 h-4" /> {listingId ? t('misc1.svBackToProperty') : t('misc1.svBackToListings')}</Link>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
            {/* Form */}
            <div className="glass-card rounded-2xl p-6 sm:p-8 reveal">
              {propTitle && (
                <div className="flex items-center gap-2 text-sm text-teal-300 bg-teal-500/10 border border-teal-500/20 rounded-xl px-4 py-2.5 mb-5"><Icon name="building-2" className="w-4 h-4" /> {t('misc1.svVisiting')} <span className="font-semibold text-white">{propTitle}</span></div>
              )}
              <h1 className="text-2xl font-bold text-white mb-1">{t('misc1.svTitle')}</h1>
              <p className="text-gray-400 text-sm mb-5">{t('misc1.svSubtitle')}</p>

              <p className="text-sm font-medium text-gray-300 mb-2">{t('misc1.svVisitType')}</p>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <button type="button" onClick={() => setMode('in-person')} className={'pick rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row items-center gap-2 sm:gap-3 text-center sm:text-left' + (mode === 'in-person' ? ' sel' : '')}>
                  <div className="w-10 h-10 rounded-xl bg-teal-400/15 flex items-center justify-center shrink-0"><Icon name="map-pin" className="w-5 h-5 text-teal-400" /></div>
                  <div className="min-w-0"><p className="text-white text-sm font-semibold leading-tight">{t('misc1.svInPerson')}</p><p className="text-gray-500 text-xs mt-0.5 sm:mt-0">{t('misc1.svVisitSite')}</p></div>
                </button>
                <button type="button" onClick={() => setMode('video')} className={'pick rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row items-center gap-2 sm:gap-3 text-center sm:text-left' + (mode === 'video' ? ' sel' : '')}>
                  <div className="w-10 h-10 rounded-xl bg-teal-400/15 flex items-center justify-center shrink-0"><Icon name="video" className="w-5 h-5 text-teal-400" /></div>
                  <div className="min-w-0"><p className="text-white text-sm font-semibold leading-tight">{t('misc1.svVideoTour')}</p><p className="text-gray-500 text-xs mt-0.5 sm:mt-0">{t('misc1.svLiveWalkthrough')}</p></div>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-5">
                <div>
                  <p className="text-sm font-medium text-gray-300 mb-2">{t('misc1.svSelectDate')}</p>
                  <DateField value={visitDate} onChange={setVisitDate} min={todayIso()} ariaLabel={t('misc1.svSelectDate')} className="field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-300 mb-2">{t('misc1.svSelectTime')}</p>
                  <TimeField value={visitTime} onChange={setVisitTime} ariaLabel={t('misc1.svSelectTime')} className="field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" ref={formRef}>
                <div className="sm:col-span-2"><AutosaveBanner restored={draft.restored} onStartFresh={draft.startFresh} /></div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('misc1.svFullName')} <span className="text-rose-400">*</span></label>
                  <input value={form.name} onChange={(e) => { set('name', e.target.value); err.clear('name'); }} type="text" placeholder={t('misc1.svYourName')} className={field + err.cx('name')} data-err="name" />
                  <FieldError show={err.has('name')}>{err.msg('name')}</FieldError>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('misc1.svMobile')} <span className="text-rose-400">*</span></label>
                  <div data-err="phone"><MobileField value={form.phone} onChange={(v) => { set('phone', v); err.clear('phone'); }} error={err.has('phone')} inputClassName="px-4 py-3" /></div>
                  <FieldError show={err.has('phone')}>{err.msg('phone')}</FieldError>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('misc1.svMessage')} <span className="text-gray-500 font-normal">{t('misc1.svOptional')}</span></label>
                  <textarea value={form.msg} onChange={(e) => set('msg', e.target.value)} rows={3} placeholder={t('misc1.svMsgPlaceholder')} className={field + ' resize-none'} />
                </div>
              </div>

              {booked ? (
                <div className="mt-6 text-center">
                  <p className="text-emerald-400 text-sm font-medium"><Icon name="check-circle-2" className="w-4 h-4 inline" /> {t('misc1.svBookedMsg')}</p>
                  <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
                    {ownerMobile && (() => {
                      const listingName = (propTitle || 'the property').split(' in ')[0];
                      const text = `Hi, I've requested a ${mode} visit to ${listingName} on ${displayDate(visitDate)} at ${visitTime} (via PuneNest). Could you confirm the slot?`;
                      const href = `https://wa.me/91${(ownerMobile || '').replace(/\D/g, '').replace(/^91/, '')}?text=${encodeURIComponent(text)}`;
                      return (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold py-2.5 px-4 transition-colors">
                          <Icon name="message-circle" className="w-4 h-4" /> {t('misc1.svMessageOwnerWA')}
                        </a>
                      );
                    })()}
                    <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-teal-400 text-sm font-medium hover:text-teal-300 transition-colors"><Icon name="layout-grid" className="w-4 h-4" /> {t('misc1.svTrackDashboard')}</Link>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-gray-300"><Icon name={mode === 'video' ? 'video' : 'map-pin'} className="w-3.5 h-3.5 text-teal-400" /> {mode === 'video' ? t('misc1.svVideoTour') : t('misc1.svInPerson')}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-gray-300"><Icon name="calendar" className="w-3.5 h-3.5 text-teal-400" /> {displayDate(visitDate)}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-gray-300"><Icon name="clock" className="w-3.5 h-3.5 text-teal-400" /> {visitTime}</span>
                  </div>
                  <button onClick={confirm} disabled={busy} className="btn-teal w-full mt-3 py-3.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"><Icon name="calendar-check" className="w-4 h-4" /> {t('misc1.svConfirmVisit')}</button>
                </>
              )}
            </div>

            {/* Property summary */}
            <div className="reveal">
              <div className="glass-card rounded-2xl overflow-hidden sticky top-28">
                {listing ? (
                  <>
                    <img src={listing.image || FALLBACK_IMG} className="w-full h-40 object-cover" alt={listing.title || t('misc1.svPropertyAlt')} />
                    <div className="p-5">
                      <p className="text-xl font-bold gradient-text">{priceLabel(listing)}</p>
                      <p className="text-white font-semibold mt-1">{listing.title}</p>
                      <p className="text-gray-500 text-xs flex items-center gap-1 mt-1"><Icon name="map-pin" className="w-3 h-3 text-teal-400" /> {listing.locality}, {cityLabelFor(listing)}</p>
                      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/8 text-gray-400 text-xs">
                        {listing.bhk && <span className="flex items-center gap-1"><Icon name="bed-double" className="w-3.5 h-3.5" /> {listing.bhk}</span>}
                        {listing.area ? <span className="flex items-center gap-1"><Icon name="maximize" className="w-3.5 h-3.5" /> {fmtNum(listing.area)} {t('misc1.svSqft')}</span> : null}
                      </div>
                      <div className="flex items-center gap-3 mt-4 pt-4 border-t border-white/8">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white font-bold text-xs">{avatarFor(listing.owner)}</div>
                        <div className="flex-1"><p className="text-white text-sm font-medium">{listing.owner || t('misc1.svOwner')}</p><p className="text-gray-500 text-xs">{t('misc1.svOwner')}{listing.ownerVerified ? ' · ' + t('misc1.svPuneNestVerified') : ''}</p></div>
                        <Link to={`/property/${listing.id}`} className="text-teal-400 text-xs hover:text-teal-300">{t('misc1.svView')}</Link>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="p-6 text-center">
                    <div className="w-12 h-12 rounded-xl bg-teal-400/15 flex items-center justify-center mx-auto mb-3"><Icon name="calendar-check" className="w-6 h-6 text-teal-400" /></div>
                    <p className="text-white font-semibold text-sm">{t('misc1.svBookVisit')}</p>
                    <p className="text-gray-400 text-xs mt-1">{t('misc1.svBookVisitSub')}</p>
                    <Link to="/listings" className="btn-outline inline-flex items-center justify-center gap-2 mt-4 py-2.5 px-4 rounded-xl text-sm"><Icon name="search" className="w-4 h-4" /> {t('misc1.svBrowseListings')}</Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
