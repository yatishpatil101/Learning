import NativeSelect from '../../components/ui/NativeSelect.jsx';
import DateField from '../../components/ui/DateField.jsx';
import AadhaarVerifyModal from '../../components/auth/AadhaarVerifyModal.jsx';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import LoadError from '../../components/LoadError.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { maskPhone } from '../../lib/contact.js';

import { myTenantProfile, saveTenantProfile } from '../../services/rentService.js';
import { useVerification } from '../../context/VerificationContext.jsx';

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function TenantProfile() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  // The opt-in Aadhaar badge, held once in VerificationContext. Mirrored into the profile below
  // (`idVerified` + `kyc`) so a user who verified elsewhere is not asked again.
  const { verified: badgeVerified, aadhaarMobile, verifiedAt, mobileMatch } = useVerification();
  /* The form opens empty and is filled by the two effects below — the profile from
     `myTenantProfile()`, the identity half from `useVerification()`. It used to seed from a
     `pnTenantProfile:<mobile>` blob in localStorage, which is the one source here that no longer
     has anything behind it: the merge below prefers a truthy server value, so a field the server
     had *cleared* (PUT replaces — see `TenantProfileUpdateRequest`) kept showing this browser's
     stale copy, and the copy carried a client-computed `score` for a number the server owns. */
  const [form, setForm] = useState(
    { name: user?.name || '', employment: '', income: '', occupants: '', moveIn: '', priorLandlord: '', about: '', idVerified: false, kyc: null },
  );
  const [errors, setErrors] = useState({});
  const [justSaved, setJustSaved] = useState(false);
  const [kycOpen, setKycOpen] = useState(false);
  // A read that has not answered *yet* looks exactly like one that failed: the form is empty either
  // way. `loadError` only covers the second, so between mount and the promise settling the writes
  // below were armed over a blank form — and `name` is pre-seeded from the session, so the one
  // validation gate passes. This flag covers the pending half.
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [saving, setSaving] = useState(false);
  // The `saving` flip only lands on the next render, so a second click inside that gap would sail
  // past the disabled button. The ref is the guard that closes before the paint does.
  const savingRef = useRef(false);
  // The score belongs to the server — a tenant who could compute their own would be grading the
  // number owners use to decide about them. It arrives with the profile and is refreshed by every
  // save, so it moves as the checklist below is completed.
  const [score, setScore] = useState(null);
  const nameRef = useRef(null);

  /* Hydrate from the server once it answers.

     `kyc` does **not** come from it and must survive the merge: `TenantProfileDto` carries a
     server-owned `verified` flag but no record of *what* was verified, so the masked-number
     display below is assembled from the badge instead (next effect).

     The wire calls the job `occupation`; this form has always called it `employment`. Translated at
     the boundary rather than renaming a field the whole page reads. */
  useEffect(() => {
    let alive = true;
    myTenantProfile()
      .then((p) => {
        if (!alive) return;
        setLoadError(null);
        setLoaded(true);
        if (!p) return;
        setScore(p.score ?? null);
        setForm((prev) => ({
          ...prev,
          name: p.name || prev.name,
          employment: p.occupation || prev.employment,
          income: p.income == null ? prev.income : String(p.income),
          occupants: p.occupants || prev.occupants,
          moveIn: p.moveIn || prev.moveIn,
          priorLandlord: p.priorLandlord || prev.priorLandlord,
          about: p.about || prev.about,
          // Server verification counts too, but never *downgrades* a local one.
          idVerified: prev.idVerified || p.verified,
        }));
      })
      /* A read that failed and an empty profile look identical in this form, and `PUT` replaces the
         whole record — so one save over unread data silently deletes fields the user never saw.
         Of the two options that closes the hole, blocking the save is the safer: a banner alone
         leaves the button armed, and the destructive click is the easy one to make. */
      .catch((err) => { if (alive) { setLoaded(true); setLoadError(err || new Error('tenant profile load failed')); } });
    return () => { alive = false; };
  }, [reloadNonce]);

  /* Identity is one Aadhaar per person: if the badge is (or becomes) verified anywhere — the
     contact gate, a dashboard nudge, or the modal on this page — mirror it into the profile instead
     of asking again. Never downgrades; the server's own `verified` flag is merged separately above.

     The guard is on `kyc`, not on `idVerified`, because these two effects race: the profile read can
     land first and set `idVerified` from `p.verified`, and an `idVerified`-only guard would then
     bail out and leave `kyc` null forever — taking the stale-verification check below with it. */
  useEffect(() => {
    if (!badgeVerified) return;
    // Read outside the updater: StrictMode double-invokes it, and a clock inside would stamp the
    // two runs differently — an updater has to answer the same thing every time it is replayed.
    const mirrored = { type: 'aadhaar', label: 'Aadhaar', masked: maskPhone(aadhaarMobile || user?.mobile || ''), verifiedAt: verifiedAt || Date.now() };
    setForm((prev) => (prev.idVerified && prev.kyc ? prev : {
      ...prev,
      idVerified: true,
      kyc: prev.kyc || mirrored,
    }));
  }, [badgeVerified, aadhaarMobile, verifiedAt, user?.mobile]);
  const persist = async (next) => {
    try {
      const saved = await saveTenantProfile({
        name: next.name,
        occupation: next.employment,
        income: next.income ? Number(next.income) : undefined,
        occupants: next.occupants,
        moveIn: next.moveIn || undefined,
        priorLandlord: next.priorLandlord,
        about: next.about,
      });
      // The save returns the freshly recomputed score, so the meter moves on the same round-trip
      // that changed the fields feeding it.
      if (saved && saved.score != null) setScore(saved.score);
      return true;
    } catch (err) {
      // `ApiError` carries `code`/`message`/`status`/`traceId`/`fields` and never a `body`, so the
      // old `err.body.error` read undefined and every save failure fell through to the generic copy.
      toast(err?.message || t('misc.tpProfileSaveFailed'), 'error');
      return false;
    }
  };

  const set = (k, v) => { setForm((p) => ({ ...p, [k]: v })); setJustSaved(false); };
  const setIncome = (v) => set('income', String(v).replace(/\D/g, '').slice(0, 9));
  const s = score;
  // Until the server answers there is no score to show. A dash reads as "not known yet"; a 0 would
  // tell a tenant with a complete profile that they scored nothing.
  const sLabel = s == null ? '—' : `${s}%`;
  const sWidth = `${s || 0}%`;

  /* What is still missing, and what each item is worth.

     These weights are the server's (`TenantProfileService.score`), restated here so the checklist
     can say *why* the meter sits where it does. They are a fixed, published rubric rather than a
     second implementation of the score: nothing here adds up to a number the page displays. */
  const factors = [
    { key: 'idVerified', label: t('misc.tpBoostId'), pts: 30, done: !!form.idVerified },
    { key: 'employment', label: t('misc.tpBoostOccupation'), pts: 20, done: !!form.employment },
    { key: 'income', label: t('misc.tpBoostIncome'), pts: 15, done: !!(form.income && Number(form.income) > 0) },
    { key: 'priorLandlord', label: t('misc.tpBoostLandlord'), pts: 15, done: !!form.priorLandlord },
    { key: 'about', label: t('misc.tpBoostAbout'), pts: 10, done: !!form.about },
    { key: 'occupants', label: t('misc.tpBoostOccupants'), pts: 10, done: !!form.occupants },
  ];
  const pending = factors.filter((f) => !f.done);
  // Rendered twice: the mobile progress header and the desktop aside show the same meter.
  const scoreBar = <div className="h-2 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-label={t('misc.tpTrustScore')} aria-valuenow={s ?? undefined} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full" style={{ width: sWidth, background: 'linear-gradient(90deg,#0d9488,#14b8a6)' }} /></div>;
  const boostSub = pending.length ? t('misc.tpBoostSub', { count: pending.length }) : t('misc.tpBoostDone');

  // Re-verification is only warranted when the identity assurance breaks — i.e. the
  // Aadhaar-linked mobile the user verified against no longer matches their current
  // account number (number change / account moved). An unchanged verified user is
  // never nagged to re-verify. (Admin/ops revocation clears idVerified separately,
  // which falls back to the normal "Verify now" prompt.)
  //
  // The comparison is the server's, read off the badge: DigiLocker returns no mobile, so the wire
  // carries none (`aadhaarMobile: ''` in the http mapper) and comparing the masked display against
  // the account number could only ever fire against the mock. `mobileMatch` is a tri-state — `null`
  // is "not recorded", which is not evidence of a mismatch, so only an explicit `false` counts.
  const verificationStale = !!(form.idVerified && form.kyc && mobileMatch === false);

  const onVerified = async () => {
    // The shared AadhaarVerifyModal has already started the seam write and (in mock) recorded the
    // badge, which VerificationContext has refreshed. Mirror it into the form, then save: the badge
    // itself is the server's and survives a reload on its own, but `PUT /me/tenant-profile`
    // recomputes `verified` and `score`, so this is what moves the meter to include the +30.
    const masked = maskPhone(aadhaarMobile || user?.mobile || '');
    const next = { ...form, idVerified: true, kyc: { type: 'aadhaar', label: 'Aadhaar', masked, verifiedAt: verifiedAt || Date.now() } };
    setForm(next);
    setKycOpen(false);
    setJustSaved(false);
    try {
      // Only claim success once the write lands: a green toast chased half a second later by the red
      // one `persist` raises tells the user two different things about the same save.
      if (await persist(next)) toast(t('misc.tpKycVerified', { label: 'Aadhaar' }), 'success');
    } catch (err) {
      // The modal calls this without awaiting, so anything escaping here would surface as an
      // unhandled rejection instead of in front of the user.
      toast(err?.message || t('misc.tpProfileSaveFailed'), 'error');
    }
  };

  const save = async (e) => {
    e.preventDefault();
    if (savingRef.current) return;
    if (!form.name.trim()) {
      setErrors({ name: true });
      toast(t('misc.tpNameRequired'), 'error');
      nameRef.current?.focus();
      nameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setErrors({});
    savingRef.current = true;
    setSaving(true);
    try {
      // Two PUTs in flight is a lost update, not a duplicate: the endpoint replaces the record, so
      // the slower answer quietly reverts whatever the faster one wrote.
      if (!(await persist({ ...form, name: form.name.trim() }))) return;
      setJustSaved(true);
      toast(t('misc.tpProfileSaved'), 'success');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const incomeDisplay = form.income ? Number(form.income).toLocaleString('en-IN') : '';

  const meta = [];
  if (form.employment) meta.push(['briefcase', form.employment]);
  if (form.income && Number(form.income) > 0) meta.push(['wallet', '₹' + Number(form.income).toLocaleString('en-IN') + t('misc.tpMoIncomeSuffix')]);
  if (form.occupants) meta.push(['users', form.occupants]);
  if (form.moveIn) meta.push(['calendar', t('misc.tpMoveInPrefix') + form.moveIn]);

  return (
    <div className="pt-8 sm:pt-10 pb-20 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-11 h-11 rounded-xl bg-emerald-400/15 flex items-center justify-center"><Icon name="user-check" className="w-6 h-6 text-emerald-300" /></div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold">{t('misc.tpTitle')}</h1>
          <p className="text-gray-400 text-sm">{t('misc.tpSubtitle')}</p>
        </div>
        {form.idVerified && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 px-3 py-1 text-xs font-bold text-emerald-300 whitespace-nowrap">
            <Icon name="shield-check" className="w-3.5 h-3.5" /> {t('misc.tpSeriousBuyer')}
          </span>
        )}
      </div>

      {/* Mobile-only progress header — puts the payoff and live feedback above the form
          so tenants see their score climb as they fill each field. Desktop shows this in the aside. */}
      <div className="glass rounded-2xl p-4 mt-4 lg:hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold inline-flex items-center gap-2"><Icon name="trending-up" className="w-4 h-4 text-emerald-400" /> {t('misc.tpTrustScore')}</span>
          <span className="text-emerald-300 font-bold text-lg">{sLabel}</span>
        </div>
        {scoreBar}
        <p className="text-xs text-gray-400 mt-2">{boostSub}</p>
      </div>

      {loadError && <LoadError message={t('common.somethingWentWrong')} error={loadError} onRetry={() => setReloadNonce((n) => n + 1)} className="glass rounded-2xl p-5 mt-4" />}

      <div className="grid lg:grid-cols-3 gap-6 mt-6">
        {/* Form */}
        <form onSubmit={save} className="lg:col-span-2 glass rounded-2xl p-6 space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="lbl" htmlFor="tp-name">{t('misc.tpFullName')}</label>
              <input ref={nameRef} id="tp-name" autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} className={'fld' + (errors.name ? ' !border-red-400/60' : '')} placeholder={t('misc.tpFullNamePlaceholder')} aria-invalid={!!errors.name} />
              {errors.name && <p className="text-xs text-red-400 mt-1">{t('misc.tpNameRequired')}</p>}
            </div>
            <div><label className="lbl" htmlFor="tp-occ">{t('misc.tpOccupation')}</label><input id="tp-occ" value={form.employment} onChange={(e) => set('employment', e.target.value)} className="fld" placeholder={t('misc.tpOccupationPlaceholder')} /></div>
            <div>
              <label className="lbl" htmlFor="tp-income">{t('misc.tpIncome')}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">₹</span>
                <input id="tp-income" value={incomeDisplay} onChange={(e) => setIncome(e.target.value)} className="fld !pl-7" inputMode="numeric" placeholder={t('misc.tpIncomePlaceholder')} />
              </div>
              <p className="text-xs text-gray-500 mt-1">{t('misc.tpIncomePrivacy')}</p>
            </div>
            <div>
              <label className="lbl">{t('misc.tpWhoLives')}</label>
              <NativeSelect value={form.occupants} onChange={(e) => set('occupants', e.target.value)} className="fld"><option value="">{t('misc.tpSelect')}</option><option>Family</option><option>Bachelor (Male)</option><option>Bachelor (Female)</option><option>Company lease</option></NativeSelect>
            </div>
            <div><label className="lbl">{t('misc.tpMoveInBy')}</label><DateField value={form.moveIn} onChange={(v) => set('moveIn', v)} min={todayISO()} className="fld" ariaLabel={t('misc.tpMoveInAria')} /></div>
            <div><label className="lbl" htmlFor="tp-landlord">{t('misc.tpPriorLandlord')}</label><input id="tp-landlord" value={form.priorLandlord} onChange={(e) => set('priorLandlord', e.target.value)} className="fld" placeholder={t('misc.tpPriorLandlordPlaceholder')} /></div>
          </div>
          <div><label className="lbl" htmlFor="tp-about">{t('misc.tpAbout')}</label><textarea id="tp-about" value={form.about} onChange={(e) => set('about', e.target.value)} rows={3} className="fld" placeholder={t('misc.tpAboutPlaceholder')} /></div>

          <div className="rounded-xl border border-emerald-500/25 p-4" style={{ background: 'rgba(16,185,129,.06)' }}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Icon name="shield-check" className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{t('misc.tpIdVerification')}</p>
                  {form.idVerified && form.kyc
                    ? (verificationStale
                      ? <p className="text-amber-300 text-xs">{t('misc.tpVerifyStale')}</p>
                      : <p className="text-emerald-300 text-xs">{form.kyc.label} · {form.kyc.masked}</p>)
                    : <p className="text-gray-400 text-xs">{t('misc.tpKycPrompt')}</p>}
                </div>
              </div>
              {form.idVerified && !verificationStale
                ? (
                  <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-400/15 text-emerald-300 inline-flex items-center gap-1 flex-shrink-0"><Icon name="badge-check" className="w-3.5 h-3.5" /> {t('misc.tpVerifiedCheck')}</span>
                )
                : <button type="button" onClick={() => setKycOpen(true)} disabled={saving || !loaded || !!loadError} className="px-4 py-2 rounded-lg text-sm font-semibold btn-teal flex-shrink-0 disabled:opacity-60 disabled:cursor-not-allowed">{form.idVerified ? t('misc.tpReverify') : t('misc.tpVerifyNow')}</button>}
            </div>
          </div>

          {/* Both writes are blocked while the profile is unread — failed *or* still in flight: each
              sends the whole form, the form is empty until the read lands, and the PUT replaces the
              record. Saving over a pending read wipes the unseen fields, and the arriving `.then`
              then repaints the old values over the cleared record, so the loss only surfaces on the
              next reload. */}
          <button type="submit" disabled={saving || !loaded || !!loadError} className="btn-teal w-full py-3 rounded-xl font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"><Icon name="save" className="w-4 h-4" /> {t('misc.tpSaveProfile')}</button>

          {justSaved && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-400/10 p-4">
              <p className="text-sm font-semibold text-emerald-200 flex items-center gap-2"><Icon name="check-circle" className="w-4 h-4" /> {t('misc.tpSavedTitle')}</p>
              <p className="text-xs text-gray-300 mt-0.5">{t('misc.tpSavedBody')}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button type="button" onClick={() => navigate('/listings')} className="btn-teal px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"><Icon name="search" className="w-4 h-4" /> {t('misc.tpBrowseRentals')}</button>
                <button type="button" onClick={() => navigate('/dashboard')} className="btn-outline px-4 py-2 rounded-lg text-sm font-semibold">{t('misc.tpBackToDashboard')}</button>
              </div>
            </div>
          )}
        </form>

        {/* Live preview + score booster */}
        <aside className="flex flex-col gap-4">
          <div className="glass rounded-2xl p-6 order-2 lg:order-1">
            <p className="text-xs text-gray-400 mb-3 uppercase tracking-wider">{t('misc.tpHowOwnersSee')}</p>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center font-bold text-lg">{(form.name || 'T').trim().charAt(0).toUpperCase()}</div>
              <div>
                <div className="flex items-center gap-1.5"><span className="font-semibold">{form.name || t('misc.tpYourName')}</span>{form.idVerified && <Icon name="badge-check" className="w-4 h-4 text-emerald-400" />}</div>
                <span className={form.idVerified ? 'text-xs text-emerald-300 font-semibold' : 'text-xs text-gray-500'}>{form.idVerified ? t('misc.tpVerifiedTenant') : t('misc.tpUnverifiedTenant')}</span>
              </div>
            </div>
            <div className="mb-3">
                <div className="flex items-center justify-between text-xs mb-1"><span className="text-gray-400">{t('misc.tpTrustScore')}</span><span className="text-emerald-300 font-bold">{sLabel}</span></div>
                {scoreBar}
            </div>
            <div className="space-y-1.5 text-sm text-gray-300">
              {meta.length ? meta.map(([ic, txt]) => <p key={txt} className="flex items-center gap-2"><Icon name={ic} className="w-4 h-4 text-teal-400" /> {txt}</p>) : <p className="text-gray-500 text-xs">{t('misc.tpFillToPreview')}</p>}
              {form.about && <p className="text-gray-400 text-xs italic border-l-2 border-white/10 pl-2 mt-2 line-clamp-3">{form.about}</p>}
            </div>
          </div>

          {/* Booster checklist — the actionable core of the page. On mobile it sits directly
              under the form (order-1); on desktop it keeps its place below the preview. */}
          <div className="glass rounded-2xl p-5 order-1 lg:order-2">
            <h3 className="font-bold text-sm mb-1 flex items-center gap-2"><Icon name="trending-up" className="w-4 h-4 text-emerald-400" /> {t('misc.tpBoostTitle')}</h3>
            <p className="text-xs text-gray-500 mb-3">{boostSub}</p>
            <ul className="space-y-2">
              {factors.map((f) => (
                <li key={f.key} className="flex items-center justify-between gap-2 text-sm">
                  <span className={'flex items-center gap-2 ' + (f.done ? 'text-gray-400' : 'text-gray-200')}>
                    <Icon name={f.done ? 'check-circle' : 'circle'} className={'w-4 h-4 ' + (f.done ? 'text-emerald-400' : 'text-gray-600')} />
                    <span className={f.done ? 'line-through decoration-white/20' : ''}>{f.label}</span>
                  </span>
                  <span className={'text-xs font-semibold ' + (f.done ? 'text-emerald-400/70' : 'text-emerald-300')}>{f.done ? '✓' : '+' + f.pts + '%'}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="glass rounded-2xl p-5 order-3 lg:order-3">
            <h3 className="font-bold text-sm mb-2 flex items-center gap-2"><Icon name="zap" className="w-4 h-4 text-amber-400" /> {t('misc.tpWhyVerify')}</h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5" /> {t('misc.tpWhy1')}</li>
              <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5" /> {t('misc.tpWhy2')}</li>
              <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5" /> {t('misc.tpWhy3')}</li>
            </ul>
          </div>
        </aside>
      </div>

      {kycOpen && (
        <AadhaarVerifyModal
          source="tenant_profile"
          subtitle={t('misc.tpKycModalSubtitle')}
          onClose={() => setKycOpen(false)}
          onVerified={onVerified}
        />
      )}
    </div>
  );
}
