/**
 * Notification Service — public API for the in-app alert inbox.
 *
 * Components import from here. The implementation delegates to the active provider (`mock` reads
 * localStorage, `http` reads `GET /notifications`), and no call site may be able to tell which one
 * answered.
 *
 * ## The server surface is two endpoints, and the page needs more than that
 *
 * `GET /notifications` (paged) and `POST /notifications/read` are the whole contract. Everything
 * else the Notifications page does has no server home, so this seam is mostly a set of decisions
 * about *where each behaviour lives* rather than a set of request builders:
 *
 * | Behaviour | Where it lives | Why |
 * |---|---|---|
 * | list, mark read, mark all read | **server** | the two endpoints |
 * | `dismiss` | **client tombstones** | no `DELETE /notifications/{id}` exists |
 * | saved-search / saved-property alerts | **client-derived** | computed in the browser from `countMatches`; the server has no slot for them |
 * | `pushNotificationFor` | **mock only, permanently** | writing into *another* user's inbox is a server-side effect, never a client call |
 * | preferences + quiet hours | **`lib/` only** | no endpoint at all; `ProfileTab` is untouched |
 *
 * Those middle two are why this is a merge rather than a switch. Flipping the domain to `http`
 * without them would replace a populated demo inbox with a truthful blank screen for every user who
 * has never touched flatmates — the only feature that currently writes notification rows
 * server-side. Merging keeps both halves, and each half stays honest about what it is.
 */
import { createProvider } from './config.js';

const provider = createProvider('notification');

/**
 * The caller's notifications, newest first, already merged and de-duplicated.
 *
 * `extra` carries client-derived rows (saved-search matches, saved-property availability). They are
 * merged **by the provider**, not by the page, because the mock persists them and the http provider
 * must not — a client-derived alert written to localStorage in http mode would be a notification the
 * user was shown once and can never see again from another device.
 *
 * @param {object[]} [extra] client-derived notifications to merge in, deduped by id
 */
export const listNotifications = (extra) => provider().listNotifications(extra);

/**
 * How many unread, over the **whole** inbox rather than the first page.
 *
 * Separate from `listNotifications` because the navbar bell needs the count on every page, and
 * counting a page would quietly cap the badge at the page size — the same bug `countProperties`
 * exists to avoid on the catalogue.
 */
export const unreadCount = () => provider().unreadCount();

/** Mark one notification read. Resolves when applied; does not resolve to the new list. */
export const markRead = (id) => provider().markRead(id);

/** Mark every notification read. The server treats an empty id list as "all". */
export const markAllRead = () => provider().markAllRead();

/**
 * Hide one notification.
 *
 * **There is no server endpoint for this.** On mocks it removes the row; against the API it records
 * a client-side tombstone that the provider filters subsequent reads through. Deliberately not
 * hidden in http mode: the X is a control that works today, and removing it would be a visible
 * regression traded for a purity that no user asked for. Its limits are real and documented on the
 * http provider — it does not sync across devices, and clearing site data brings the row back.
 */
export const dismiss = (id) => provider().dismiss(id);
