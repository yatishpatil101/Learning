import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { X } from 'lucide-react';
import { useCity } from '../context/CityContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import MobileField from './MobileField.jsx';

const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^91/, '');

/* Bottom waitlist banner + waitlist/request modal — the consumer-facing half of
   the PNCity system (ports renderBar / openWaitlist / openRequest from auth.js). */
export default function CityChrome() {
  const { city, isLive, setCity, modal, openWaitlist, closeModal, requestCity } = useCity();
  const { toast } = useToast();
  const { user } = useAuth();
  const { pathname } = useLocation();

  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('pncBarX');
    } catch {
      return null;
    }
  });

  const live = isLive(city);
  const barAllowed = pathname !== '/signin' && pathname !== '/signup' && !pathname.startsWith('/view-documents');
  const showBar = barAllowed && !live && dismissed !== city;

  const dismiss = () => {
    try {
      sessionStorage.setItem('pncBarX', city);
    } catch {
      /* ignore */
    }
    setDismissed(city);
  };

  return (
    <>
      {showBar ? (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(var(--pn-bottom-inset)+18px)] z-[1200] w-[min(680px,calc(100%-24px))]">
          <div className="flex items-center gap-3 rounded-2xl border border-white/12 bg-[#15122a]/95 px-4 py-3 shadow-2xl shadow-black/50 backdrop-blur flex-wrap">
            <span className="text-lg">🚧</span>
            <span className="text-[12.5px] leading-snug text-gray-300 flex-1 min-w-0">
              PuneNest isn't live in <b className="text-white">{city}</b> yet — join the waitlist and we'll notify you the moment we launch.
            </span>
            <button onClick={() => openWaitlist(city)} className="btn btn-primary btn-sm flex-shrink-0">
              Join the waitlist
            </button>
            <button onClick={() => setCity('Pune')} className="btn btn-secondary btn-sm flex-shrink-0">
              Switch to Pune
            </button>
            <button onClick={dismiss} aria-label="Dismiss" className="flex-shrink-0 px-1 text-xl leading-none text-gray-400 hover:text-white">
              &times;
            </button>
          </div>
        </div>
      ) : null}

      {modal ? (
        <CityModal modal={modal} user={user} onClose={closeModal} onSubmit={(payload, msg) => { requestCity(payload); closeModal(); setCity('Pune'); toast(msg, 'success'); }} />
      ) : null}
    </>
  );
}

function CityModal({ modal, user, onClose, onSubmit }) {
  const isWaitlist = modal.type === 'waitlist';
  const cityName = modal.city;
  const [form, setForm] = useState({ city: '', name: user?.name || '', mobile: digits(user?.mobile), email: user?.email || '' });
  const [err, setErr] = useState('');
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const submit = () => {
    const target = isWaitlist ? cityName : form.city.trim();
    if (!isWaitlist && !target) { setErr('Enter a city name'); return; }
    if (!form.name.trim()) { setErr('Please enter your name'); return; }
    const mob = digits(form.mobile);
    if (!/^[6-9]\d{9}$/.test(mob)) { setErr('Enter a valid 10-digit mobile number'); return; }
    onSubmit(
      { city: target, name: form.name.trim(), mobile: mob, email: form.email.trim() },
      isWaitlist ? `You're on the ${target} waitlist 🎉` : `Thanks! We've noted your request for ${target}`,
    );
  };

  const fld = 'w-full rounded-[11px] border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20';

  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-[440px] overflow-hidden rounded-[20px] border border-white/12 bg-[#14121f] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/8 px-[18px] py-4">
          <h3 className="text-base font-bold text-white">{isWaitlist ? `Join the ${cityName} waitlist` : 'Request your city'}</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-[18px] py-4">
          <p className="mb-3.5 text-[13px] leading-relaxed text-gray-400">
            {isWaitlist ? (
              <>We're launching in <b className="text-brand-teal">{cityName}</b> soon. Join the waitlist and we'll notify you the moment we go live.</>
            ) : (
              <>Tell us where you'd like PuneNest next. The most-requested cities jump our expansion queue.</>
            )}
          </p>
          {!isWaitlist ? (
            <label className="mb-3 block text-[12.5px] font-semibold text-gray-300">Which city?
              <input value={form.city} onChange={(e) => set('city', e.target.value)} className={fld + ' mt-1.5'} placeholder="City name" />
            </label>
          ) : null}
          <label className="mb-3 block text-[12.5px] font-semibold text-gray-300">Your name
            <input value={form.name} onChange={(e) => set('name', e.target.value)} className={fld + ' mt-1.5'} placeholder="Your name" />
          </label>
          <label className="mb-3 block text-[12.5px] font-semibold text-gray-300">Mobile number
            <MobileField value={form.mobile} onChange={(v) => set('mobile', v)} className="mt-1.5" />
          </label>
          {isWaitlist ? (
            <label className="mb-1 block text-[12.5px] font-semibold text-gray-300">Email (optional)
              <input value={form.email} onChange={(e) => set('email', e.target.value)} className={fld + ' mt-1.5'} placeholder="you@example.com" />
            </label>
          ) : null}
          {err ? <p className="mt-1 text-xs text-rose-300">{err}</p> : null}
        </div>
        <div className="flex justify-end gap-2.5 border-t border-white/8 px-[18px] py-3">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={submit} className="btn btn-primary">
            {isWaitlist ? 'Notify me when live' : 'Request city'}
          </button>
        </div>
      </div>
    </div>
  );
}
