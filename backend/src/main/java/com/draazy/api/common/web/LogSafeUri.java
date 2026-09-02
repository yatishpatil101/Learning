package com.draazy.api.common.web;

import java.util.Locale;
import java.util.Set;

/**
 * Makes a request URI safe to write to a log by masking the query parameters that are credentials.
 *
 * <p><strong>Why this exists (tech-debt D42).</strong> {@code GET /documents/shared?token=…} carries
 * a bearer credential in the query string: whoever holds that string can read someone's title deeds
 * without an account. A URL is the single most-copied part of a request — access logs, proxy logs,
 * browser history, bookmarks, {@code Referer} on any outbound link, and whatever the recipient
 * pastes into a chat window. Nothing in this application logs a request URI today, and the container
 * access log is pinned to a query-string-free pattern in {@code application.properties} for exactly
 * this reason. This class is the one call any future request-logging code must go through, so that
 * "remember to exclude {@code token}" is a compile-time affordance rather than a comment someone has
 * to find.
 *
 * <p><strong>Deliberately a denylist, not an allowlist.</strong> An allowlist over query parameter
 * names would have to be edited every time a filter facet is added, and the failure mode of
 * forgetting is a broken log line rather than a leaked secret. The denylist's failure mode is the
 * reverse, which is why {@link #SENSITIVE} names the credential-shaped parameters the contract
 * actually has rather than trying to be clever.
 *
 * <p><strong>Scope.</strong> Redaction is a log-hygiene measure, not an authorisation boundary. It
 * matches on the raw, still-encoded parameter name, so a caller who writes {@code %74oken=…} keeps
 * their own value in the log; that is a caller harming only themselves and is not worth decoding
 * the query string for.
 */
public final class LogSafeUri {

    private LogSafeUri() {
    }

    /** What a masked value is replaced with. Constant so tests and greps agree on one spelling. */
    public static final String REDACTED = "REDACTED";

    /**
     * Query parameter names whose value is a credential. Lower-case; matching is case-insensitive.
     *
     * <p>{@code token} is the share token behind {@code GET /documents/shared}. The rest are the
     * shapes that arrive with any OAuth-style or signed-URL integration, listed now because the
     * cost is a string and the cost of noticing later is an incident.
     */
    static final Set<String> SENSITIVE = Set.of(
            "token", "access_token", "refresh_token", "id_token", "code", "signature", "sig",
            "secret", "password", "otp", "api_key", "apikey");

    /**
     * Returns {@code uri} with the value of every sensitive query parameter replaced by
     * {@link #REDACTED}. The path, the parameter names and every other value are left exactly as
     * they were, so the line stays useful for debugging.
     *
     * @param uri a request URI, with or without a query string; {@code null} passes through
     */
    public static String redact(String uri) {
        if (uri == null) {
            return null;
        }
        int queryStart = uri.indexOf('?');
        if (queryStart < 0 || queryStart == uri.length() - 1) {
            return uri;
        }

        String query = uri.substring(queryStart + 1);
        StringBuilder out = new StringBuilder(uri.length())
                .append(uri, 0, queryStart + 1);
        String[] pairs = query.split("&", -1);
        for (int i = 0; i < pairs.length; i++) {
            if (i > 0) {
                out.append('&');
            }
            String pair = pairs[i];
            int equals = pair.indexOf('=');
            // A name with no `=` has no value to leak, so it is passed through untouched.
            if (equals >= 0 && SENSITIVE.contains(
                    pair.substring(0, equals).toLowerCase(Locale.ROOT))) {
                out.append(pair, 0, equals + 1).append(REDACTED);
            } else {
                out.append(pair);
            }
        }
        return out.toString();
    }
}
