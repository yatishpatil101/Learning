package com.punenest.api.identity.verification;

/**
 * The outcome tokens the DigiLocker webhook sends us ({@code DigilockerWebhook.status}).
 *
 * <p>Deliberately separate from {@link VerificationStatuses}, and deliberately upper-case: these are
 * the <em>provider's</em> vocabulary, not ours. Collapsing the two would couple our persisted
 * lifecycle to a third party's naming, so the webhook handler translates explicitly.
 */
public final class WebhookStatuses {

    private WebhookStatuses() {
    }

    /** DigiLocker verified the identity → badge granted (unless the identity is already claimed). */
    public static final String SUCCESS = "SUCCESS";

    /** DigiLocker could not verify → no badge, and the user may retry. */
    public static final String FAILED = "FAILED";
}
