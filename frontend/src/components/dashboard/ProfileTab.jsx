import { useState, useId, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import Switch from '../ui/Switch.jsx';
import Select from '../ui/Select.jsx';
import TimeField from '../ui/TimeField.jsx';
import Modal from '../ui/Modal.jsx';
import AadhaarVerifyModal from '../auth/AadhaarVerifyModal.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useVerification } from '../../context/VerificationContext.jsx';
import { initial, roleLabel, firstName } from '../../lib/auth.js';
import {
  getAppPrefs, setAppPrefs,
} from '../../lib/localPrefs.js';
import { getNotificationPreferences, updateNotificationPreferences, NOTIFICATION_PREFERENCE_DEFAULTS } from '../../services/notificationService.js';
import { exportMyData, requestErasure, myErasureRequests } from '../../services/authService.js';
import { myTenantProfile } from '../../services/rentService.js';
import { helpPath, splitLangPrefix } from '../../lib/helpUrl.js';

const Card = ({ children, className = '' }) => <div className={'glass-card rounded-2xl ' + className}>{children}</div>;
const SectionHead = ({ icon, iconCls = 'text-teal-400', title, sub }) => (
  <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
    <div><h2 className="text-lg font-bold text-white flex items-center gap-2">{icon ? <Icon name={icon} className={'w-5 h-5 ' + iconCls} /> : null} {title}</h2>{sub ? <p className="text-gray-500 text-xs mt-0.5">{sub}</p> : null}</div>
  </div>
);

// A settings section that collapses on mobile (tap the header) but stays open on
// desktop. Mirrors the PayRent payout pattern — content is `lg:block` and the
// chevron is `lg:hidden` — so phones get a scannable, space-saving accordion while
// the web view stays exactly as before.
const CollapsibleCard = ({ icon, iconCls = 'text-teal-400', title, sub, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <Card className="p-5 lg:p-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full flex items-center justify-between gap-3 text-left lg:cursor-default"
      >
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">{icon ? <Icon name={icon} className={'w-5 h-5 ' + iconCls} /> : null} {title}</h2>
          {sub ? <p className="text-gray-500 text-xs mt-0.5">{sub}</p> : null}
        </div>
        <Icon name="chevron-down" className={'w-5 h-5 text-gray-400 flex-shrink-0 transition-transform lg:hidden ' + (open ? 'rotate-180' : '')} />
      </button>
      <div id={panelId} className={(open ? 'block' : 'hidden') + ' lg:block mt-5'}>
        {children}
      </div>
    </Card>
  );
};

// One preference row: label + description on the left, control on the right.
const PrefRow = ({ title, desc, children }) => (
  <div className="flex items-start justify-between gap-4 py-2">
    <div><p className="text-sm text-white font-medium">{title}</p>{desc ? <p className="text-xs text-gray-500 mt-0.5">{desc}</p> : null}</div>
    <div className="flex-shrink-0 pt-0.5">{children}</div>
  </div>
);

// Trust chips reused in the identity header. Green = confirmed, amber = pending.
const VerifiedChip = ({ label }) => (
  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
    <Icon name="badge-check" className="w-3 h-3" /> {label}
  </span>
);
const PendingChip = ({ label, title, onClick }) => {
  const cls = 'inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/12 px-2 py-0.5 text-[11px] font-semibold text-amber-300';
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls + ' transition-colors hover:bg-amber-500/20 hover:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40'} title={title}>
        <Icon name="shield-alert" className="w-3 h-3" /> {label}
      </button>
    );
  }
  return (
    <span className={cls}>
      <Icon name="shield-alert" className="w-3 h-3" /> {label}
    </span>
  );
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'mr', label: 'मराठी (Marathi)' },
  { value: 'hi', label: 'हिंदी (Hindi)' },
];

export default function ProfileTab({ user, update, toast, isOwner }) {
  const { logout } = useAuth();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: user?.name || '', mobile: user?.mobile || '', email: user?.email || '', city: user?.city || 'Pune' });
  /* Seeded from the published defaults so the six controls render with the right shape on the first
     frame, then reconciled from the service. The seed is not a cache of the server's answer — it is
     the same defaults the server would return for a user who has never saved — so a slow read shows
     the right control types rather than an empty panel, and the effect below fills in the real
     values. It used to read this browser's saved copy, which *was* a cache: someone who changed a
     switch on their phone saw the old value flash here before the true one landed. */
  const [prefs, setPrefs] = useState(NOTIFICATION_PREFERENCE_DEFAULTS);
  const [app, setApp] = useState(() => getAppPrefs());
  /* Not seeded from a local document, because unlike the two above these two are already on the
     signed-in user: the server sends them non-nullable on every `/auth/me`, so there is always a
     real answer to render and never a gap to paper over with defaults. */
  const owner = { hideNumber: !!user?.hideNumber, verifiedContactOnly: !!user?.verifiedContactOnly };
  const [delOpen, setDelOpen] = useState(false);
  const [delText, setDelText] = useState('');
  // An erasure request already in flight. Shown instead of the form so a user who has asked is told
  // where it stands rather than being invited to ask again.
  const [erasure, setErasure] = useState(null);
  const [erasing, setErasing] = useState(false);
  const [aadhaarOpen, setAadhaarOpen] = useState(false);
  // The opt-in Aadhaar badge, held once in VerificationContext. The chip and section below
  // reflect it read-only; the modal starts the seam write (mock grants at once, production
  // redirects to DigiLocker and waits on the webhook), and the context updates on a mock grant.
  const { verified: aadhaarVerified } = useVerification();

  /* Read the stored preferences once on mount.
     This is the whole point of the port: before it, quiet hours were a fact about one browser, so a
     user who set 22:00–07:00 on their laptop still got a 03:00 push on their phone. Reading them
     here means the panel shows what the platform will actually honour, on whatever device is asking.
     A failed read is deliberately silent. The panel is already showing the defaults, which is what
     the server returns for a user who has never saved anything, so the visible outcome of a failure
     is identical to the visible outcome of the commonest success — and a red toast on a settings
     screen the user has not touched yet is noise about something they did not do. A failed *write*
     is a different matter and does speak up; see `changePrefs`. */
  useEffect(() => {
    let alive = true;
    getNotificationPreferences()
      .then((stored) => { if (alive && stored) setPrefs(stored); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const fld = 'field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500';

  /* The tenant trust score, and any erasure request already filed.

     The score is the server's: it is the number an owner uses to decide about this person, and the
     person it describes cannot be the one who computes it. Before it arrives the meter shows a dash
     rather than a zero — "not known yet" and "you scored nothing" are different statements. */
  const [trust, setTrust] = useState(null);
  useEffect(() => {
    let alive = true;
    myTenantProfile().then((p) => { if (alive) setTrust(p?.score ?? null); }).catch(() => {});
    myErasureRequests()
      .then((rows) => {
        if (!alive) return;
        const list = rows?.items || rows || [];
        setErasure(list.find((r) => r.status === 'pending') || null);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [user]);

  // App language is a device-level i18n pref (persisted as `pnLang`). Resolve to
  // the active resource language so the Select reflects what's actually applied.
  const lang = i18n.resolvedLanguage || i18n.language || 'en';
  const changeLang = (v) => {
    i18n.changeLanguage(v);
    /* Two different things are being set, and only one of them is this control's subject.
       `i18n.changeLanguage` switches the interface for this device (`pnLang`); `language` on the
       preferences document is the language the *platform* writes to this user in — the one their
       emails and WhatsApp messages arrive in. Keeping them in step is the existing behaviour and it
       is the right default, but they are stored in different places for a reason, and only the
       second one crosses the seam.
       Fire-and-forget: the interface has already switched and the toast has already fired, so
       awaiting the write here would only delay a navigation. `changePrefs` shows its own error and
       rolls the panel back if the server refuses. */
    changePrefs({ language: v }, false);
    // Help pages carry the language in the URL (see lib/helpUrl.js). Changing the
    // language from a help page has to rewrite that prefix, or HelpLangRoute
    // reads the stale prefix on the next render and switches the language back.
    const { lang: urlLang, rest } = splitLangPrefix(location.pathname);
    if (rest.startsWith('/help') && urlLang !== v) {
      navigate(helpPath(rest, v) + location.search, { replace: true });
    }
    toast('Language updated', 'success');
  };

  // Mobile is the account's primary key: every stored key is suffixed with it
  // (prefs, tenant profile, listings, saved, Aadhaar). It can't be edited inline
  // without orphaning that data, so it's shown read-only and Save omits it.
  const save = async () => {
    const name = form.name.trim();
    const email = form.email.trim();
    if (!name) { toast('Please enter your name', 'error'); return; }
    if (email && !EMAIL_RE.test(email)) { toast('Enter a valid email address', 'error'); return; }
    try {
      await update({ name, email, city: form.city });
      toast('Profile saved', 'success');
    } catch (err) {
      toast(err?.message || 'Could not save your profile. Please try again.', 'error');
    }
  };

  // Only enable Save once an editable field actually changed.
  const dirty =
    form.name.trim() !== (user?.name || '').trim() ||
    form.email.trim() !== (user?.email || '').trim() ||
    form.city !== (user?.city || 'Pune');

  // Persist a notification-pref change immediately. `announce` keeps time-input
  // keystrokes quiet while still confirming deliberate toggles.
  /* Optimistic, then reconciled from the write's response.
     Optimistic because a switch that waits on a round trip before moving feels broken, and the
     server's answer is echoed back so the panel ends on the stored document rather than on what
     this component guessed. `updateNotificationPreferences` widens the patch into the full six-field
     document the PUT requires; that merge is deliberately in the service, not here, so both
     providers see the same thing.
     A failed write puts the control back where it was rather than leaving a switch showing a state
     the server never accepted — the one outcome worse than not saving is telling the user it saved. */
  const changePrefs = async (patch, announce = true) => {
    const before = prefs;
    setPrefs((p) => ({ ...p, ...patch, quietHours: { ...p.quietHours, ...(patch.quietHours || {}) } }));
    try {
      const next = await updateNotificationPreferences(patch);
      setPrefs(next);
      if (announce) toast('Preferences updated', 'success');
    } catch (err) {
      setPrefs(before);
      toast(err?.message || 'Could not save that preference. Please try again.', 'error');
    }
  };
  const changeQuiet = (patch, announce = true) => changePrefs({ quietHours: { ...prefs.quietHours, ...patch } }, announce);

  const changeApp = (patch) => { setApp(setAppPrefs(patch)); };

  /* Saved on the account, not on the device — an owner who sets this on their laptop is telling the
     platform something about themselves, not about that browser, and the gate that enforces it runs
     on the server where no browser is present. Failure is announced and the switch simply stays
     where the server left it, because `owner` is derived from `user` rather than held separately:
     there is no local copy that could survive a rejected write. */
  const changeOwner = async (patch) => {
    try {
      await update(patch);
      toast('Privacy preference updated', 'success');
    } catch (err) {
      toast(err?.message || 'Could not save that preference. Please try again.', 'error');
    }
  };

  /* The right of access, answered by the system of record.

     It used to be a sweep of this browser's own localStorage, which made the export a description
     of one device rather than of the account — a user who signed in on a phone got a smaller
     "complete" export than the same user on a laptop, and neither included anything the server
     knows and the browser never saw. The server's document is downloaded verbatim, exclusions and
     all: a subject is entitled to be told what was left out, and a failure now says so instead of
     handing over a file that looks complete because it is empty. */
  const [exporting, setExporting] = useState(false);
  const downloadData = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const snapshot = await exportMyData();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `punenest-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Your data has been downloaded', 'success');
    } catch (err) {
      toast(err?.message || 'Could not prepare your data right now. Please try again.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const signOut = () => { logout(); navigate('/'); };

  const confirmDelete = async () => {
    setErasing(true);
    try {
      const filed = await requestErasure({ reason: '' });
      setErasure(filed || null);
      setDelOpen(false);
      // Not "deleted": the account is still here and the user is still signed in. Saying otherwise
      // would send them away believing their data is gone while it demonstrably is not.
      toast('Your erasure request has been submitted for review', 'success');
    } catch (err) {
      toast(err?.body?.error || err?.message || 'Could not submit your request right now. Please try again.', 'error');
    } finally {
      setErasing(false);
    }
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      <Card className="p-5 lg:p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white text-xl font-bold flex-shrink-0">{initial(user)}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-white truncate">{form.name.trim() || firstName(user)}</h2>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/8 text-gray-300 border border-white/10">{roleLabel(user?.role)}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <VerifiedChip label={t('verify.chipMobileVerified')} />
              {aadhaarVerified
                ? <VerifiedChip label={t('verify.chipIdVerified')} />
                : <PendingChip label={t('verify.chipIdNotVerified')} title={t('verify.title')} onClick={() => setAadhaarOpen(true)} />}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="text-sm"><span className="mb-1.5 block text-gray-400">Full name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={fld} /></label>
          <div className="text-sm">
            <span className="mb-1.5 block text-gray-400">Mobile</span>
            <div className="flex items-center justify-between gap-2 px-4 py-3 bg-white/[0.03] border border-white/10 rounded-xl">
              <span className="text-white">+91 {form.mobile || '—'}</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300 flex-shrink-0"><Icon name="badge-check" className="w-3.5 h-3.5" /> Verified</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">Your login number. To change it, contact support.</p>
          </div>
          <label className="text-sm"><span className="mb-1.5 block text-gray-400">Email</span><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={fld} placeholder="you@example.com" inputMode="email" /></label>
          <label className="text-sm"><span className="mb-1.5 block text-gray-400">City</span><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={fld} /></label>
        </div>
        <button onClick={save} disabled={!dirty} className="pn-control pn-control--action mt-5 px-5 gap-2 disabled:opacity-40 disabled:cursor-not-allowed"><Icon name="save" className="w-4 h-4" /> Save changes</button>

        <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-start gap-3 min-w-0">
            <Icon name="shield-check" className={(aadhaarVerified ? 'text-emerald-400' : 'text-amber-400') + ' w-5 h-5 flex-shrink-0 mt-0.5'} />
            <div className="min-w-0">
              <p className="text-sm text-white font-medium">Verified badge</p>
              <p className="text-xs text-gray-500 mt-0.5">{aadhaarVerified ? 'Your identity is verified via DigiLocker — the Verified badge builds trust and lifts your ranking.' : 'Optional: verify with DigiLocker to earn a Verified badge that builds trust and helps you stand out. You can do this anytime.'}</p>
            </div>
          </div>
          {aadhaarVerified
            ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300 flex-shrink-0"><Icon name="badge-check" className="w-4 h-4" /> Verified</span>
            : <button onClick={() => setAadhaarOpen(true)} className="pn-control pn-control--action gap-2 flex-shrink-0"><Icon name="shield-check" className="w-4 h-4" /> Get verified</button>}
        </div>
      </Card>

      {!isOwner && (
        <Card className="p-5 lg:p-6">
          <SectionHead icon="shield-check" iconCls="text-teal-400" title="Tenant Trust Score" sub="Build your trust profile to get faster approvals from owners." />
          <div className="flex items-center gap-4 mt-2">
            <div className="flex-1">
              <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-teal-400 to-teal-600 transition-all" style={{ width: `${trust}%` }} /></div>
              <p className="text-xs text-gray-500 mt-1.5">{trust}/100 — {trust >= 100 ? 'Your trust profile is complete' : 'Complete your profile to increase your score'}</p>
            </div>
            <Link to="/tenant-profile" className="text-sm font-semibold text-teal-400 hover:text-teal-300 whitespace-nowrap">{trust > 0 ? 'Update profile →' : 'Complete profile →'}</Link>
          </div>
        </Card>
      )}

      <CollapsibleCard icon="bell" iconCls="text-amber-400" title="Notification Preferences" sub="Control how and when PuneNest reaches you.">
        <PrefRow title="New property match alerts" desc="Get notified when new listings match your saved searches.">
          <Switch checked={prefs.matchAlerts} onChange={(v) => changePrefs({ matchAlerts: v })} label="New property match alerts" />
        </PrefRow>
        <div className="mt-2 border-t border-white/5 pt-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">Delivery channels</p>
          {[
            ['email', 'Email', 'Match alerts and enquiry updates by email.'],
            ['whatsapp', 'WhatsApp', 'Important updates on WhatsApp.'],
            ['sms', 'SMS', 'Enquiry alerts for your listings by SMS.'],
          ].map(([k, label, desc]) => (
            <PrefRow key={k} title={label} desc={desc}>
              <Switch checked={prefs[k]} onChange={(v) => changePrefs({ [k]: v })} label={label} />
            </PrefRow>
          ))}
        </div>
        <div className="mt-3 border-t border-white/5 pt-3 space-y-3">
          <PrefRow title="Quiet hours" desc="Pause non-urgent match & price alerts overnight.">
            <Switch checked={prefs.quietHours.enabled} onChange={(v) => changeQuiet({ enabled: v })} label="Quiet hours" />
          </PrefRow>
          {prefs.quietHours.enabled && (
            <div className="flex items-center gap-3 pl-0.5">
              <label className="text-xs text-gray-400">From
                <TimeField format="24h" value={prefs.quietHours.start} onChange={(v) => changeQuiet({ start: v }, false)} className={fld + ' mt-1'} ariaLabel="Quiet hours start" />
              </label>
              <label className="text-xs text-gray-400">To
                <TimeField format="24h" value={prefs.quietHours.end} onChange={(v) => changeQuiet({ end: v }, false)} className={fld + ' mt-1'} ariaLabel="Quiet hours end" />
              </label>
            </div>
          )}
        </div>
      </CollapsibleCard>

      {isOwner && (
        <CollapsibleCard icon="phone-off" iconCls="text-sky-400" title="Owner contact preferences" sub="Choose who can reach you and how buyers connect after you approve.">
          <PrefRow title="Accept verified contacts only" desc="Only buyers with a Verified badge can request your number or start a chat. Others are prompted to get verified first. Off by default — verification is a badge, not a wall.">
            <Switch checked={!!owner.verifiedContactOnly} onChange={(v) => changeOwner({ verifiedContactOnly: v })} label="Accept verified contacts only" />
          </PrefRow>
          <div className="mt-2 border-t border-white/5 pt-2">
            {/* Deliberately does NOT promise masking. The preference is stored on the account and
                travels with it, but nothing on the server reads it yet, so the old copy — "approved
                buyers connect through in-app chat instead" — described a behaviour that does not
                happen. A privacy control that quietly does nothing is worse than one that is
                honestly labelled as not yet in force. */}
            <PrefRow title="Keep my number private" desc="Records that you would rather not share your number directly. We are still rolling out the masking that enforces this, so for now treat it as a preference on your account rather than a guarantee.">
              <Switch checked={!!owner.hideNumber} onChange={(v) => changeOwner({ hideNumber: v })} label="Keep my number private" />
            </PrefRow>
          </div>
        </CollapsibleCard>
      )}

      <CollapsibleCard icon="globe" iconCls="text-violet-400" title="Language & Appearance" sub="Language and how the interface feels.">
        <div className="pb-1">
          <p className="text-sm text-white font-medium">{t('settings.languageTitle')}</p>
          <p className="text-xs text-gray-500 mt-0.5 mb-2">{t('settings.languageDesc')}</p>
          <Select value={lang} onChange={changeLang} options={LANGUAGES} ariaLabel={t('settings.languageTitle')} className="max-w-xs" />
          <p className="text-xs text-gray-500 mt-2">
            {t('settings.preview')}: <span className="text-gray-300">{t('notifications.title')} · {t('notifications.today')} · {t('notifications.time.justNow')}</span>{' '}
            <Link to="/notifications" className="text-teal-400 hover:text-teal-300">{t('settings.seeIt')}</Link>
          </p>
        </div>
        <div className="mt-3 border-t border-white/5 pt-2">
          <PrefRow title="Reduce motion" desc="Minimise animations and transitions across the app.">
            <Switch checked={!!app.reduceMotion} onChange={(v) => changeApp({ reduceMotion: v })} label="Reduce motion" />
          </PrefRow>
        </div>
      </CollapsibleCard>

      <CollapsibleCard icon="shield" iconCls="text-teal-400" title="Privacy & Account" sub="Manage your data and this account.">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div><p className="text-sm text-white font-medium">Download my data</p><p className="text-xs text-gray-500 mt-0.5">Export everything PuneNest has stored for you as a JSON file.</p></div>
            <button onClick={downloadData} disabled={exporting} aria-busy={exporting} className="pn-control gap-2 flex-shrink-0 disabled:opacity-60"><Icon name="download" className="w-4 h-4" /> {exporting ? 'Preparing…' : 'Download'}</button>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div><p className="text-sm text-white font-medium">Sign out</p><p className="text-xs text-gray-500 mt-0.5">End your session on this device.</p></div>
            <button onClick={signOut} className="pn-control gap-2 flex-shrink-0"><Icon name="log-out" className="w-4 h-4" /> Sign out</button>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] p-4">
            <div>
              <p className="text-sm text-white font-medium">Request account erasure</p>
              {erasure
                ? <p className="text-xs text-gray-500 mt-0.5">Your request is with our team. We&rsquo;ll write to you once it has been reviewed.</p>
                : <p className="text-xs text-gray-500 mt-0.5">Ask us to erase your account and personal data. We review each request, because some records &mdash; a live tenancy, a settled payment &mdash; belong to the other party too.</p>}
            </div>
            {erasure
              ? <span className="pn-control gap-2 flex-shrink-0 text-amber-300 border-amber-500/30 cursor-default"><Icon name="clock" className="w-4 h-4" /> Under review</span>
              : <button onClick={() => { setDelText(''); setDelOpen(true); }} className="pn-control gap-2 flex-shrink-0 text-rose-300 border-rose-500/30 hover:bg-rose-500/10"><Icon name="trash-2" className="w-4 h-4" /> Request</button>}
          </div>
        </div>
      </CollapsibleCard>

      <Modal
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title="Request account erasure?"
        size="sm"
        footer={(
          <>
            <button onClick={() => setDelOpen(false)} className="pn-control">Cancel</button>
            <button
              onClick={confirmDelete}
              disabled={erasing || delText.trim().toUpperCase() !== 'ERASE'}
              aria-busy={erasing}
              className="pn-control pn-control--action bg-rose-500 hover:bg-rose-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Icon name="trash-2" className="w-4 h-4" /> {erasing ? 'Submitting…' : 'Submit request'}
            </button>
          </>
        )}
      >
        <p className="text-sm text-gray-300">This sends a request to erase your profile, saved properties, searches and documents. It is reviewed by our team rather than actioned immediately: an account can be the other side of a live tenancy or a payment somebody else is relying on, and those records are not ours alone to remove.</p>
        <p className="text-sm text-gray-400 mt-3">You stay signed in and nothing changes until the request is approved. We&rsquo;ll tell you either way. Once it is approved, it cannot be undone.</p>
        <label className="mt-4 block text-sm">
          <span className="mb-1.5 block text-gray-400">Type <span className="font-mono font-semibold text-rose-300">ERASE</span> to confirm</span>
          <input value={delText} onChange={(e) => setDelText(e.target.value)} className={fld} placeholder="ERASE" />
        </label>
      </Modal>

      {aadhaarOpen && (
        <AadhaarVerifyModal
          source="profile_tab"
          subtitle={t('verify.subtitleProfile')}
          onClose={() => setAadhaarOpen(false)}
          onVerified={() => { toast(t('verify.badgeEarnedToast'), 'success'); }}
        />
      )}
    </div>
  );
}