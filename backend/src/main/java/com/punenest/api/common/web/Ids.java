package com.punenest.api.common.web;

import java.util.Optional;
import java.util.UUID;

/**
 * Opaque-id parsing for path tokens.
 *
 * <p>The contract types every id as {@code string}, so a caller can send anything. The rule this
 * class exists to keep consistent is that a token which is <em>not</em> a UUID is a lookup miss
 * ({@code 404}), not a malformed request ({@code 400}): a 400 tells an attacker that the id space
 * is UUIDs and that this particular string was rejected before any authorisation ran, and it makes
 * "does this id exist" answerable without an account.
 *
 * <p>Every call site in the codebase now routes through this method (D43). Two answers are built on
 * top of it and both are the caller's to choose: a service that treats a bad token as "not found
 * later" uses {@code .orElse(null)} and lets its existing existence check answer, while a
 * controller that has nothing further to look up uses {@code .orElseThrow} with the message that
 * endpoint would have produced anyway. The message stays at the call site because it is the only
 * part of the decision that is genuinely local; the parse is not.
 *
 * <p><strong>The 404 rule is about path tokens, which is what "opaque-id parsing for path tokens"
 * above means.</strong> An id arriving in a request <em>body</em> is a different question: the
 * endpoint exists, so there is nothing to be 404, and a malformed element is an ordinary 400.
 * {@code NotificationController.parseId} is the one such site and it answers 400 on purpose — see
 * its Javadoc, which carries the full reasoning (D74).
 */
public final class Ids {

    private Ids() {
    }

    /** {@link Optional#empty()} when the token is not a UUID — a miss, not a 400. */
    public static Optional<UUID> parseUuid(String token) {
        try {
            return Optional.of(UUID.fromString(token));
        } catch (IllegalArgumentException | NullPointerException notUuid) {
            return Optional.empty();
        }
    }
}
