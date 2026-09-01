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

    /**
     * 422 — the caller has no standing to review this listing. A property review is only worth
     * reading if the person writing it actually went there, so the server requires a completed visit
     * or a tenancy (the rule the React client has been enforcing on its own, in the browser, where
     * anyone could step around it). Distinct from {@link #FORBIDDEN} because it is not about
     * permission: nothing the caller can be granted fixes it, only going to see the flat does.
     */
    public static final String REVIEW_NOT_ELIGIBLE = "review_not_eligible";

    /**
     * 422 — the caller has used every owner contact their plan and referrals allow (D31b).
     *
     * <p>Not {@link #FORBIDDEN}: a 403 tells a client the caller is not permitted, and every client
     * on this platform answers that by offering to sign in as somebody who is. Signing in again does
     * not conjure contacts. Not {@link #RATE_LIMITED} either — 429 promises the request will succeed
     * if you wait, and this one will not, because the quota is a lifetime total rather than a window.
     * The same reasoning as {@link #REVIEW_NOT_ELIGIBLE}: the request is well-formed and the caller
     * is who they say they are, but their standing does not reach it. What fixes it is subscribing
     * or referring, and the client's job is to say so.
     */
    public static final String CONTACT_QUOTA_EXHAUSTED = "contact_quota_exhausted";

    /**
     * 409 — this account has already reviewed this target. One voice, one review: a rating average
     * that one account can move fifty times is not an average of anything. Paired with a UNIQUE
     * index rather than only a service check, so the answer holds under concurrent submits.
     */
    public static final String ALREADY_REVIEWED = "already_reviewed";

    /**
     * 412 — a conditional write whose {@code If-Match} no longer matches the stored document
     * (tech debt D66). Deliberately not {@link #CONFLICT}: the caller explicitly asked to be stopped
     * if the resource had moved, so this is the precondition doing its job rather than an
     * unforeseeable clash, and the client's recovery is to re-read and re-apply rather than to
     * reconsider the request.
     */
    public static final String PRECONDITION_FAILED = "precondition_failed";

    /** 429 — rate limit exceeded (e.g. OTP requests); pairs with a Retry-After hint. */
    public static final String RATE_LIMITED = "rate_limited";

    /**
     * 413 — the uploaded file exceeds the size limit. Raised both by our own check and by the
     * servlet container's multipart limit, which trips before a single byte reaches a controller;
     * both paths must emit this code or the client learns two different names for one refusal.
     */
    public static final String PAYLOAD_TOO_LARGE = "payload_too_large";

    /**
     * 415 — the uploaded file's type is not on the vault's allowlist. Deliberately distinct from
     * {@link #VALIDATION_FAILED}: no field the client can correct will help, only a different file.
     */
    public static final String UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type";

    /**
     * 405 — the route exists but not for this verb. Distinct from {@link #NOT_FOUND}: the client has
     * the path right and the method wrong, which is a different fix and a different bug on their side.
     */
    public static final String METHOD_NOT_ALLOWED = "method_not_allowed";

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

        /**
         * The 400 sent when a request body cannot be parsed.
         *
         * <p>Deliberately says nothing about <em>why</em>. The underlying
         * {@code HttpMessageNotReadableException} message is Jackson's, and it names the target Java
         * class, the JSON pointer and a fragment of the submitted payload — an internal map of the
         * deserialisation layer handed to whoever sent the malformed bytes. A caller who sent
         * unparseable JSON already has the JSON; they do not need our class names to fix it.
         */
        public static final String MALFORMED_BODY = "Request body could not be read";

        /** 405 — the path matched, the verb did not. */
        public static final String METHOD_NOT_ALLOWED = "That method is not supported on this resource";

        /** 415 — Spring refused the request's Content-Type before any controller code ran. */
        public static final String UNSUPPORTED_CONTENT_TYPE = "That content type is not supported on this resource";
    }
}
