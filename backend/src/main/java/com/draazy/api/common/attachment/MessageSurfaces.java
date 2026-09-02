package com.draazy.api.common.attachment;

/**
 * The two message surfaces an attachment can hang off (D49).
 *
 * <p>String constants rather than an enum, per api-standards.md §7.1: the value is a stored
 * discriminator with a CHECK constraint behind it (V76), and the closed vocabulary lives in the
 * database as well as here so a third surface cannot arrive by typo.
 *
 * <p>There are three message-shaped surfaces in the codebase and only two of them are here.
 * {@code services.request} threads carry a {@code MessageRequest}, not the {@code MessageCreate}
 * that declared {@code attachments} — so the D49 row's "both message surfaces" is these two, and
 * widening this to a third is a product decision, not a completion.
 */
public final class MessageSurfaces {

    private MessageSurfaces() {
    }

    /** A buyer↔owner chat thread — {@code leads.conversation}. */
    public static final String CONVERSATION = "conversation";

    /** A customer's support thread with the platform — {@code services.support}. */
    public static final String SUPPORT_TICKET = "support_ticket";
}
