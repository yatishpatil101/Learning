package com.punenest.api.common.error;

/**
 * The machine-readable {@code error} codes of the API error envelope.
 *
 * <p><strong>Why this exists.</strong> These codes are part of the published contract — the React
 * client branches on them (e.g. {@code aadhaar_required} drives the verification prompt), so they are
 * API surface, not log text. Each code was previously written as a literal in two or three places at
 * once: the typed exception that raises it, the advice that renders it, and — for the auth codes —
 * the security handlers that must emit a byte-identical envelope from inside the filter chain, where
 * the advice cannot reach. Three copies of a client-visible string is exactly the shape of bug that
 * silently breaks a frontend branch, because nothing fails when only one copy is edited.
 *
 * <p>Codes are {@code snake_case} and stable: renaming one is a breaking API change, not a
 * refactor. Add a new code here (with the status it pairs with) rather than inlining a literal.
 */
public final class ErrorCodes {

    private ErrorCodes() {
    }

    /** 400 — malformed request the caller can fix (bad param, unreadable body). */
    public static final String BAD_REQUEST = "bad_request";

    /** 401 — missing or invalid credentials. */
    public static final String UNAUTHORIZED = "unauthorized";

    /** 403 — authenticated but not permitted (RBAC deny, or an owner-only action). */
    public static final String FORBIDDEN = "forbidden";

    /** 404 — no such resource, or archived and hidden from this caller. */
    public static final String NOT_FOUND = "not_found";

    /** 409 — conflicts with current state. */
    public static final String CONFLICT = "conflict";

    /** 422 — request validation failed; the envelope carries a {@code fields[]} array. */
    public static final String VALIDATION_FAILED = "validation_failed";

    /**
     * 403 — the listing owner accepts contact from verified users only and this caller has no L2
     * badge. The <em>only</em> legitimate verification-driven 403 on the contact path (ADR-019,
     * badge-not-gate): a missing badge never blocks anything else, so the client can safely treat
     * this code — and only this code — as "offer the Aadhaar prompt".
     */
    public static final String VERIFICATION_REQUIRED = "verification_required";

    /**
     * 409 — this Aadhaar identity is already linked to another account (one Aadhaar = one badge,
     * ADR-009b). Fires only inside the opt-in KYC flow; it never blocks posting or contact.
     */
    public static final String AADHAAR_ALREADY_REGISTERED = "aadhaar_already_registered";

    /** 429 — rate limit exceeded (e.g. OTP requests); pairs with a Retry-After hint. */
    public static final String RATE_LIMITED = "rate_limited";

    /** 500 — catch-all. The message is deliberately generic: never leak internals to the client. */
    public static final String INTERNAL = "internal";

    /**
     * The two auth messages that must stay byte-identical across the filter chain and the advice.
     *
     * <p>A 401/403 can be produced in two different places depending on where the request dies:
     * {@code RestAuthEntryPoint}/{@code RestAccessDeniedHandler} handle the filter-chain case (the
     * normal path), while {@link GlobalExceptionHandler} is the backstop for the same failures raised
     * at the controller/service layer. The client sees one API, so both must emit the same body —
     * an invariant that only holds if there is one copy of the string.
     */
    public static final class Messages {

        private Messages() {
        }

        public static final String AUTH_REQUIRED = "Authentication required";

        public static final String ACCESS_DENIED = "You do not have permission to perform this action";
    }
}
