import { useState, useId } from 'react';
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
  getTenantProfile, tenantScore,
  getNotifPrefs, setNotifPrefs,
  getAppPrefs, setAppPrefs,
  getOwnerPrefs, setOwnerPrefs,
  exportUserData, deleteMyData,
} from '../../lib/store.js';
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
const PendingChip = ({ label, onClick }) => {
  const cls = 'inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/12 px-2 py-0.5 text-[11px] font-semibold text-amber-300';
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls + ' transition-colors hover:bg-amber-500/20 hover:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40'} title="Get your Verified badge">
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
  const [prefs, setPrefs] = useState(() => getNotifPrefs());
  const [app, setApp] = useState(() => getAppPrefs());
  const [owner, setOwner] = useState(() => getOwnerPrefs());
  const [delOpen, setDelOpen] = useState(false);
  const [delText, setDelText] = useState('');
  const [aadhaarOpen, setAadhaarOpen] = useState(false);
  // The opt-in Aadhaar badge, held once in VerificationContext. The chip and section below
  // reflect it read-only; the modal starts the seam write (mock grants at once, production
  // redirects to DigiLocker and waits on the webhook), and the context updates on a mock grant.
  const { verified: aadhaarVerified } = useVerification();

  const fld = 'field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500';

  // Real tenant trust score (0–100), derived from the verified-tenant profile.
  const trust = tenantScore(getTenantProfile());

  // App language is a device-level i18n pref (persisted as `pnLang`). Resolve to
  // the active resource language so the Select reflects what's actually applied.
  const lang = i18n.resolvedLanguage || i18n.language || 'en';
  const changeLang = (v) => {
    i18n.changeLanguage(v);
    setNotifPrefs({ language: v });
    setPrefs((p) => ({ ...p, language: v }));
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
  const changePrefs = (patch, announce = true) => {
    const next = setNotifPrefs(patch);
    setPrefs(next);
    if (announce) toast('Preferences updated', 'success');
  };
  const changeQuiet = (patch, announce = true) => changePrefs({ quietHours: { ...prefs.quietHours, ...patch } }, announce);

  const changeApp = (patch) => { setApp(setAppPrefs(patch)); };
  const changeOwner = (patch) => { setOwner(setOwnerPrefs(patch)); toast('Privacy preference updated', 'success'); };

  const downloadData = () => {
    const blob = new Blob([JSON.stringify(exportUserData(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `punenest-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Your data has been downloaded', 'success');
  };

  const signOut = () => { logout(); navigate('/'); };

  const confirmDelete = () => {
    deleteMyData();
    logout();
    setDelOpen(false);
    toast('Your account and data were deleted', 'success');
    navigate('/');
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
              <VerifiedChip label="Mobile verified" />
              {aadhaarVerified ? <VerifiedChip label="ID verified" /> : <PendingChip label="ID not verified" onClick={() => setAadhaarOpen(true)} />}
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

      {user?.role !== 'owner' && (
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
            <PrefRow title="Keep my number private" desc="Even after you approve a request, your number stays masked — approved buyers connect through in-app chat instead.">
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
            <button onClick={downloadData} className="pn-control gap-2 flex-shrink-0"><Icon name="download" className="w-4 h-4" /> Download</button>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div><p className="text-sm text-white font-medium">Sign out</p><p className="text-xs text-gray-500 mt-0.5">End your session on this device.</p></div>
            <button onClick={signOut} className="pn-control gap-2 flex-shrink-0"><Icon name="log-out" className="w-4 h-4" /> Sign out</button>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] p-4">
            <div><p className="text-sm text-white font-medium">Delete account</p><p className="text-xs text-gray-500 mt-0.5">Permanently remove your account and all saved data. This can't be undone.</p></div>
            <button onClick={() => { setDelText(''); setDelOpen(true); }} className="pn-control gap-2 flex-shrink-0 text-rose-300 border-rose-500/30 hover:bg-rose-500/10"><Icon name="trash-2" className="w-4 h-4" /> Delete</button>
          </div>
        </div>
      </CollapsibleCard>

      <Modal
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title="Delete your account?"
        size="sm"
        footer={(
          <>
            <button onClick={() => setDelOpen(false)} className="pn-control">Cancel</button>
            <button
              onClick={confirmDelete}
              disabled={delText.trim().toUpperCase() !== 'DELETE'}
              className="pn-control pn-control--action bg-rose-500 hover:bg-rose-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Icon name="trash-2" className="w-4 h-4" /> Delete forever
            </button>
          </>
        )}
      >
        <p className="text-sm text-gray-300">This removes your profile, saved properties, searches, documents, and every other trace of your data on this device. It cannot be undone.</p>
        <label className="mt-4 block text-sm">
          <span className="mb-1.5 block text-gray-400">Type <span className="font-mono font-semibold text-rose-300">DELETE</span> to confirm</span>
          <input value={delText} onChange={(e) => setDelText(e.target.value)} className={fld} placeholder="DELETE" />
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