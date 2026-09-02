package com.draazy.api.identity.verification;

import java.time.Instant;

/**
 * Handle to an in-progress DigiLocker consent flow (contract {@code KycStart}), returned {@code 202}:
 * the badge is not granted yet, it is merely being attempted — the outcome arrives asynchronously on
 * the webhook.
 *
 * @param ref             server-side correlation reference; the webhook carries it back
 * @param verificationUrl short-lived hosted consent URL the client redirects the user to
 * @param expiresAt       when that URL stops working
 */
public record KycStartResponse(String ref, String verificationUrl, Instant expiresAt) {
}
