/** One seam keeps mock and HTTP conversations from forking into separate schemas. */
import { createProvider } from './config.js';

const provider = createProvider('conversation');

/** The caller's inbox, newest first. Threads are omitted — use {@link getConversation}. */
export const listConversations = async () => (await provider()).listConversations();

/** One thread with its messages. `null` when it does not exist or the caller is not in it. */
export const getConversation = async (id) => (await provider()).getConversation(id);

/** Find-or-create prevents a client that lost its id from forking the thread. */
export const startConversation = async (input) => (await provider()).startConversation(input);

/** Send a message into an existing thread. Resolves with the message as stored. */
export const replyToConversation = async (id, body) => (await provider()).replyToConversation(id, body);
export const sendConversationPhoto = async (id, body) => (await provider()).sendConversationPhoto(id, body);
export const updateConversationState = async (id, state) => (await provider()).updateConversationState(id, state);
export const deleteMessageForMe = async (id, messageId) => (await provider()).deleteMessageForMe(id, messageId);
export const setConversationBlocked = async (id, blocked) => (await provider()).setConversationBlocked(id, blocked);
export const sendTyping = async (id) => (await provider()).sendTyping(id);
export const openMessageStream = async (opts) => (await provider()).openMessageStream(opts);

/** A flatmate group's one thread, created on first open. `null` when the caller is not in the group. */
export const openGroupConversation = async (groupId) => (await provider()).openGroupConversation(groupId);

/** The pair thread an accepted flatmate request unlocks, created on first open. */
export const openFlatmateRequestConversation = async (requestId) => (await provider()).openFlatmateRequestConversation(requestId);

/** Mark the caller's side of a thread read. Idempotent on both providers. */
export const markConversationRead = async (id) => (await provider()).markConversationRead(id);

/** Its own operation rather than `listConversations().length` so the count is defined in one place; the badge and the
 * page disagreeing after an action is the classic version of this bug. */
export const unreadCount = async () => (await provider()).unreadCount();

/** Queue messages typed before the contact gate opens. */
export const queuePendingChat = async (property, options) => (await provider()).queuePendingChat(property, options);

/** `blocked` entries stay queued — the gate may open later — which is why this is not a fire-and-forget drain. */
export const drainPendingChats = async () => (await provider()).drainPendingChats();
export const clearConversationDeviceState = async () => (await provider()).clearConversationDeviceState?.();
