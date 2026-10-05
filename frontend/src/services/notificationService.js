import { createProvider } from './config.js';

const provider = createProvider('notification');

export const listNotifications = async (opts) => (await provider()).listNotifications(opts);

/** How many unread, over the **whole** inbox rather than the first page. */
export const unreadCount = async () => (await provider()).unreadCount();

export const markRead = async (id) => (await provider()).markRead(id);

export const markAllRead = async () => (await provider()).markAllRead();

/** Deliberately still offered: the X is a control that works today, and removing it would be a visible regression
 * traded for a purity that no user asked for. */
export const dismiss = async (id) => (await provider()).dismiss(id);

/* Defaults publish the server shape so settings do not infer it from one browser's cache. */
export const NOTIFICATION_PREFERENCE_DEFAULTS = Object.freeze({
  email: true,
  sms: false,
  whatsapp: true,
  matchAlerts: true,
  quietHours: Object.freeze({ enabled: false, start: '22:00', end: '07:00' }),
  language: 'en',
});

/** `{ email, sms, whatsapp, matchAlerts, quietHours: { enabled, start, end }, language }` on both sides — the server
 * contract is modelled on the object the browser already kept, so no mapper. */
export const getNotificationPreferences = async () => (await provider()).getNotificationPreferences();

/** **The merge lives here, not in the provider.** `PUT /me/notification-preferences` requires all six fields — a
 * missing one is a 422, because the server refuses to be a `PATCH` wearing a `PUT`'s verb. */
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

export const registerPushSubscription = async (subscription) => (await provider()).registerPushSubscription(subscription);
export const unregisterPushSubscription = async (endpoint) => (await provider()).unregisterPushSubscription(endpoint);
