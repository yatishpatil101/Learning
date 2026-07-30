package com.punenest.api.identity.verification;

/**
 * The Cashfree/DigiLocker callback payload (contract {@code DigilockerWebhook}).
 *
 * <p>Deserialized from a raw JSON string rather than bound directly by Spring, because the HMAC is
 * computed over the exact bytes on the wire — re-serializing a bound object would produce a different
 * byte sequence and a signature that never matches. See {@code DigilockerWebhookController}.
 *
 * @param type   provider event name, e.g. {@code DIGILOCKER_VERIFICATION_SUCCESS}. Informational; the
 *               decision is taken from {@code status}, which is the field the contract enumerates
 * @param ref    correlates with {@link KycStartResponse#ref} — also the idempotency key
 * @param status {@link WebhookStatuses#SUCCESS} or {@link WebhookStatuses#FAILED}
 * @param data   the masked identity fields; {@code null} on a failure callback
 */
public record DigilockerWebhook(String type, String ref, String status, Data data) {

    /**
     * @param maskedAadhaar last-4 form, the <em>only</em> Aadhaar representation we ever persist
     * @param mobile        the Aadhaar-linked mobile, compared against the account mobile to derive
     *                      the soft {@code mobileMatch} signal and then discarded — never stored
     * @param identityHash  provider-supplied composite dedup key (ADR-009b); the value behind the
     *                      {@code identity_hash} UNIQUE index that makes one Aadhaar one account
     */
    public record Data(String maskedAadhaar, String mobile, String identityHash) {
    }
}
