/**
 * HTTP notification provider — the live counterpart to `providers/mock/notificationProvider.js`.
 *
 * Method names, argument order and return shapes mirror the mock exactly; `notificationService.js`
 * is the only contract between them and no page may care which one is active. Shape translation
 * lives in `notificationMapper.js`.
 *
 * The server offers two endpoints. The two behaviours that have no endpoint — dismissing a row, and
 * client-derived alerts — are handled here rather than being dropped or thrown, and both are
 * confined to this file so the page cannot tell.
 */
import { get, post } from '../../http.js';
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

/** Tombstones for dismissed notifications, per signed-in user. */
const DISMISSED_KEY = 'pnDismissedNotifs';

/**
 * Read the tombstone set.
 *
 * Keyed only by name, not by mobile, unlike the mock's `pnNotifications:<mobile>`: these ids are
 * server UUIDs and are already unique per user, so a shared key cannot collide. Sharing it also
 * means the set does not have to be rebuilt when the signed-in user changes.
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
 * Hide a notification.
 *
 * **No server endpoint exists**, so this is a local tombstone rather than a delete. Three properties
 * of that are worth stating plainly, because they are invisible from the call site:
 *
 * - it does not sync across devices;
 * - clearing site data brings the row back;
 * - a client-derived row can be dismissed too, and will stay dismissed until the tombstones are
 *   cleared, even though nothing server-side records it.
 *
 * The alternative — throwing, or hiding the X in http mode — removes a control that works today.
 * A tombstone is honest about being a local preference; a missing button would just look broken.
 * Recorded as debt so a real `DELETE /notifications/{id}` replaces it rather than joining it.
 */
export async function dismiss(id) {
  if (!id) return;
  rememberDismissed(id);
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
