package com.draazy.api.identity.auth;

/**
 * Body for {@code POST /auth/refresh} (contract {@code RefreshRequest}). Optional, and it carries no
 * credential: the refresh token itself arrives in the {@code HttpOnly} cookie that
 * {@link RefreshCookie} sets, where no client script can reach it.
 *
 * <p>All that is left is {@code remember}, and the client has to send it because the server cannot
 * infer it. A rotation replaces the cookie, so it must know whether to write a persistent one or a
 * session one — and a browser tells a server nothing about the {@code Max-Age} of the cookie it just
 * presented. The alternative, storing the flag on the token row, would add a column to carry a fact
 * the only party who can act on it already holds. It is not a privilege: a client that claims
 * {@code true} dishonestly gains only a longer cookie on its own device, which it could have had by
 * signing in with the box ticked.
 *
 * @param remember whether this session survives a browser restart; absent means yes
 */
public record RefreshRequest(Boolean remember) {

    /** {@link #remember} with its default applied, tolerating an absent body. */
    static boolean rememberDevice(RefreshRequest request) {
        return request == null || request.remember() == null || request.remember();
    }
}
