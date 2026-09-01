import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import { useScrollReveal } from '../../lib/useScrollReveal.js';
import usePullToRefresh from '../../lib/usePullToRefresh.js';
import { listProperties } from '../../services/propertyService.js';
import { countMatches } from './listings/alertCriteria.js';
import { useSaved } from '../../context/SavedContext.jsx';
import { useSavedSearches } from '../../context/SavedSearchContext.jsx';
import { useNotifications } from '../../context/NotificationContext.jsx';
import {
  listNotifications,
  markAllRead,
  markRead as markOneRead,
  dismiss as dismissOne,
  getNotificationPreferences,
} from '../../services/notificationService.js';
import { isHttpDomain } from '../../services/config.js';
import { seedNotifsIfEmpty, getNotifPrefs, inQuietHours } from '../../lib/store.js';

const ICONS = {
  match: ['home', 'text-teal-400', 'bg-teal-400/15'],
  enquiry: ['messages-square', 'text-teal-400', 'bg-teal-400/15'],
  price: ['trending-down', 'text-amber-400', 'bg-amber-400/15'],
  visit: ['calendar-check', 'text-emerald-400', 'bg-emerald-400/15'],
  share: ['users-round', 'text-teal-400', 'bg-teal-400/15'],
  document: ['folder-check', 'text-teal-400', 'bg-teal-400/15'],
  service: ['file-signature', 'text-teal-400', 'bg-teal-400/15'],
  system: ['info', 'text-gray-400', 'bg-white/10'],
};

const H = 3600_000;
const D = 24 * H;
// Default notification set. Seeded once per user (see store.seedNotifsIfEmpty) so a
// revisit never duplicates entries. `at` drives ordering + Today/Earlier grouping;
// the human time label is derived from it, so there is a single source of truth.
const now = Date.now();
const SEED = [
  { id: 'n-match-baner', type: 'match', read: false, at: now - 10 * 60_000, title: '3 new properties match your search', desc: 'New 3 BHK flats listed in Baner under ₹1.3 Cr.', link: '/listings?type=buy&q=baner' },
  { id: 'n-flatmate-hinjawadi', type: 'share', read: false, at: now - 1 * H, title: 'A flatmate match near Hinjawadi', desc: 'A verified working professional is looking for a flatmate for a 2 BHK in Hinjawadi.', link: '/listings?type=flatmate&q=hinjawadi' },
  { id: 'n-enquiry-priya', type: 'enquiry', read: false, at: now - 2 * H, title: 'Priya Kulkarni sent an enquiry', desc: '"Is the 3 BHK in Baner still available for a weekend visit?"', link: '/dashboard#enquiries' },
  { id: 'n-price-kp', type: 'price', read: false, at: now - 5 * H, title: 'Price dropped on a saved property', desc: '4 BHK Villa, Koregaon Park reduced by ₹15 Lakh.', link: '/saved' },
  { id: 'n-visit-wakad', type: 'visit', read: true, at: now - 1 * D, title: 'Visit confirmed for Saturday', desc: 'Site visit at 11:00 AM for 2 BHK Flat, Wakad.', link: '/schedule-visit' },
  { id: 'n-match-balewadi', type: 'match', read: true, at: now - 2 * D, title: 'New project launched near you', desc: 'Skyline Heights, Balewadi — pre-launch prices from ₹68 L.', link: '/listings' },
  { id: 'n-enquiry-viewed', type: 'enquiry', read: true, at: now - 3 * D, title: 'Your enquiry was viewed', desc: 'The owner of 3 BHK Flat, Baner viewed your enquiry.', link: '/dashboard#enquiries' },
  { id: 'n-system-welcome', type: 'system', read: true, at: now - 5 * D, title: 'Welcome to PuneNest!', desc: 'Complete your profile to get personalised recommendations.', link: '/dashboard#profile' },
];

const FILTERS = ['all', 'match', 'enquiry', 'price', 'visit', 'share'];

const isToday = (at) => {
  const a = new Date(at);
  const t = new Date();
  return a.getFullYear() === t.getFullYear() && a.getMonth() === t.getMonth() && a.getDate() === t.getDate();
};

// Only ever navigate to in-app relative paths. Guards the notification link
// against protocol-relative (`//host`) or scheme (`javascript:`) values, since
// mergeNotifs() accepts externally-shaped objects.
const SAFE_LINK_RE = /^\/(?!\/)[a-zA-Z0-9\-_/?=&#%.]*$/;
const safeLink = (link) => (typeof link === 'string' && SAFE_LINK_RE.test(link) ? link : '/notifications');

// Honest count of live listings matching a saved search's core criteria is
// provided by the shared `countMatches` helper (see listings/alertCriteria).

export default function Notifications() {
  const { t, i18n } = useTranslation();
  /**
   * The seeded demo set is a **mock-only** affordance and must not run against the API.
   *
   * `seedNotifsIfEmpty` writes eight fabricated rows into localStorage. On mocks that is the demo
   * inbox. In http mode the same call would merge invented notifications into a real one — indelible
   * (they are not the server's to delete), unreadable from any other device, and indistinguishable
   * from genuine platform messages. So the seed is gated on the domain rather than on emptiness.
   */
  const seeded = isHttpDomain('notification');
  const [notifs, setNotifs] = useState(() => {
    if (seeded) return [];
    seedNotifsIfEmpty(SEED);
    return [];
  });
  const [filter, setFilter] = useState('all');
  const saved = useSaved();
  const { searches } = useSavedSearches();
  const { refresh: refreshBadge } = useNotifications();
  const rootRef = useScrollReveal([filter]);

  // Derived (client-side) notifications, computed from the user's own saved searches and saved
  // properties. Held separately from the list so a re-derivation cannot duplicate server rows: the
  // provider merges the two on every read and lets the server win on any id collision.
  const [derived, setDerived] = useState([]);

  /**
   * Read the inbox: server rows (or localStorage on mocks) merged with whatever has been derived.
   *
   * One function for two callers — the effect below and the pull-to-refresh gesture — so a pull
   * lands the same merge the page loaded with rather than a second, subtly different read. The
   * `alive` box is the effect's; the gesture passes nothing and always applies its result.
   */
  const loadInbox = useCallback((alive = { current: true }) => listNotifications(derived)
    .then((list) => { if (alive.current) setNotifs(list); })
    // An unreachable inbox renders empty rather than throwing the page away. The bell already
    // shows nothing in that case, so the two agree.
    .catch(() => { if (alive.current) setNotifs([]); }), [derived]);

  /**
   * Re-runs whenever `derived` changes, which is how the two halves converge — the first pass shows
   * the stored inbox, and the alert pass adds to it once the saved searches and shortlist land.
   */
  useEffect(() => {
    const alive = { current: true };
    loadInbox(alive);
    return () => { alive.current = false; };
  }, [loadInbox]);

  /* Pull down from the top of the inbox to re-read it. The bell is refreshed alongside, so the
     count in the navbar can never disagree with the list the pull just produced. */
  const ptr = usePullToRefresh(useCallback(
    () => loadInbox().then(refreshBadge),
    [loadInbox, refreshBadge],
  ));

  // Merge in real-data notifications derived from the user's own saved searches
  // (new matches) and saved properties (availability). Deduped by stable id, so
  // revisiting never duplicates. Fixed ids also mean this settles after one add.
  useEffect(() => {
    let alive = true;
    /* Respect the user's settings: the master "New match alerts" switch and quiet hours both
       suppress the non-critical live match/price notifications.

       Read through the service, not `getNotifPrefs()`. That was a synchronous localStorage read, so
       this suppression only ever honoured settings made in *this* browser — a user who turned match
       alerts off on their phone still saw them derived on their laptop. Now it asks the same source
       `ProfileTab` writes to, which is the server when the domain is live.

       Because the read is asynchronous, the suppression check moved inside the promise chain rather
       than being an early return. The effect no longer bails before doing work; it does the work
       only once it knows it is allowed to. A failed read falls back to the local document, which is
       the pre-port behaviour and errs towards showing the user their alerts rather than silently
       swallowing them. */
    getNotificationPreferences()
      .catch(() => getNotifPrefs())
      .then((prefs) => {
        if (!alive) return;
        if (!prefs?.matchAlerts || inQuietHours(prefs)) return;
        const savedIds = [...saved.ids];
        if (!searches.length && !savedIds.length) return;
        return listProperties({}).then((props) => {
          if (!alive) return;
          const extra = [];
          searches.slice(0, 4).forEach((s) => {
            if (s.alerts === false) return;
            const count = countMatches(s, props);
            if (count > 0) {
              extra.push({
                id: `real-ss-${s.id}`,
                type: 'match',
                at: Date.now(),
                key: 'match',
                vars: { count, label: s.label || 'your saved search' },
                title: `${count} ${count === 1 ? 'property' : 'properties'} match "${s.label || 'your saved search'}"`,
                desc: 'New listings that fit one of your saved alerts are available now.',
                link: '/listings',
              });
            }
          });
          if (savedIds.length) {
            const sp = props.find((p) => savedIds.includes(p.id));
            if (sp) {
              extra.push({
                id: `real-savedprop-${sp.id}`,
                type: 'price',
                at: Date.now() - 60_000,
                key: 'price',
                vars: { bhkNum: sp.bhkNum, title: sp.title, locality: sp.locality },
                title: `Your saved ${sp.bhkNum ? `${sp.bhkNum} BHK` : 'property'} is still available`,
                desc: `${sp.title || 'A saved property'}${sp.locality ? ` in ${sp.locality}` : ''} — check the latest price and enquire.`,
                link: '/saved',
              });
            }
          }
          if (extra.length) setDerived(extra);
        });
      });
    return () => { alive = false; };
    // Both lists arrive asynchronously now, so this has to re-run once they land — on the first
    // pass they are still empty and the match/availability nudges would be skipped for everyone.
  }, [saved.ids, searches]);

  const sorted = useMemo(() => [...notifs].sort((a, b) => (b.at || 0) - (a.at || 0)), [notifs]);
  const list = useMemo(() => sorted.filter((n) => filter === 'all' || n.type === filter), [sorted, filter]);
  const unread = notifs.filter((n) => !n.read).length;

  const groups = useMemo(() => {
    const today = list.filter((n) => isToday(n.at));
    const earlier = list.filter((n) => !isToday(n.at));
    return [['today', today], ['earlier', earlier]].filter(([, arr]) => arr.length);
  }, [list]);

  /**
   * Every mutation is optimistic, then reconciled.
   *
   * These were synchronous localStorage writes returning the whole new list, which the page set
   * directly. Against the API each is a request, and awaiting one before repainting puts a network
   * round trip between the tap and the row greying out. So the local list is updated immediately,
   * the write is fired, and the bell is refreshed once it lands — the same pattern `SavedContext`
   * uses for hearts, and for the same reason.
   *
   * A failed write is not rolled back here: the next `listNotifications` re-reads the server and the
   * row simply comes back unread. Rolling back a *read* flag would be more surprising than letting
   * it correct itself, unlike a saved heart, where the wrong state invites a second write.
   */
  const markAll = async () => {
    setNotifs((cur) => cur.map((n) => (n.read ? n : { ...n, read: true })));
    await markAllRead();
    refreshBadge();
  };
  const markRead = async (id) => {
    setNotifs((cur) => cur.map((n) => (n.id === id && !n.read ? { ...n, read: true } : n)));
    await markOneRead(id);
    refreshBadge();
  };
  const dismiss = async (id) => {
    setNotifs((cur) => cur.filter((n) => n.id !== id));
    await dismissOne(id);
    refreshBadge();
  };

  // Localise a notification at render time. Known seeds resolve by id; live
  // match/price items resolve from their stored `key` + `vars`; anything else
  // falls back to its stored (English) title/desc.
  const localize = (n) => {
    if (i18n.exists(`notifications.seed.${n.id}.title`)) {
      return { title: t(`notifications.seed.${n.id}.title`), desc: t(`notifications.seed.${n.id}.desc`) };
    }
    if (n.key === 'match') {
      const v = n.vars || {};
      return { title: t('notifications.live.match', { count: v.count || 0, label: v.label || '' }), desc: t('notifications.live.matchDesc') };
    }
    if (n.key === 'price') {
      const v = n.vars || {};
      const bhk = v.bhkNum ? `${v.bhkNum} BHK` : t('notifications.live.propertyWord');
      const title = t('notifications.live.price', { bhk });
      const name = v.title || t('notifications.live.propertyWord');
      const desc = v.locality
        ? t('notifications.live.priceDesc', { title: name, locality: v.locality })
        : t('notifications.live.priceDescNoLoc', { title: name });
      return { title, desc };
    }
    return { title: n.title, desc: n.desc };
  };

  const relTime = (at) => {
    const diff = Date.now() - at;
    if (diff < 60_000) return t('notifications.time.justNow');
    if (diff < H) return `${Math.round(diff / 60_000)} ${t('notifications.time.min')}`;
    if (diff < D) { const h = Math.round(diff / H); return `${h} ${t(h === 1 ? 'notifications.time.hour' : 'notifications.time.hours')}`; }
    const d = Math.round(diff / D);
    return `${d} ${t(d === 1 ? 'notifications.time.day' : 'notifications.time.days')}`;
  };

  let delayIdx = 0;

  return (
    <div ref={ptr.ref} className="pt-5 sm:pt-8 lg:pt-10 pb-20 min-h-[100dvh]">
      {(ptr.pullDistance > 0 || ptr.isRefreshing) && (
        <div
          aria-hidden="true"
          className="glass-strong pointer-events-none fixed left-1/2 z-40 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full"
          style={{ top: `calc(var(--pn-nav-h) + ${Math.round(ptr.pullDistance)}px)`, opacity: 0.4 + ptr.progress * 0.6 }}
        >
          <Icon
            name={ptr.isRefreshing ? 'loader-2' : 'chevron-down'}
            className={'w-4 h-4 text-teal-400' + (ptr.isRefreshing ? ' animate-spin' : '')}
            style={ptr.isRefreshing ? undefined : { transform: `rotate(${ptr.progress * 180}deg)` }}
          />
        </div>
      )}
      <div ref={rootRef} className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-5 sm:mb-6 reveal">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('notifications.title')}</h1>
            <p className="text-gray-400 text-sm mt-1"><span className="text-teal-400 font-semibold">{unread}</span> {t('notifications.unread')}</p>
          </div>
          {unread > 0 && (
            <button onClick={markAll} className="text-teal-400 text-sm font-medium hover:text-teal-300 flex items-center gap-1.5"><Icon name="check-check" className="w-4 h-4" /> {t('notifications.markAll')}</button>
          )}
        </div>

        <HScroll wrapClassName="mb-5" className="flex gap-2 pb-1">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={'seg text-xs font-semibold px-4 py-2 rounded-xl text-gray-300 flex-shrink-0' + (filter === f ? ' active' : '')}>{t('notifications.filters.' + f)}</button>
          ))}
        </HScroll>

        {groups.length ? groups.map(([gid, arr]) => (
          <section key={gid} className="mb-6">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-3 reveal">{gid === 'today' ? t('notifications.today') : t('notifications.earlier')}</h2>
            <div className="space-y-3">
              {arr.map((n) => {
                const ic = ICONS[n.type] || ICONS.system;
                const loc = localize(n);
                const d = delayIdx++;
                return (
                  <div key={n.id} className={`notif rounded-2xl flex items-stretch reveal${!n.read ? ' unread' : ''}`} style={{ animationDelay: `${d * 0.04}s` }}>
                    <Link to={safeLink(n.link)} onClick={() => markRead(n.id)} className="flex-1 min-w-0 flex items-start gap-4 p-4">
                      <div className={'w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ' + ic[2]}><Icon name={ic[0]} className={'w-5 h-5 ' + ic[1]} /></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-white text-sm font-semibold ${n.read ? 'opacity-80' : ''}`}>{loc.title}</p>
                          {!n.read && <span className="w-2 h-2 rounded-full bg-teal-400 flex-shrink-0 mt-1.5" />}
                        </div>
                        <p className="text-gray-400 text-xs mt-1 leading-relaxed">{loc.desc}</p>
                        <p className="text-gray-600 text-[11px] mt-1.5">{relTime(n.at)}</p>
                      </div>
                    </Link>
                    <button
                      onClick={() => dismiss(n.id)}
                      aria-label={t('notifications.dismiss')}
                      title={t('notifications.dismiss')}
                      className="flex-shrink-0 px-3 grid place-items-center text-gray-600 hover:text-gray-300 transition-colors"
                    >
                      <Icon name="x" className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )) : (
          <div className="text-center py-16 text-gray-500 text-sm">
            {filter === 'all' ? t('notifications.emptyAll') : t('notifications.emptyCat')}
          </div>
        )}

        {/* Notification preferences link */}
        <div className="mt-8 text-center reveal">
          <Link to="/dashboard#profile" className="text-sm text-gray-500 hover:text-teal-400 transition-colors">
            <Icon name="settings" className="w-4 h-4 inline mr-1.5" />{t('notifications.manage')}
          </Link>
        </div>
      </div>
    </div>
  );
}
