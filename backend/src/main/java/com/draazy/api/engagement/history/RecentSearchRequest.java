package com.draazy.api.engagement.history;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Record a search the caller just ran.
 *
 * <p>No user identifier, here or in the path: the account is the one in the token, always. The
 * timestamp is not accepted either — a client that can set {@code at} can pin a row to the top of
 * its own rail forever, or bury one, neither of which is a thing "recent" should mean.
 *
 * <p>The lengths mirror the columns so an over-long value is a 422 naming the field rather than a
 * truncation nobody notices or a constraint violation surfacing as a 500. The URL's *shape* is
 * checked in the service, not here, because "is one of our search pages" is an allowlist rule rather
 * than something a regex on this record should be trusted to express.
 *
 * @param label chip text; presentation only, never the identity of the entry
 * @param url   a relative URL on one of our own search pages
 */
public record RecentSearchRequest(
        @NotBlank @Size(max = 200) String label,
        @NotBlank @Size(max = 500) String url) {
}
