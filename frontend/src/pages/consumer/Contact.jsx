import NativeSelect from '../../components/ui/NativeSelect.jsx';
import FieldError from '../../components/ui/FieldError.jsx';
import { useState, useRef, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import MobileField from '../../components/MobileField.jsx';
import { useScrollReveal } from '../../lib/useScrollReveal.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useFieldErrors } from '../../lib/hooks.js';
import { maskPhone } from '../../lib/contact.js';
import { rawDb } from '../../lib/mockApi.js';
import { fmtINR } from '../../lib/format.js';

const SUBJECTS = ['Buying this property', 'Renting this property', 'Site visit', 'Home Loan Assistance', 'General enquiry'];
const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^91/, '');
const WA_SUPPORT = `https://wa.me/919876543210?text=${encodeURIComponent('Hi PuneNest, I need help with a property enquiry.')}`;

function titleOf(p) {
  if (!p) return '';
  if (p.title) return p.title;
  return `${p.bhkNum ? p.bhkNum + ' BHK ' : ''}${p.type || 'Property'}`;
}

export default function Contact() {
  const rootRef = useScrollReveal();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const subj = params.get('subject');
  const ref = params.get('ref');

  // When arriving via a "Contact about this property" link (?ref=<id>), look up the
  // listing so we can show what the enquiry is about and prefill sensible defaults.
  const refListing = useMemo(() => {
    if (!ref) return null;
    try { return rawDb().listings.find((p) => p.id === ref) || null; } catch { return null; }
  }, [ref]);
  const refTitle = titleOf(refListing);

  const presel = subj
    ? SUBJECTS.find((s) => s.toLowerCase().includes(subj.toLowerCase())) || SUBJECTS[0]
    : refListing
    ? (refListing.deal === 'rent' ? 'Renting this property' : 'Buying this property')
    : SUBJECTS[0];
  const preMsg = refListing
    ? `Hi, I'd like more details about ${refTitle}${
        refListing.locality && !refTitle.toLowerCase().includes(refListing.locality.toLowerCase())
          ? ` in ${refListing.locality}`
          : ''
      }${refListing.id ? ` (Ref: ${refListing.id})` : ''}.`
    : '';

  // Direct-contact owner is only meaningful when an actual listing is referenced.
  // Otherwise this is a general support page and we must not invent a phantom owner.
  const owner = refListing
    ? {
        name: refListing.owner || 'Owner',
        mobile: refListing.ownerMobile || '',
        profile: refListing.ownerId ? `/owner/${refListing.ownerId}` : '/owner',
      }
    : null;
  const ownerInitials = (owner?.name || 'O')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();


  const [form, setForm] = useState({ name: '', phone: '', email: '', subject: presel, msg: preMsg });
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const formRef = useRef(null);
  const err = useFieldErrors(formRef);

  const send = () => {
    const d = digits(form.phone);
    const ok = err.check([
      { name: 'name', ok: !!form.name.trim(), msg: t('misc1.contactErrName') },
      { name: 'phone', ok: /^[6-9]\d{9}$/.test(d), msg: t('misc1.contactErrPhone') },
      { name: 'email', ok: !form.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email), msg: t('misc1.contactErrEmail') },
      { name: 'msg', ok: !!form.msg.trim(), msg: t('misc1.contactErrMsg') },
    ], toast);
    if (!ok) return;
    setSending(true);
    setTimeout(() => {
      setSending(false);
      setSent(true);
    }, 1200);
  };

  const fld = 'field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500';

  const focusEnquiry = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => document.getElementById('ct-name')?.focus(), 350);
  };

  return (
    <div ref={rootRef}>
      <main className="pt-8 lg:pt-10 pb-20 min-h-[100dvh]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-6 sm:mb-10 reveal">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs font-semibold mb-3">
              {t('misc1.contactBadge')}
            </span>
            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">{t('misc1.contactTitle')}</h1>
            <p className="text-gray-400 text-sm max-w-lg">{t('misc1.contactSubtitle')}</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
            {/* Enquiry form */}
            <div className="glass-card rounded-2xl p-6 sm:p-8 reveal order-2 lg:order-1" ref={formRef}>
              <h2 className="text-lg font-bold text-white mb-5">{t('misc1.contactSendEnquiry')}</h2>
              {refListing ? (
                <Link to={`/property/${refListing.id}`} className="flex items-center gap-3 mb-5 p-3 rounded-xl bg-teal-500/10 border border-teal-500/20 hover:bg-teal-500/15 transition-colors">
                  <img src={refListing.image} alt="" width={56} height={44} className="w-14 h-11 rounded-lg object-cover shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wider text-teal-300/80 font-semibold">{t('misc1.contactEnquiringAbout')}</p>
                    <p className="text-sm font-semibold text-white truncate">{refTitle}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {refListing.locality ? `${refListing.locality} · ` : ''}
                      {refListing.deal === 'rent' ? `₹${(refListing.price || 0).toLocaleString('en-IN')}/mo` : fmtINR(refListing.price)}
                    </p>
                  </div>
                  <Icon name="arrow-right" className="w-4 h-4 text-teal-400 ml-auto shrink-0" />
                </Link>
              ) : null}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ct-name" className="block text-sm font-medium text-gray-300 mb-2">{t('misc1.contactFullName')} <span className="text-rose-400">*</span></label>
                  <input id="ct-name" value={form.name} onChange={(e) => { set('name', e.target.value); err.clear('name'); }} type="text" placeholder={t('misc1.contactYourName')} className={fld + err.cx('name')} data-err="name" />
                  <FieldError show={err.has('name')}>{err.msg('name')}</FieldError>
                </div>
                <div>
                  <label htmlFor="ct-phone" className="block text-sm font-medium text-gray-300 mb-2">{t('misc1.contactMobile')} <span className="text-rose-400">*</span></label>
                  <div data-err="phone"><MobileField id="ct-phone" value={form.phone} onChange={(v) => { set('phone', v); err.clear('phone'); }} error={err.has('phone')} inputClassName="px-4 py-3" /></div>
                  <FieldError show={err.has('phone')}>{err.msg('phone')}</FieldError>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="ct-email" className="block text-sm font-medium text-gray-300 mb-2">{t('misc1.contactEmail')} <span className="text-gray-500 font-normal">{t('misc1.contactOptional')}</span></label>
                  <input id="ct-email" value={form.email} onChange={(e) => { set('email', e.target.value); err.clear('email'); }} type="email" placeholder="you@example.com" className={fld + err.cx('email')} data-err="email" />
                  <FieldError show={err.has('email')}>{err.msg('email')}</FieldError>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('misc1.contactInterestedIn')}</label>
                  <NativeSelect value={form.subject} onChange={(e) => set('subject', e.target.value)} className={fld}>
                    {SUBJECTS.map((s) => <option key={s}>{s}</option>)}
                  </NativeSelect>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="ct-msg" className="block text-sm font-medium text-gray-300 mb-2">{t('misc1.contactMessage')} <span className="text-rose-400">*</span></label>
                  <textarea id="ct-msg" value={form.msg} onChange={(e) => { set('msg', e.target.value); err.clear('msg'); }} rows={4} placeholder={t('misc1.contactMsgPlaceholder')} className={fld + ' resize-none' + err.cx('msg')} data-err="msg" />
                  <FieldError show={err.has('msg')}>{err.msg('msg')}</FieldError>
                </div>
              </div>
              <label className="flex items-center gap-2.5 mt-4 cursor-pointer">
                <input type="checkbox" defaultChecked className="accent-teal-500 w-4 h-4" />
                <span className="text-xs text-gray-400">{t('misc1.contactConsent')}</span>
              </label>
              {sent ? (
                <p className="mt-5 text-center text-emerald-400 text-sm font-medium"><Icon name="check-circle-2" className="w-4 h-4 inline" /> {t('misc1.contactSentMsg')}</p>
              ) : (
                <button onClick={send} disabled={sending} className="btn-teal w-full mt-5 py-3.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">{sending ? <><Icon name="loader-2" className="w-4 h-4 animate-spin" /> {t('misc1.contactSending')}</> : <><Icon name="send" className="w-4 h-4" /> {t('misc1.contactSendBtn')}</>}</button>
              )}
            </div>

            {/* Right rail: real owner contact (only with a property ref) + genuine support.
                On mobile it sits ABOVE the form so the fast paths (quick contact / verified
                owner CTA) are the first thing a thumb reaches; desktop keeps it on the right. */}
            <div className="space-y-4 reveal order-1 lg:order-2">
              {owner ? (
                <div className="glass-card rounded-2xl p-6">
                  <h2 className="text-lg font-bold text-white mb-4">{t('misc1.contactDirectTitle')}</h2>
                  <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <Icon name="hand-coins" className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs text-emerald-300 font-medium">{t('misc1.contactNoBrokerage')}</span>
                  </div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white font-bold">{ownerInitials}</div>
                    <div><p className="text-white font-semibold">{owner.name}</p><p className="text-gray-500 text-xs flex items-center gap-1"><Icon name="badge-check" className="w-3.5 h-3.5 text-teal-400" /> {t('misc1.contactVerifiedOwner')}</p></div>
                  </div>
                  <div className="space-y-2.5">
                    <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3">
                      <div className="flex items-center gap-2 text-sm text-slate-300">
                        <Icon name="phone-off" className="w-4 h-4 text-slate-500" />
                        <span className="tracking-wider">{maskPhone(owner.mobile)}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1"><Icon name="lock-keyhole" className="w-3 h-3" /> {t('misc1.contactHiddenPrivacy')}</p>
                    </div>
                    <button type="button" onClick={focusEnquiry} className="btn-teal w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-semibold"><Icon name="lock-keyhole" className="w-4 h-4" /> {t('misc1.contactRequestIt')}</button>
                    <Link to={owner.profile} className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-white/5 text-gray-300 text-sm hover:bg-white/10 transition-all"><Icon name="user" className="w-4 h-4" /> {t('misc1.contactViewOwnerProfile')}</Link>
                  </div>
                </div>
              ) : null}

              <div className="glass-card rounded-2xl p-6">
                <p className="text-white font-semibold text-sm mb-1">{t('misc1.contactSupportTitle')}</p>
                <p className="text-gray-500 text-xs mb-3">{t('misc1.contactSupportHours')}</p>
                <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded-xl bg-teal-500/10 border border-teal-500/20">
                  <Icon name="clock" className="w-4 h-4 text-teal-400" />
                  <span className="text-xs text-teal-300 font-medium">{t('misc1.contactResponseTime')}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 lg:grid-cols-1 lg:gap-2.5">
                  <a href="tel:18002000000" className="flex flex-col lg:flex-row items-center gap-1.5 lg:gap-3 min-h-[44px] py-3 px-2 lg:px-4 rounded-xl bg-white/5 border border-white/10 text-gray-200 text-sm hover:bg-white/10 transition-all">
                    <Icon name="headset" className="w-4 h-4 text-teal-400 shrink-0" />
                    <span className="font-semibold text-xs lg:hidden">{t('misc1.contactCall')}</span>
                    <span className="font-semibold hidden lg:inline">1800 200 0000</span>
                  </a>
                  <a href={WA_SUPPORT} target="_blank" rel="noopener noreferrer" className="flex flex-col lg:flex-row items-center gap-1.5 lg:gap-3 min-h-[44px] py-3 px-2 lg:px-4 rounded-xl border border-emerald-500/20 text-emerald-300 text-sm hover:bg-emerald-500/10 transition-all">
                    <Icon name="message-circle" className="w-4 h-4 shrink-0" />
                    <span className="font-semibold text-xs lg:hidden">{t('misc1.contactWhatsappShort')}</span>
                    <span className="font-semibold hidden lg:inline">{t('misc1.contactWhatsapp')}</span>
                  </a>
                  <a href="mailto:hello@punenest.com" className="flex flex-col lg:flex-row items-center gap-1.5 lg:gap-3 min-h-[44px] py-3 px-2 lg:px-4 rounded-xl bg-white/5 border border-white/10 text-gray-200 text-sm hover:bg-white/10 transition-all">
                    <Icon name="mail" className="w-4 h-4 text-teal-400 shrink-0" />
                    <span className="font-semibold text-xs lg:hidden">{t('misc1.contactEmailShort')}</span>
                    <span className="truncate hidden lg:inline">hello@punenest.com</span>
                  </a>
                </div>
                <p className="mt-3 text-[11px] text-gray-500 flex items-center gap-1.5"><Icon name="shield-check" className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> {t('misc1.contactNoSpam')}</p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Sticky mobile quick-contact bar — PuneNest support (not the gated owner number).
          Hidden on lg where the rail is already visible. The Nestor FAB lifts above it. */}
      <div className="pn-sticky-cta lg:hidden" role="navigation" aria-label="Quick contact support">
        <a href="tel:18002000000" className="btn-teal flex-1 min-h-[44px] flex items-center justify-center gap-1.5 text-sm font-semibold py-3 px-4 focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0d1a]"><Icon name="phone" className="w-4 h-4" /> {t('misc1.contactCall')}</a>
        <a href={WA_SUPPORT} target="_blank" rel="noopener noreferrer" className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold py-3 px-4 focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0d1a]"><Icon name="message-circle" className="w-4 h-4" /> {t('misc1.contactWhatsappShort')}</a>
      </div>
    </div>
  );
}
