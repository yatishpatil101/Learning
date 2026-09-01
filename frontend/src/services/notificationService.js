/**
 * Notification Service — public API for the in-app alert inbox.
 *
 * Components import from here. The implementation delegates to the active provider (`mock` reads
 * localStorage, `http` reads `GET /notifications`), and no call site may be able to tell which one
 * answered.
 *
 * ## The server surface is three endpoints, and the page still needs a little more
 *
 * `GET /notifications` (paged), `POST /notifications/read` and `DELETE /notifications/{id}` are the
 * whole contract. What is left has no server home, so this seam is partly a set of decisions about
 * *where each behaviour lives* rather than only a set of request builders:
 *
 * | Behaviour | Where it lives | Why |
 * |---|---|---|
 * | list, mark read, mark all read | **server** | the read + mark-read endpoints |
 * | `dismiss` (server rows) | **server** | `DELETE /notifications/{id}` — permanent, syncs across devices (D93) |
 * | `dismiss` (client-derived rows) | **client tombstones** | they have no server row to delete, so the server 404s them and the provider falls back locally |
 * | saved-search / saved-property alerts | **client-derived** | the server has no inbox slot for them, but the number in them is no longer counted here — it rides on the saved-search record as `matchCount` (D227) |
 * | `pushNotificationFor` | **gone** | writing into *another* user's inbox is a server-side effect, never a client call. Its three callers wrote into `localStorage` from the acting user's browser, so the row only ever reached the recipient when both were the same person; the server raises `document.granted`, `service.draft-shared` and `service.party-invited` instead |
 * | preferences + quiet hours | **server** | `GET`/`PUT /me/notification-preferences` — see below |
 *
 * Those middle two are why this is a merge rather than a switch. Flipping the domain to `http`
 * without them would replace a populated demo inbox with a truthful blank screen for every user who
 * has never touched flatmates — the only feature that currently writes notification rows
 * server-side. Merging keeps both halves, and each half stays honest about what it is.
 *
 * ## Preferences moved, and the row above used to say the opposite
 *
 * That table read "**`lib/` only** | no endpoint at all; `ProfileTab` is untouched". It is now
 * wrong on both counts, and it was already wrong when written: `MeNotificationPreferencesController`
 * has existed since D94/D15, with a `GET` and a `PUT`, backed by tests and named in the OpenAPI
 * document. Nothing in `frontend/src` called it, so every one of these settings lived in one
 * browser's localStorage and the server enforced none of them — a quiet-hours window suppressed
 * the alerts the *client* derived and nothing else, so a notification the server wrote at 03:00
 * arrived at 03:00. That is the controller's own account of the bug, and the client half of the fix
 * is the two functions at the bottom of this file.
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
export const listNotifications = async (extra) => (await provider()).listNotifications(extra);

/**
 * How many unread, over the **whole** inbox rather than the first page.
 *
 * Separate from `listNotifications` because the navbar bell needs the count on every page, and
 * counting a page would quietly cap the badge at the page size — the same bug `countProperties`
 * exists to avoid on the catalogue.
 */
export const unreadCount = async () => (await provider()).unreadCount();

/** Mark one notification read. Resolves when applied; does not resolve to the new list. */
export const markRead = async (id) => (await provider()).markRead(id);

/** Mark every notification read. The server treats an empty id list as "all". */
export const markAllRead = async () => (await provider()).markAllRead();

/**
 * Hide one notification.
 *
 * **There is no server endpoint for this.** On mocks it removes the row; against the API it records
 * a client-side tombstone that the provider filters subsequent reads through. Deliberately not
 * hidden in http mode: the X is a control that works today, and removing it would be a visible
 * regression traded for a purity that no user asked for. Its limits are real and documented on the
 * http provider — it does not sync across devices, and clearing site data brings the row back.
 */
export const dismiss = async (id) => (await provider()).dismiss(id);

/**
 * The caller's delivery preferences: channels, the master match-alert switch, quiet hours, language.
 *
 * Shape is identical on both sides — `{ email, sms, whatsapp, matchAlerts, quietHours: { enabled,
 * start, end }, language }` — because the server contract was deliberately modelled on the object
 * the browser already kept. No mapper, on purpose.
 */
/**
 * What the server returns for a user who has never saved preferences.
 *
 * Published so a settings screen can render the right six controls on its first frame without
 * reading one browser's saved copy to guess the shape. That read looked like a harmless seed but
 * was a stale cache of the server's answer: a user who changed a switch on their phone would open
 * the laptop and see the old value flash before the real one arrived. A fixed default flashes only
 * a default, which is what a screen with no answer yet honestly has.
 *
 * Mirrors `NOTIF_PREF_DEFAULTS` in `lib/store/notifications.js`, which the mock provider serves.
 */
export const NOTIFICATION_PREFERENCE_DEFAULTS = Object.freeze({
  email: true,
  sms: false,
  whatsapp: true,
  matchAlerts: true,
  quietHours: Object.freeze({ enabled: false, start: '22:00', end: '07:00' }),
  language: 'en',
});

export const getNotificationPreferences = async () => (await provider()).getNotificationPreferences();

/**
 * Apply a partial change and return the stored document.
 *
 * **The merge lives here, not in either provider.** `PUT /me/notification-preferences` requires all
 * six fields — a missing one is a 422, because the server refuses to be a `PATCH` wearing a `PUT`'s
 * verb — while the screen that calls this flips one switch at a time. Somebody has to widen a patch
 * into a document, and doing it above the seam means the mock and the live path cannot disagree
 * about what "unchanged" means: demo mode would happily persist a two-key object and the API would
 * reject it, which is a bug that only appears in production.
 *
 * `quietHours` is merged one level deeper, since the screen writes `{ start }` on its own. Deeper
 * than that there is nothing to merge — the document is two levels and no more.
 *
 * The read before the write is the cost of that. It is one request against a route that is always
 * 200 and never 404, on a settings screen, at the moment the user touched a control — the cheapest
 * possible place to pay for correctness.
 *
 * @param {object} patch the fields that changed
 * @returns {Promise<object>} the full stored document, from the server where the server is in play
 */
export const updateNotificationPreferences = async (patch) => {
  const impl = await provider();
  const current = await impl.getNotificationPreferences();
  const next = {
    ...current,
    ...patch,
    quietHours: { ...current.quietHours, ...(patch.quietHours || {}) },
  };
  return impl.updateNotificationPreferences(next);
};
