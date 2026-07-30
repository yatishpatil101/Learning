package com.punenest.api.common.web;

/**
 * The canonical URI of every HTTP route, in one place.
 *
 * <p><strong>Why this exists.</strong> Route strings are not merely repeated text — they are
 * duplicated across two files that must agree or the app is <em>insecure</em>: the controller that
 * declares a route, and {@code SecurityConfig} that decides whether it is public. A typo in the
 * security chain does not fail the build and does not fail a happy-path test; it silently leaves an
 * endpoint authenticated that the contract says is public (an outage), or — far worse — leaves a
 * matcher too broad and exposes a route that should be guarded. Binding both sides to the same
 * constant makes that class of drift impossible.
 *
 * <p><strong>Absolute-path rule.</strong> Every constant here is the <em>full</em> path from the API
 * root, and controllers therefore declare their mappings at method level with no class-level
 * {@code @RequestMapping} prefix. The alternative — a class-level base plus relative method
 * constants — forces every route to exist as two constants (a relative one for the controller and a
 * composed absolute one for the security chain), which reintroduces exactly the drift this class
 * removes. One route, one constant, one meaning.
 *
 * <p>Values are compile-time constants, so they are legal in annotations and may be composed with
 * {@code +} (see {@link Properties#BY_ID}). Paths are relative to the {@code /api} servlet context
 * prefix, which is applied by configuration, not repeated here.
 *
 * <p>Only routes the application itself serves belong here. Framework/infrastructure paths (Swagger
 * UI, actuator, static assets) are referenced once, in the security chain, and are deliberately left
 * as literals there — they have no controller to drift from.
 */
public final class Routes {

    private Routes() {
    }

    /** Identity &amp; Access. The three unauthenticated entry points are {@code security: []} in the spec. */
    public static final class Auth {

        private Auth() {
        }

        /** Public — dual-mode: {mobile} sends an OTP, {mobile,otp} verifies and issues tokens. */
        public static final String LOGIN = "/auth/login";

        /** Public — internal staff email+password authentication. */
        public static final String STAFF_LOGIN = "/auth/staff-login";

        /** Public — rotates the refresh token; reuse revokes the whole family. */
        public static final String REFRESH = "/auth/refresh";

        /** Authenticated — revokes the caller's refresh-token family. */
        public static final String LOGOUT = "/auth/logout";

        /**
         * Authenticated — the caller's own profile. Sits under {@code /auth} per the contract even
         * though it is a {@code User} resource, so the controller lives in the {@code user} package.
         */
        public static final String ME = "/auth/me";
    }

    /** Public catalogue reads plus the owner's moderation actions on a listing. */
    public static final class Properties {

        private Properties() {
        }

        /** Public — faceted search. Also the base for the paths below. */
        public static final String BASE = "/properties";

        /** Public — featured-first listings for the homepage. */
        public static final String FEATURED = BASE + "/featured";

        /** Public — single listing by slug or id. */
        public static final String BY_ID = BASE + "/{id}";

        /**
         * Security-chain matcher for the public single-listing read. Deliberately single-segment
         * ({@code *}, not {@code **}) so deeper write routes such as {@link #ARCHIVE} stay
         * authenticated rather than being swept into the public allowlist.
         */
        public static final String ANY_SINGLE = BASE + "/*";

        /** Authenticated — soft-delete (never a hard delete). */
        public static final String ARCHIVE = BY_ID + "/archive";

        /** Authenticated — undo an archive; the listing returns to moderation. */
        public static final String RESTORE = BY_ID + "/restore";
    }

    /** The authenticated owner's own listings. */
    public static final class MeListings {

        private MeListings() {
        }

        public static final String BASE = "/me/listings";

        public static final String BY_ID = BASE + "/{id}";
    }

    /** The contact gate: what a signed-in caller may see of a listing owner, and how to ask. */
    public static final class Contacts {

        private Contacts() {
        }

        private static final String BASE = "/contacts";

        /** Authenticated — the caller's gate status for one listing ({@code ?propertyId=}). */
        public static final String STATUS = BASE + "/status";

        /** Authenticated — ask the owner to reveal their contact. L1 only; the badge is not required. */
        public static final String REQUEST = BASE + "/request";
    }

    /** The listing owner's inbox of incoming contact requests. Strictly owner-scoped. */
    public static final class MeContactRequests {

        private MeContactRequests() {
        }

        public static final String BASE = "/me/contact-requests";

        /** {@code reqId}, not {@code id} — the contract's {@code ReqId} path parameter. */
        public static final String BY_ID = BASE + "/{reqId}";
    }

    /** The caller's opt-in identity badge (L2). Absence never blocks anything (ADR-019). */
    public static final class Verification {

        private Verification() {
        }

        /** Authenticated — {@code GET} reads the badge, {@code POST} starts the DigiLocker flow. */
        public static final String AADHAAR = "/me/verification/aadhaar";
    }

    /** Server-to-server callbacks. Unauthenticated by contract ({@code security: []}) — a webhook
     *  carries no user session; its authenticity comes from an HMAC signature over the raw body,
     *  which is verified in the handler, not by the filter chain. */
    public static final class Webhooks {

        private Webhooks() {
        }

        /** Public — Cashfree/DigiLocker verification result. Signature-verified, idempotent, always 200. */
        public static final String CASHFREE_DIGILOCKER = "/webhooks/cashfree/digilocker";
    }
}
