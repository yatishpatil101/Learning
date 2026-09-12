package com.draazy.api.common.trust;

/**
 * The port through which this platform sends a message to somebody outside it.
 *
 * <p>Same inversion as {@link Notifier}, for the same reason: the contexts that need to chase an
 * owner — {@code moderation} first, {@code services} and {@code deals} next — should be able to say
 * "chase them" without importing whatever performs it. The implementation lives in
 * {@code engagement.messaging}, which ranks below all of them, so the dependency arrow points down
 * rather than sideways and swapping the transmitter touches one package.
 *
 * <p>Distinct from {@code Notifier}, which writes an in-app inbox row for somebody who is already a
 * user of this platform and will come back to read it. This is for reaching a person <em>where they
 * already are</em> — a WhatsApp thread on their phone — which is the only channel that works for an
 * owner who has never signed in, and that owner is precisely the one the post-on-behalf funnel
 * exists to chase.
 *
 * <h2>Why the return value is a {@link Prepared} and not a boolean</h2>
 *
 * <p>Because the first implementation cannot transmit, and pretending otherwise here would push the
 * lie all the way to the console.
 *
 * <p>What ships today is WhatsApp click-to-chat: the server renders the message and hands back a
 * {@code wa.me} link, the staff member's own WhatsApp opens with the text typed out, and they press
 * send. That is a real send — no Business Solution Provider, no vendor contract, no Meta template
 * approval, which is exactly why the console has been able to do it since the mock era — but it is
 * one this server does not witness. The staff member may send it, edit it first, or close the tab.
 *
 * <p>A {@code boolean} return would have to answer "did it go", and every honest implementation
 * would have to answer "I don't know". So the method returns what it actually knows: the message
 * that was composed, the ledger row recording that it was composed, and — when the transport needs
 * a human to finish the job — the link that lets them. A sender that genuinely transmits returns
 * the same record with no link and moves the row to {@code sent} on its delivery callback.
 *
 * <p>The consequence is that a count of these rows means "chasers written", not "chasers
 * delivered", and every surface that renders one is obliged to say so. That is a smaller cost than
 * a number nobody can trust.
 */
public interface MessageSender {

    /**
     * Compose a message from a template, record it, and transmit it as far as this implementation
     * is able.
     *
     * @param request who to reach, about what, and with which template
     * @return the composed message and the ledger row it produced
     */
    Prepared send(MessageRequest request);

    /**
     * What the caller asked for. The renderer resolves {@code {placeholder}} keys from
     * {@code variables}; an unknown key is left standing as literal text rather than blanked, so a
     * typo surfaces in the preview a staff member reads instead of silently deleting a sentence.
     *
     * @param channel one of {@code whatsapp}, {@code sms}, {@code email}
     * @param templateId slug of the template to render, e.g. {@code wa-aadhaar}
     * @param subjectType what the outreach is about — {@code property} is the only value today
     * @param subjectId id of that thing
     * @param recipientId the user being reached
     * @param recipientMobile the number it is going to, captured now so a later number change
     *     cannot retroactively rewrite where this one went
     * @param preparedBy the staff member doing the chasing
     * @param variables values for the template's placeholders
     */
    record MessageRequest(
            String channel,
            String templateId,
            String subjectType,
            java.util.UUID subjectId,
            java.util.UUID recipientId,
            String recipientMobile,
            java.util.UUID preparedBy,
            java.util.Map<String, String> variables) {}

    /**
     * What happened.
     *
     * @param id the ledger row, so a caller can point at it from an audit entry
     * @param body the fully rendered text — stored as well as returned, because re-rendering it
     *     later from an edited template would show a colleague a message the owner never received
     * @param status {@code prepared}, {@code sent} or {@code failed}
     * @param handoffLink where to send the human to finish the job, or {@code null} when the
     *     implementation transmits by itself. The console opens this; nothing else may depend on
     *     it, because it disappears the day a real transport is wired in.
     */
    record Prepared(java.util.UUID id, String body, String status, String handoffLink) {}
}
