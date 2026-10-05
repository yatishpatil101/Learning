import { useState, useId, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import Switch from '../ui/Switch.jsx';
import TimeField from '../ui/TimeField.jsx';
import Modal from '../ui/Modal.jsx';
import VerifyIdentityRedirect from '../auth/VerifyIdentityRedirect.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useVerification } from '../../context/VerificationContext.jsx';
import { initial, roleLabel, firstName } from '../../lib/auth.js';
import {
  getAppPrefs, setAppPrefs,
} from '../../lib/localPrefs.js';
import {
  getNotificationPreferences,
  registerPushSubscription,
  unregisterPushSubscription,
  updateNotificationPreferences,
  NOTIFICATION_PREFERENCE_DEFAULTS,
} from '../../services/notificationService.js';
import { exportMyData, requestErasure, myErasureRequests } from '../../services/authService.js';
import { myTenantProfile } from '../../services/rentService.js';

const Card = ({ children, className = '' }) => <div className={'glass-card rounded-2xl ' + className}>{children}</div>;
const SectionHead = ({ icon, iconCls = 'text-teal-400', title, sub }) => (
  <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
    <div><h2 className="text-lg font-bold text-white flex items-center gap-2">{icon ? <Icon name={icon} className={'w-5 h-5 ' + iconCls} /> : null} {title}</h2>{sub ? <p className="text-gray-500 text-xs mt-0.5">{sub}</p> : null}</div>
  </div>
);
// Collapses on mobile (tap the header) but stays open on desktop, so phones get a
// scannable accordion without changing the web view.

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
const VAPID_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function vapidBytes(key) {
  const padded = `${key}${'='.repeat((4 - (key.length % 4)) % 4)}`;
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((ch) => ch.charCodeAt(0)));
}

export default function ProfileTab({ user, update, toast, isOwner }) {
  const { logout } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  /* Seeded from the published defaults — the same shape the server returns for a user who has never saved — not from
     a local copy, which would flash a stale value before the real one. */
  const [form, setForm] = useState({ name: user?.name || '', mobile: user?.mobile || '', email: user?.email || '', city: user?.city || 'Pune' });
  const [prefs, setPrefs] = useState(NOTIFICATION_PREFERENCE_DEFAULTS);
  const [app, setApp] = useState(() => getAppPrefs());
  /* Not seeded: the server sends these two non-nullable on every `/auth/me`, so there is always a real answer and
     never a gap to paper over. */
  const owner = {
    verifiedContactOnly: !!user?.verifiedContactOnly,
    hideNumber: !!user?.hideNumber,
    shareActivityStatus: user?.shareActivityStatus !== false,
    shareReadReceipts: user?.shareReadReceipts !== false,
  };
  const pushAvailable = Boolean(VAPID_KEY) && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window && 'serviceWorker' in navigator;
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delText, setDelText] = useState('');
  // An erasure request already in flight. Replaces the form so a user who has asked is told
  // where it stands, rather than being invited to ask again.
  const [erasure, setErasure] = useState(null);
  const [erasing, setErasing] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const { verified: identityVerified } = useVerification();
  const nameLocked = Boolean(user?.verified || identityVerified);
  /* Preferences are account-level, so the panel shows what the platform will honour on whatever device is asking. */

  useEffect(() => {
    let alive = true;
    getNotificationPreferences()
      .then((stored) => { if (alive && stored) setPrefs(stored); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!pushAvailable) return undefined;
    let alive = true;
    navigator.serviceWorker.getRegistration('/sw.js')
      .then((reg) => reg?.pushManager?.getSubscription())
      .then((sub) => {
        if (sub) registerPushSubscription(sub.toJSON()).catch(() => {});
        if (alive) setPushEnabled(!!sub);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [pushAvailable]);

  const fld = 'field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500';
  /* The score is the server's — the person it describes cannot be the one who computes it. */

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
  // Mobile is the account key; editing it inline would orphan stored data.
  // Help URLs carry language, so the prefix must change before HelpLangRoute reads it.

  const save = async () => {
    const name = form.name.trim();
    const email = form.email.trim();
    /* Matches `UserUpdate`'s `@Size(min = 2, max = 80)`: without it the server's refusal surfaces as the generic
       catch below, with no mention of the field at fault. */
    if (!nameLocked && (name.length < 2 || name.length > 80)) { toast('Please enter your name (2 to 80 characters)', 'error'); return; }
    if (email && !EMAIL_RE.test(email)) { toast('Enter a valid email address', 'error'); return; }
    try {
      await update({ ...(nameLocked ? {} : { name }), email, city: form.city });
      toast('Profile saved', 'success');
    } catch (err) {
      toast(err?.code === 'NAME_LOCKED_WHILE_VERIFIED' ? 'Name is locked while verified.' : err?.message || 'Could not save your profile. Please try again.', 'error');
    }
  };
  // Only enable Save once an editable field actually changed.

  const dirty =
    (!nameLocked && form.name.trim() !== (user?.name || '').trim()) ||
    form.email.trim() !== (user?.email || '').trim() ||
    form.city !== (user?.city || 'Pune');
  /* Optimistic, then reconciled from the write's response; a failure rolls the control back rather than leaving a
     switch showing a state the server never accepted. */

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
  /* Saved on the account, not the device: the gate that enforces this runs on the server, where no browser is
     present. */

  const changeOwner = async (patch) => {
    try {
      await update(patch);
      toast('Privacy preference updated', 'success');
    } catch (err) {
      toast(err?.message || 'Could not save that preference. Please try again.', 'error');
    }
  };

  /* The right of access, answered by the system of record: the server's document is downloaded verbatim, exclusions
     and all, so a subject is told what was left out. */
  const changePush = async (enabled) => {
    if (!pushAvailable || pushBusy) return;
    setPushBusy(true);
    try {
      if (enabled) {
        const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Notifications are blocked for this browser.');
        // Production's Workbox /sw.js imports push-sw.js; dev has no Workbox worker, so register the push one directly.
        const reg = await navigator.serviceWorker.register(import.meta.env.DEV ? '/push-sw.js' : '/sw.js');
        const sub = await reg.pushManager.getSubscription()
          || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(VAPID_KEY) });
        await registerPushSubscription(sub.toJSON());
        setPushEnabled(true);
        toast('Message alerts enabled on this device', 'success');
      } else {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js');
        const sub = await reg?.pushManager?.getSubscription();
        const endpoint = sub?.endpoint;
        if (sub) await sub.unsubscribe();
        if (endpoint) await unregisterPushSubscription(endpoint);
        setPushEnabled(false);
        toast('Message alerts disabled on this device', 'success');
      }
    } catch (err) {
      toast(err?.message || 'Could not update message alerts on this device.', 'error');
    } finally {
      setPushBusy(false);
    }
  };

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
      a.download = `draazy-data-${new Date().toISOString().slice(0, 10)}.json`;
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
              {identityVerified
                ? <VerifiedChip label={t('verify.chipIdVerified')} />
                : <PendingChip label={t('verify.chipIdNotVerified')} title={t('verify.title')} onClick={() => setIdentityOpen(true)} />}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="text-sm">
            <span className="mb-1.5 block text-gray-400">Full name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={nameLocked} className={fld + (nameLocked ? ' opacity-60 cursor-not-allowed' : '')} />
            {nameLocked ? <p className="mt-1 text-[11px] text-amber-300">Locked while verified</p> : null}
          </label>
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
        <button onClick={save} disabled={!dirty} className="dz-control dz-control--action mt-5 px-5 gap-2 disabled:opacity-40 disabled:cursor-not-allowed"><Icon name="save" className="w-4 h-4" /> Save changes</button>

        <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-start gap-3 min-w-0">
            <Icon name="shield-check" className={(identityVerified ? 'text-emerald-400' : 'text-amber-400') + ' w-5 h-5 flex-shrink-0 mt-0.5'} />
            <div className="min-w-0">
              <p className="text-sm text-white font-medium">Verified badge</p>
              <p className="text-xs text-gray-500 mt-0.5">{identityVerified ? 'Your identity has been reviewed and verified. The badge builds trust and lifts your ranking.' : 'Optional: verify your identity with a document and selfie review to earn the Verified badge. You can do this anytime.'}</p>
            </div>
          </div>
          {identityVerified
            ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300 flex-shrink-0"><Icon name="badge-check" className="w-4 h-4" /> Verified</span>
            : <button onClick={() => setIdentityOpen(true)} className="dz-control dz-control--action gap-2 flex-shrink-0"><Icon name="shield-check" className="w-4 h-4" /> Verify identity</button>}
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

      <CollapsibleCard icon="bell" iconCls="text-amber-400" title="Notification Preferences" sub="Control how and when Draazy reaches you.">
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
          {pushAvailable ? (
            <PrefRow title="Message alerts on this device" desc="Shows a generic Draazy alert without names or message text.">
              <Switch checked={pushEnabled} disabled={pushBusy} onChange={changePush} label="Message alerts on this device" />
            </PrefRow>
          ) : null}
          <PrefRow title="Quiet hours" desc="Pause non-urgent match & price alerts overnight.">
            <Switch checked={prefs.quietHours.enabled} onChange={(v) => changeQuiet({ enabled: v })} label="Quiet hours" />
          </PrefRow>
          {prefs.quietHours.enabled && (
            <div className="flex items-center gap-3 pl-0.5">
              <div className="text-xs text-gray-400">From
                <TimeField format="24h" value={prefs.quietHours.start} onChange={(v) => changeQuiet({ start: v }, false)} className={fld + ' mt-1'} ariaLabel="Quiet hours start" />
              </div>
              <div className="text-xs text-gray-400">To
                <TimeField format="24h" value={prefs.quietHours.end} onChange={(v) => changeQuiet({ end: v }, false)} className={fld + ' mt-1'} ariaLabel="Quiet hours end" />
              </div>
            </div>
          )}
        </div>
      </CollapsibleCard>

      {isOwner && (
        <CollapsibleCard icon="phone-off" iconCls="text-sky-400" title="Owner contact preferences" sub="Choose who can reach you and how buyers connect after you approve.">
          <PrefRow title="Accept verified contacts only" desc="Only verified users can ask to contact you or chat.">
            <Switch checked={!!owner.verifiedContactOnly} onChange={(v) => changeOwner({ verifiedContactOnly: v })} label="Accept verified contacts only" />
          </PrefRow>
            {/* Copy deliberately does not promise masking — the preference is stored but nothing on the server reads
               it yet. */}
          <PrefRow title="Hide my number from approved buyers" desc="Approved buyers can chat with you, but won't see your phone number.">
            <Switch checked={!!owner.hideNumber} onChange={(v) => changeOwner({ hideNumber: v })} label="Hide my number from approved buyers" />
          </PrefRow>
          <div className="mt-2 border-t border-white/5 pt-3">
            <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <Icon name="shield-check" className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-300" />
              <div>
                <p className="text-sm font-medium text-white">{owner.hideNumber ? 'Approved buyers stay in chat.' : 'Approved buyers can call you.'}</p>
                <p className="mt-0.5 text-xs text-gray-500">You can change this any time.</p>
              </div>
            </div>
          </div>
        </CollapsibleCard>
      )}

      <CollapsibleCard icon="message-square" iconCls="text-teal-400" title="Chat privacy" sub="Control what messaging shares with other people.">
        <PrefRow title="Show when I'm online" desc="If off, you won't see others' either.">
          <Switch checked={owner.shareActivityStatus} onChange={(v) => changeOwner({ shareActivityStatus: v })} label="Show when I'm online" />
        </PrefRow>
        <PrefRow title="Read receipts" desc="If off, you won't see others' either.">
          <Switch checked={owner.shareReadReceipts} onChange={(v) => changeOwner({ shareReadReceipts: v })} label="Read receipts" />
        </PrefRow>
      </CollapsibleCard>

      <CollapsibleCard icon="palette" iconCls="text-violet-400" title="Appearance" sub="How the interface feels.">
        <PrefRow title="Reduce motion" desc="Minimise animations and transitions across the app.">
          <Switch checked={!!app.reduceMotion} onChange={(v) => changeApp({ reduceMotion: v })} label="Reduce motion" />
        </PrefRow>
      </CollapsibleCard>

      <CollapsibleCard icon="shield" iconCls="text-teal-400" title="Privacy & Account" sub="Manage your data and this account.">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div><p className="text-sm text-white font-medium">Download my data</p><p className="text-xs text-gray-500 mt-0.5">Export everything Draazy has stored for you as a JSON file.</p></div>
            <button onClick={downloadData} disabled={exporting} aria-busy={exporting} className="dz-control gap-2 flex-shrink-0 disabled:opacity-60"><Icon name="download" className="w-4 h-4" /> {exporting ? 'Preparing…' : 'Download'}</button>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div><p className="text-sm text-white font-medium">Sign out</p><p className="text-xs text-gray-500 mt-0.5">End your session on this device.</p></div>
            <button onClick={signOut} className="dz-control gap-2 flex-shrink-0"><Icon name="log-out" className="w-4 h-4" /> Sign out</button>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] p-4">
            <div>
              <p className="text-sm text-white font-medium">Request account erasure</p>
              {erasure
                ? <p className="text-xs text-gray-500 mt-0.5">Your request is with our team. We&rsquo;ll write to you once it has been reviewed.</p>
                : <p className="text-xs text-gray-500 mt-0.5">Ask us to erase your account and personal data. We review each request, because some records &mdash; a live tenancy, a settled payment &mdash; belong to the other party too.</p>}
            </div>
            {erasure
              ? <span className="dz-control gap-2 flex-shrink-0 text-amber-300 border-amber-500/30 cursor-default"><Icon name="clock" className="w-4 h-4" /> Under review</span>
              : <button onClick={() => { setDelText(''); setDelOpen(true); }} className="dz-control gap-2 flex-shrink-0 text-rose-300 border-rose-500/30 hover:bg-rose-500/10"><Icon name="trash-2" className="w-4 h-4" /> Request</button>}
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
            <button onClick={() => setDelOpen(false)} className="dz-control">Cancel</button>
            <button
              onClick={confirmDelete}
              disabled={erasing || delText.trim().toUpperCase() !== 'ERASE'}
              aria-busy={erasing}
              className="dz-control dz-control--action bg-rose-500 hover:bg-rose-400 disabled:opacity-40 disabled:cursor-not-allowed"
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

      {identityOpen && (
        <VerifyIdentityRedirect
          source="profile_tab"
          onClose={() => setIdentityOpen(false)}
        />
      )}
    </div>
  );
}
