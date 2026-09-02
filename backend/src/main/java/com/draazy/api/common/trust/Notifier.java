package com.draazy.api.common.trust;

import java.util.UUID;

/**
 * A way to tell a user that something happened, without knowing how notifications are stored.
 *
 * <p><strong>Why a port.</strong> Notifications live in {@code engagement}, which ranks at the same
 * layer as {@code leads} (both are join contexts over {@code catalog} + {@code identity}). Messaging
 * needs to notify the other participant when a message arrives — the most obvious notification the
 * platform can send, and until now one it never sent — but {@code leads} importing {@code engagement}
 * is a same-rank reference, which is exactly the cycle {@code ArchitectureBoundaryTest} fails the
 * build over. It caught this on the first full run.
 *
 * <p>Declaring the interface here and implementing it in {@code engagement.notification} points the
 * arrow the right way, as {@link ContactGate}, {@link PropertyExperience} and {@link RatingLookup}
 * already do for the contact reveal, deal history and review ratings respectively.
 *
 * <p><strong>Deliberately one method, and deliberately fire-and-forget.</strong> A caller announces
 * that something happened; it does not get to ask what was delivered, retry, or address a channel.
 * Anything richer — email, SMS, quiet-hours suppression, per-user preferences — belongs behind this
 * boundary and not in the vocabulary of the contexts that call it, or every future sender would have
 * to learn the delivery rules.
 */
public interface Notifier {

    /**
     * Put a notification in {@code userId}'s inbox.
     *
     * <p>Runs inside the caller's transaction, so a rollback takes the notification with it. That is
     * intentional for the current callers: a message nobody was told about is a message that did not
     * arrive, and the two facts are one event.
     *
     * @param userId recipient
     * @param type   dotted namespace, e.g. {@code message.received}. The client translates these
     *               into its own icon/filter vocabulary, so a new value is a client-visible change
     * @param title  one line, shown in the list
     * @param body   short preview; a notification is a summons to the thing, not a copy of it
     * @param link   in-app path to open, or {@code null}
     */
    void notify(UUID userId, String type, String title, String body, String link);
}
