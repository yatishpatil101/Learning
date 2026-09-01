/**
 * HTTP notification provider.
 *
 * Method names, argument order and return shapes mirror the mock exactly; `notificationService.js`
 * is the only contract between them and no page may care which one is active. Shape translation
 * lives in `notificationMapper.js`.
 *
 * The server offers three endpoints: list, mark-read, and now delete (dismiss). The one behaviour
 * with no endpoint — client-derived alerts, which have no server row — is handled here rather than
 * being dropped or thrown, and is confined to this file so the page cannot tell.
 */
import { del, get, post, put } from '../../http.js';
import { toViewModelList } from './notificationMapper.js';

/**
 * One large page rather than real paging.
 *
 * The page groups into Today/Earlier, filters by type client-side and renders a total unread count,
 * so it needs the whole inbox to be correct — a paged read would make the "N unread" header and
 * every filter chip page-scoped. 100 is the server's hard ceiling
 * (`spring.data.web.pageable.max-page-size`), so asking for more is silently clamped; requesting
 * exactly the ceiling is what makes `warnIfTruncated` meaningful rather than decorative.
 *
 * Notifications accrue forever and are never culled, so this ceiling is reachable in a way the
 * shortlist's is not. The warning is the signal to give the page real paging.
 */
const PAGE_SIZE = 100;

/** Tombstones for dismissed client-derived notifications, per browser. */
const DISMISSED_KEY = 'pnDismissedNotifs';

/**
 * Read the tombstone set.
 *
 * Keyed only by name, not by mobile, unlike the mock's `pnNotifications:<mobile>`: these ids are
 * already unique, so a shared key cannot collide. Sharing it also means the set does not have to be
 * rebuilt when the signed-in user changes. Since `DELETE /notifications/{id}` exists, this now only
 * holds client-derived rows (saved-search matches etc.) that have no server home — real server rows
 * are dismissed on the server and never reach this set.
 */
function dismissedIds() {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    // A corrupt value must not take the inbox down with it — an unreadable tombstone set means
    // "nothing is dismissed", which shows the user more than they asked for rather than less.
    return new Set();
  }
}

function rememberDismissed(id) {
  const next = dismissedIds();
  next.add(id);
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
  } catch {
    // Quota or private mode. The row stays visible; nothing else breaks.
  }
}

/**
 * The inbox: server rows, minus dismissed ones, plus client-derived ones, newest first.
 *
 * **`extra` is merged but deliberately not persisted.** The mock writes merged rows to localStorage
 * because localStorage is the only store it has. Doing the same here would mint a notification that
 * exists on one device, in one browser, that the server has never heard of — the user is told they
 * have an alert and can never see it again from their phone. So the derived rows are recomputed on
 * each read by the caller, which is where the inputs (saved searches, saved properties) already
 * live. That is the same split the anonymous-alert case took (D85).
 */
export async function listNotifications(extra = []) {
  const page = await get('/notifications', { size: PAGE_SIZE });
  warnIfTruncated(page);
  const hidden = dismissedIds();
  const server = toViewModelList(page).filter((n) => !hidden.has(n.id));
  // Server rows win on id collision: a client-derived row is a guess about state the server may
  // since have recorded for real, and the real one carries the authoritative `read` flag.
  const seen = new Set(server.map((n) => n.id));
  const derived = extra.filter((n) => n?.id && !seen.has(n.id) && !hidden.has(n.id));
  return [...server, ...derived].sort((a, b) => (b.at || 0) - (a.at || 0));
}

/**
 * Unread count over the whole inbox.
 *
 * There is no count endpoint, so this reads the same large page and counts it — accurate up to the
 * ceiling, and audibly wrong beyond it rather than silently. Deliberately excludes dismissed rows:
 * a badge that counts notifications the user can no longer see is a badge they cannot clear.
 *
 * Client-derived rows are **not** counted. They are recomputed on every visit to the page and have
 * no persistent read state, so counting them would make the bell permanently non-zero.
 */
export async function unreadCount() {
  const page = await get('/notifications', { size: PAGE_SIZE });
  const hidden = dismissedIds();
  return toViewModelList(page).filter((n) => !n.read && !hidden.has(n.id)).length;
}

/**
 * Mark one read. The endpoint takes a list, so this is a one-element list — and the distinction
 * matters: an **empty** list is the server's signal for "mark everything read", so a caller that
 * passed an unfiltered array could clear the whole inbox by accident.
 */
export async function markRead(id) {
  if (!id) return;
  await post('/notifications/read', { ids: [id] });
}

/** Mark everything read — an absent/empty id list is exactly what the server defines as "all". */
export async function markAllRead() {
  await post('/notifications/read', {});
}

/**
 * Dismiss a notification.
 *
 * A real server row is removed with `DELETE /notifications/{id}`, so the dismissal is permanent and
 * **syncs across the user's devices** (this replaced the local-tombstone-only behaviour that was
 * recorded as debt D93).
 *
 * A **client-derived** alert (a saved-search match, a saved-property availability nudge) has no
 * server row, so the server answers its id with a 404 (or a 400 for a non-UUID). That is expected,
 * not a failure: fall back to a local tombstone for exactly those, which is the only store they can
 * have. The consequence is unchanged and worth stating — a dismissed derived row is device-local
 * and returns if site data is cleared — but it now applies only to rows the server never owned.
 *
 * Any other error (5xx, offline) propagates: the row was already removed optimistically by the
 * caller and simply reappears on the next read, the same tolerance `markRead` documents.
 */
export async function dismiss(id) {
  if (!id) return;
  try {
    await del(`/notifications/${id}`);
  } catch (err) {
    if (err?.status === 404 || err?.status === 400) {
      rememberDismissed(id);
      return;
    }
    throw err;
  }
}

function warnIfTruncated(page) {
  const returned = page?.content?.length ?? 0;
  if ((page?.totalElements ?? 0) > returned) {
    console.warn(
      `[notification] ${page.totalElements} notifications exist but only ${returned} were fetched. ` +
        'The unread count and the type filters are now reading a partial inbox — the page needs ' +
        'real paging, or the server needs an unread-count endpoint.',
    );
  }
}

/**
 * The caller's delivery preferences, from the server.
 *
 * `NotificationPreferencesDto` is field-for-field the object the browser has always kept in
 * localStorage — `{ email, sms, whatsapp, matchAlerts, quietHours: { enabled, start, end },
 * language }`, nesting included — so there is no mapper here and deliberately so. Its own Javadoc
 * says why the server chose that shape: renaming `matchAlerts` or flattening `quietHours` "would
 * make the migration a transformation rather than a move, and every transformation is somewhere for
 * the two to drift". Adding a translation layer on this side would reintroduce exactly that.
 *
 * Always 200, never 404: a user who has never saved settings has preferences, they are just the
 * defaults, and the server returns them. So there is no not-found branch to write.
 */
export async function getNotificationPreferences() {
  return get('/me/notification-preferences');
}

/**
 * Replace the whole preferences document.
 *
 * **Every field is required and the caller must send all six.** That is not an oversight in the
 * contract, it is the contract: `NotificationPreferencesUpdateRequest` marks all six `@NotNull`
 * because "treating an omitted field as 'keep whatever is stored' makes this a `PATCH` wearing a
 * `PUT`'s verb", and the settings screen has all six controls visible at once anyway. A missing
 * field is a 422 naming the field.
 *
 * The merge that turns a one-switch toggle into a whole document therefore happens in
 * `notificationService.js`, above this file, so the mock cannot quietly accept a partial write that
 * this would reject. Nothing here re-merges: if a partial document reaches this function the 422 is
 * the correct outcome and swallowing it would hide the bug in demo mode only.
 *
 * The response is the server's view of what was just written, which is what the caller reconciles
 * its optimistic local state against.
 */
export async function updateNotificationPreferences(next) {
  return put('/me/notification-preferences', next);
}
