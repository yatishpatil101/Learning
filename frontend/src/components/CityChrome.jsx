import { useCallback, useEffect, useState } from 'react';
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
          {/* Phones stack (copy row, then a full-width button row) because the copy
              collapsed to a 1-word column when everything shared one flex line. */}
          <div className="relative flex flex-col gap-2.5 rounded-2xl border border-white/12 bg-[#15122a]/95 px-4 py-3 pr-10 shadow-2xl shadow-black/50 backdrop-blur sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:pr-4">
            <div className="flex items-start gap-2.5 sm:flex-1 sm:min-w-0 sm:items-center">
              <span className="text-lg leading-none">🚧</span>
              <span className="text-[12.5px] leading-snug text-gray-300">
                PuneNest isn't live in <b className="text-white">{city}</b> yet — join the waitlist and we'll notify you the moment we launch.
              </span>
            </div>
            <div className="flex items-center gap-2 sm:flex-shrink-0 sm:gap-3">
              <button onClick={() => openWaitlist(city)} className="btn btn-primary btn-sm flex-1 sm:flex-none">
                Join the waitlist
              </button>
              <button onClick={() => setCity('Pune')} className="btn btn-secondary btn-sm flex-1 sm:flex-none">
                Switch to Pune
              </button>
            </div>
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              className="absolute right-2 top-2 px-1 text-xl leading-none text-gray-400 hover:text-white sm:static sm:flex-shrink-0"
            >
              &times;
            </button>
          </div>
        </div>
      ) : null}

      {modal ? (
        <CityModal
          modal={modal}
          user={user}
          onClose={closeModal}
          /* The ask is a `POST /cities/waitlist`, so the success toast has to wait for it.
             It used to be a localStorage write, which cannot fail, so the modal closed and
             said "you're on the list" unconditionally. Rejecting leaves the modal open with
             the form still filled, because the only useful thing to do with a failed ask is
             try it again. */
          onSubmit={async (payload, msg) => {
            await requestCity(payload);
            closeModal();
            // Only relocate when they're stranded on a city that isn't live (a persisted
            // pick, or one an admin took offline) — picking from the dropdown never moved them.
            // Re-read liveness here rather than closing over the render's `live`: a
            // `punenest-settings-change` arriving mid-POST can launch this very city, and
            // relocating them away from a city that just went live is the wrong move.
            if (!isLive(city)) setCity('Pune');
            toast(msg, 'success');
          }}
        />
      ) : null}
    </>
  );
}

function CityModal({ modal, user, onClose, onSubmit }) {
  const isWaitlist = modal.type === 'waitlist';
  const cityName = modal.city;
  /* No `name`. The field used to be here and was *required*, but `requestCity` never forwarded it,
     `CityWaitlistCreateRequest` has no such property and `city_waitlist` has no column — so a
     shopper was blocked on a value that was discarded one function later. Nor is there a reader to
     justify adding one: `GET /admin/cities/waitlist` is aggregate-only by design. A waitlist needs
     a way to reach you when the city opens, and nothing else. */
  const [form, setForm] = useState({ city: '', mobile: digits(user?.mobile), email: user?.email || '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  /* Every way out of this modal is sealed while the POST is in flight, not just the submit button.
     `onSubmit` is a closure over `CityChrome`, which does not unmount when the modal does — so a
     mid-flight Escape or backdrop click used to leave the continuation running, and a shopper who
     had just cancelled would still get relocated to Pune and congratulated. The request is short
     and the button already reads "Sending…", so refusing to close is honest rather than obstructive. */
  const requestClose = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && requestClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [requestClose]);

  const submit = async () => {
    if (busy) return;
    const target = isWaitlist ? cityName : form.city.trim();
    if (!isWaitlist && !target) { setErr('Enter a city name'); return; }
    const mob = digits(form.mobile);
    if (!/^[6-9]\d{9}$/.test(mob)) { setErr('Enter a valid 10-digit mobile number'); return; }
    /* Scoped to the waitlist branch, because that is the only branch with an email field. It is
       seeded from the signed-in account, so in the "Request your city" modal an unscoped read would
       both send an address the shopper was never shown, and — if that stored address fails the test
       below — refuse the submit while pointing at a field that is not on screen. That is the
       unwinnable retry this guard exists to prevent, arrived at from the other side. */
    const email = isWaitlist ? form.email.trim() : '';
    /* Checked here because the server's `@Email` refuses the whole request, and the only message
       this modal can render for a 400 is the generic "try again" — which would be both untrue and
       a guaranteed loop, since retrying sends the same address. Deliberately loose: the point is to
       catch a typo before it costs a round trip, not to re-implement RFC 5322. */
    if (email && !/^\S+@\S+\.\S+$/.test(email)) { setErr('Enter a valid email address, or leave it blank'); return; }
    setErr('');
    setBusy(true);
    try {
      await onSubmit(
        { city: target, mobile: mob, email },
        isWaitlist ? `You're on the ${target} waitlist 🎉` : `Thanks! We've noted your request for ${target}`,
      );
    } catch {
      /* The modal stays open on the same form, because the only useful thing to do with a refused
         ask is send it again. `setBusy(false)` runs on both paths; on the success path this
         component is unmounting, where React 19 drops the update silently. */
      setErr("We couldn't record that just now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const fld = 'w-full rounded-[11px] border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20';

  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-[440px] overflow-hidden rounded-[20px] border border-white/12 bg-[#14121f] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/8 px-[18px] py-4">
          <h3 className="text-base font-bold text-white">{isWaitlist ? `Join the ${cityName} waitlist` : 'Request your city'}</h3>
          <button onClick={requestClose} disabled={busy} aria-label="Close" className="text-gray-400 hover:text-white"><X className="h-5 w-5" /></button>
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
              {/* `maxLength` mirrors `CityWaitlistCreateRequest`'s `@Size(max = 120)`. Free text
                against a server bound, with no other guard, is the other way into an unwinnable
                retry — the field the shopper must shorten is the one thing the error can't name. */}
            <input value={form.city} onChange={(e) => set('city', e.target.value)} maxLength={120} className={fld + ' mt-1.5'} placeholder="City name" />
            </label>
          ) : null}
          <label className="mb-3 block text-[12.5px] font-semibold text-gray-300">Mobile number
            <MobileField value={form.mobile} onChange={(v) => set('mobile', v)} className="mt-1.5" />
          </label>
          {isWaitlist ? (
            <label className="mb-1 block text-[12.5px] font-semibold text-gray-300">Email (optional)
              <input value={form.email} onChange={(e) => set('email', e.target.value)} className={fld + ' mt-1.5'} placeholder="you@example.com" />
            </label>
          ) : null}
          {/* `role="alert"` because this message now arrives *after* an await. A validation error
             lands in the same paint as the click that caused it, so a screen reader picks it up;
             a server refusal arrives seconds later, with focus parked on a button that has gone
             quiet, and would otherwise never be announced at all. */}
          {err ? <p role="alert" className="mt-1 text-xs text-rose-300">{err}</p> : null}
        </div>
        <div className="flex justify-end gap-2.5 border-t border-white/8 px-[18px] py-3">
          <button onClick={requestClose} disabled={busy} className="btn btn-secondary">Cancel</button>
          <button onClick={submit} disabled={busy} aria-busy={busy} className="btn btn-primary">
            {busy ? 'Sending…' : isWaitlist ? 'Notify me when live' : 'Request city'}
          </button>
        </div>
      </div>
    </div>
  );
}
