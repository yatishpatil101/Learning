package com.draazy.api.common.web;

public final class Routes {

    private Routes() {
    }

    public static final class Auth {

        private Auth() {
        }

        /** Public — dual-mode: {mobile} sends an OTP, {mobile,otp} verifies and issues tokens. */
        public static final String LOGIN = "/auth/login";

        /** Public — staff step one: email + password; answers a second-factor challenge, never tokens. */
        public static final String STAFF_LOGIN = "/auth/staff-login";

        /** Public — staff step two: the challenge plus an authenticator or recovery code. */
        public static final String STAFF_LOGIN_VERIFY = STAFF_LOGIN + "/verify";

        /** Public — staff step two for an account with no authenticator yet: mint its secret. */
        public static final String STAFF_LOGIN_ENROL = STAFF_LOGIN + "/enrol";

        /** Public — confirm the new authenticator with its first code. */
        public static final String STAFF_LOGIN_ENROL_CONFIRM = STAFF_LOGIN_ENROL + "/confirm";

        /** Public — rotates the refresh token; reuse revokes the whole family. */
        public static final String REFRESH = "/auth/refresh";

        /** Public — unauthenticated because the expiring single-use token is itself the credential
         * (checked in StaffInviteService). */
        public static final String STAFF_INVITE_REDEEM = "/auth/staff-invite/redeem";

        /** Authenticated — revokes the caller's refresh-token family. */
        public static final String LOGOUT = "/auth/logout";

        public static final String ME = "/auth/me";
    }

    public static final class Properties {

        private Properties() {
        }

        public static final String BASE = "/properties";

        public static final String FEATURED = BASE + "/featured";

        public static final String BY_ID = BASE + "/{id}";

        /** Security-chain matcher for the public single-listing read. Single-segment ({@code *}) so
         * deeper write routes such as {@link #ARCHIVE} stay authenticated. */
        public static final String ANY_SINGLE = BASE + "/*";

        public static final String ARCHIVE = BY_ID + "/archive";

        public static final String RESTORE = BY_ID + "/restore";

        public static final String SPLIT = BY_ID + "/split";
    }

    /** The public seller card. Deliberately not under {@link Users} — that family is the staff
     * directory, and this one is capped to what a stranger may know. */
    public static final class Owners {

        private Owners() {
        }

        /** Public — one owner's profile card. There is deliberately no collection read: a public
         * {@code GET /owners} would be a downloadable list of the platform's landlords. */
        public static final String BY_ID = "/owners/{id}";

        /** Security-chain matcher. Single-segment on purpose: a {@code **} would make a future deeper
         * owner route public before anybody had decided it should be. */
        public static final String ANY_SINGLE = "/owners/*";
    }

    /** The public reference catalogue: cities, localities, societies, reels and the fee schedule.
     * Every route below is {@code security: []}. */
    public static final class Cities {

        private Cities() {
        }

        public static final String WAITLIST = "/cities/waitlist";
    }

    public static final class Localities {

        private Localities() {
        }

        public static final String BASE = "/localities";

        /** Public {@code POST} - the locality a Google place pick is, minting the row when none exists. */
        public static final String RESOLVE = BASE + "/resolve";

        /** Public {@code GET} - live localities by name, for when Google suggestions are unavailable. */
        public static final String SEARCH = BASE + "/search";

        public static final String BY_SLUG = BASE + "/{slug}";

        /** Security-chain matcher: single segment, so any deeper route stays authenticated. */
        public static final String ANY_SINGLE = BASE + "/*";
    }

    public static final class Societies {

        private Societies() {
        }

        public static final String BASE = "/societies";

        /** Public {@code GET} - what a Google place pick already is in the catalogue, or might duplicate. */
        public static final String RESOLVE = BASE + "/resolve";

        public static final String BY_SLUG = BASE + "/{slug}";

        /** Security-chain matcher; single-segment for the same reason as {@link Localities#ANY_SINGLE}. */
        public static final String ANY_SINGLE = BASE + "/*";
    }

    /** Staff — the queue of societies members added because the catalogue did not have them. */
    public static final class SocietyCandidates {

        private SocietyCandidates() {
        }

        public static final String BASE = "/admin/society-candidates";

        public static final String DUPLICATES = BASE + "/{slug}/duplicates";
    }

    public static final class SocietyMerges {

        private SocietyMerges() {
        }

        public static final String BASE = "/admin/society-merges";

        public static final String BY_SLUG = BASE + "/{slug}";
    }

    public static final class AdminSocieties {

        private AdminSocieties() {
        }

        public static final String SUMMARY = "/admin/societies/summary";

        public static final String BY_SLUG = "/admin/societies/{slug}";
    }

    /** Public — what it costs to transact, published before the sign-up wall. */
    public static final class Fees {

        private Fees() {
        }

        public static final String BASE = "/fees";
    }

    public static final class Bootstrap {

        private Bootstrap() {
        }

        /** Public — the reference data every page render needs, in one caller-independent read. */
        public static final String BASE = "/bootstrap";

        /** Authenticated — the caller's own app-shell state, in one read. */
        public static final String ME = "/me/bootstrap";

        /** Authenticated — the signed-in owner/seeker dashboard's inbox reads, in one read. */
        public static final String ME_DASHBOARD = "/me/dashboard";
    }

    /** The authenticated owner's own listings. */
    public static final class MeListings {

        private MeListings() {
        }

        public static final String BASE = "/me/listings";

        public static final String BY_ID = BASE + "/{id}";

        public static final String CONFIRM_AVAILABLE = BY_ID + "/confirm-available";

        public static final String PAUSE = BY_ID + "/pause";

        public static final String RESUME = BY_ID + "/resume";

        /** Owner-only — "have I already listed this?", asked before the wizard submits. */
        public static final String DUPLICATE_CHECK = BASE + "/duplicate-check";
    }

    /** The authenticated owner's private "single-player" property records — the Owner Hub /
     * Property Passport / rent tracker. */
    public static final class MeManagedProperties {

        private MeManagedProperties() {
        }

        public static final String BASE = "/me/managed-properties";

        public static final String BY_ID = BASE + "/{id}";

        public static final String PUBLISH = BASE + "/{id}/publish";

        public static final String RENT_RECEIPTS = BY_ID + "/rent-receipts";
    }

    public static final class MePhotos {

        private MePhotos() {
        }

        public static final String BASE = "/me/photos";

        public static final long MAX_FILE_BYTES = 1_000_000L;
    }

    public static final class PropertyPhotoRequests {

        private PropertyPhotoRequests() {
        }

        /** Authenticated. Sign-in is the whole gate — no badge, no quota; see {@code PhotoRequestService}. */
        public static final String BASE = Properties.BY_ID + "/photo-requests";
    }

    public static final class MePhotoRequests {

        private MePhotoRequests() {
        }

        public static final String BASE = "/me/photo-requests";

        public static final String BY_ID = BASE + "/{reqId}";
    }

    /** The owner's private annotations on their own leads — never seen by the buyer and never joined
     * into a buyer-facing payload. */
    public static final class MeLeadNotes {

        private MeLeadNotes() {
        }

        public static final String BASE = "/me/lead-notes";

        public static final String BY_KEY = BASE + "/{leadKey}";
    }

    public static final class Contacts {

        private Contacts() {
        }

        private static final String BASE = "/contacts";

        /** Authenticated — the caller's gate status for one listing ({@code ?propertyId=}). */
        public static final String STATUS = BASE + "/status";

        /** Authenticated — ask the owner to reveal their contact. L1 only; the badge is not required. */
        public static final String REQUEST = BASE + "/request";
    }

    public static final class MeContactRequests {

        private MeContactRequests() {
        }

        public static final String BASE = "/me/contact-requests";


        public static final String BY_ID = BASE + "/{reqId}";
    }

    public static final class Conversations {

        private Conversations() {
        }

        /** Authenticated — GET the caller's inbox, POST to open (or re-open) a thread. */
        public static final String BASE = "/messages";

        public static final String UNREAD_COUNT = BASE + "/unread-count";

        public static final String STREAM = BASE + "/stream";

        public static final String BY_ID = BASE + "/{id}";

        public static final String REPLY = BY_ID + "/reply";

        public static final String PHOTOS = BY_ID + "/photos";

        public static final String READ = BY_ID + "/read";

        public static final String TYPING = BY_ID + "/typing";

        public static final String STATE = BY_ID + "/state";

        public static final String ITEM = BY_ID + "/items/{messageId}";

        public static final String BLOCK = BY_ID + "/block";

        public static final String FLATMATE_GROUP = BASE + "/flatmate-groups/{groupId}";

        public static final String FLATMATE_REQUEST = BASE + "/flatmate-requests/{requestId}";
    }

    public static final class SupportTickets {

        private SupportTickets() {
        }

        /** Authenticated — GET the caller's own tickets, POST to raise one. */
        public static final String BASE = "/support/tickets";

        public static final String BY_ID = BASE + "/{id}";

        public static final String MESSAGES = BY_ID + "/messages";

        public static final String READ = BY_ID + "/read";
    }

    public static final class Offers {

        private Offers() {
        }

        /** Authenticated — submit an offer; also the base for the paths below. */
        public static final String BASE = "/offers";

        /** Authenticated — the caller's own submitted offers. */
        public static final String MINE = BASE + "/mine";

        /** Authenticated — accept / decline / counter a specific offer. */
        public static final String RESPOND = BASE + "/{id}/respond";

        /** Authenticated — offers on the caller's own listings. */
        public static final String ME = "/me/offers";
    }

    public static final class Deals {

        private Deals() {
        }

        /** Authenticated — all deals on the caller's own listings. */
        public static final String BASE = "/me/deals";

        /** Authenticated — deal status for one property. */
        public static final String BY_PROP = BASE + "/{propId}";

        /** Authenticated — mark a property under offer. */
        public static final String RESERVE = BY_PROP + "/reserve";

        /** Authenticated — close the deal (sold/rented). */
        public static final String CLOSE = BY_PROP + "/close";

        /** Authenticated — reopen a closed/reserved deal. */
        public static final String REOPEN = BY_PROP + "/reopen";

        /** Authenticated — list/add under-offer parties. */
        public static final String PARTIES = BY_PROP + "/parties";
    }

    public static final class Finalization {

        private Finalization() {
        }

        /** Authenticated — request finalization for a property (buyer, maker step). */
        public static final String REQUEST = "/finalization/{propId}/request";

        public static final String STATUS = "/finalization/{propId}/status";

        /** Authenticated — requests awaiting the caller's decision (owner inbox). */
        public static final String ME_REQUESTS = "/me/finalization-requests";

        /** Authenticated — accept a finalization request (owner, checker step). */
        public static final String ACCEPT = "/finalization/requests/{reqId}/accept";

        /** Authenticated — decline a finalization request (owner). */
        public static final String DECLINE = "/finalization/requests/{reqId}/decline";
    }

    public static final class Visits {

        private Visits() {
        }

        /** Authenticated — visitor surface: list/schedule visits. */
        public static final String BASE = "/visits";

        /** Authenticated — owner surface: visit requests on my listings. */
        public static final String ME_REQUESTS = "/me/visit-requests";

        public static final String STATUS = "/visit-requests/{id}/status";

        /** Authenticated — reschedule a live visit to a new slot; either participant may. */
        public static final String SLOT = BASE + "/{id}/slot";
    }

    public static final class Verification {

        private Verification() {
        }

        /** Authenticated — {@code GET} reads the case, {@code POST} (multipart) submits live-captured
         * document photos and a selfie for staff review. */
        public static final String IDENTITY = "/me/verification/identity";

        public static final String IDENTITY_DISPUTE = IDENTITY + "/dispute";

        public static final String IDENTITY_CHALLENGE = IDENTITY + "/challenge";

        /** Authenticated, {@code local} profile only ({@code @LocalOnly}) — approves the caller's case
         * so the earned-badge state can be demonstrated without a second staff session. */
        public static final String IDENTITY_SIMULATE = IDENTITY + "/simulate";
    }

    public static final class DevStorage {

        private DevStorage() {
        }

        /** {@code {*key}} rather than {@code {key}} because a storage key has slashes in it
         * ({@code documents/{propertyId}/{uuid}}) and a single-segment template would match none. */
        public static final String OBJECT = "/dev/storage/{*key}";

        /** The same routes as a servlet pattern, for the security matcher that fronts them. */
        public static final String ANY = "/dev/storage/**";
    }

    public static final class Finances {

        private Finances() {
        }

        /** Authenticated — the per-property ledger root. Not itself a route. */
        private static final String BASE = "/me/finances/{propId}";

        /** Authenticated — {@code GET} lists the ledger, {@code POST} records a row. */
        public static final String TRANSACTIONS = BASE + "/transactions";

        public static final String TRANSACTION_BY_ID = TRANSACTIONS + "/{txnId}";

        /** Authenticated — {@code PUT} the purchase and valuation figures. */
        public static final String BASIS = BASE + "/basis";

        /** Authenticated — income/expense/net over a window. */
        public static final String SUMMARY = BASE + "/summary";

        /** Authenticated — {@code GET} basis, dues and cashflow in one read. */
        public static final String OVERVIEW = BASE + "/overview";
    }

    public static final class Rentals {

        private Rentals() {
        }

        /** Authenticated — {@code GET} lists the caller's rentals, {@code POST} records one. */
        public static final String MINE = "/me/rentals";

        public static final String BY_ID = MINE + "/{rentalId}";
    }

    public static final class Tenancies {

        private Tenancies() {
        }

        /** Authenticated — tenancies the caller holds as tenant. */
        public static final String MINE = "/me/tenancies";

        // Authenticated — tenancies on the caller's listings.
        /** Authenticated — {@code GET}/{@code PUT} the caller's own tenant profile. */
        public static final String MY_PROFILE = "/me/tenant-profile";

        // Authenticated — an owner screening a tenant they have a relationship with.
        /** Authenticated — the badge-only batch of {@link #PROFILE_BY_MOBILE}. */
        public static final String PROFILES_VERIFIED = "/tenant-profiles/verified";

        /** Authenticated — stays claimed on one listing. */
        public static final String DECLARATIONS = "/properties/{propId}/tenancy-declarations";

        /** Authenticated — the owner agrees a claimed stay happened. Their listing only. */
        public static final String DECLARATION_CONFIRM = "/tenancy-declarations/{id}/confirm";

        /** Authenticated — the owner disagrees, or withdraws an earlier confirmation. */
        public static final String DECLARATION_REVOKE = "/tenancy-declarations/{id}/revoke";
    }

    public static final class Engagement {

        private Engagement() {
        }

        /** Authenticated — the caller's shortlist, as full property summaries. */
        public static final String SAVED = "/me/saved";

        public static final String SAVED_BY_PROPERTY = SAVED + "/{propId}";

        /** Authenticated — the caller's flatmate shortlist, as full card projections. */
        public static final String FLATMATE_SAVES = "/me/flatmate-saves";

        // Authenticated — the caller's flatmate shortlist as bare keys, unpaged.
        public static final String FLATMATE_SAVE_KEYS = FLATMATE_SAVES + "/keys";

        public static final String FLATMATE_SAVE_BY_ID = FLATMATE_SAVES + "/{kind}/{id}";

        public static final String SOCIETY_FOLLOW = "/me/societies/{slug}/follow";

        /** Authenticated — {@code GET} the societies the caller follows, paged, newest follow first. */
        public static final String SOCIETIES_FOLLOWING = "/me/societies/following";

        /** Authenticated — {@code GET} the caller's saved searches, {@code POST} to add one. */
        public static final String SAVED_SEARCHES = "/me/saved-searches";

        public static final String SAVED_SEARCH_BY_ID = SAVED_SEARCHES + "/{id}";

        /** Authenticated — {@code GET} the caller's recent searches (the "resume your search" rail),
         * {@code PUT} to record one. */
        public static final String RECENT_SEARCHES = "/me/recent-searches";

        /** Authenticated — the caller's notifications, newest first, paged. */
        public static final String NOTIFICATIONS = "/notifications";

        /** Authenticated — marks the given ids read, or all of them when the body is absent. */
        public static final String NOTIFICATIONS_READ = NOTIFICATIONS + "/read";

        public static final String NOTIFICATIONS_UNREAD_COUNT = NOTIFICATIONS + "/unread-count";

        public static final String NOTIFICATION_BY_ID = NOTIFICATIONS + "/{id}";

        /** Authenticated — {@code GET}/{@code PUT} channel switches, the master match-alert switch,
         * quiet hours and language. */
        public static final String NOTIFICATION_PREFERENCES = "/me/notification-preferences";

        public static final String PUSH_SUBSCRIPTIONS = "/me/push-subscriptions";
    }

    public static final class Flatmates {

        private Flatmates() {
        }

        /** {@code GET} public — the team-up supply. {@code POST} authenticated — advertise yourself. */
        public static final String POSTS = "/flatmates/posts";

        public static final String POST_BY_ID = POSTS + "/{id}";

        /** Authenticated — answer an ad, releasing the <em>requester's</em> contact to the host. */
        public static final String POST_INTEREST = POST_BY_ID + "/interest";

        // Authenticated — who answered this ad. Poster-scoped, and never public.
        /** Authenticated — the caller's own ad, as its author sees it. */
        public static final String MY_POSTS = "/me/flatmate-posts";

        /** Authenticated — the caller's incoming requests (host inbox). */
        public static final String MY_REQUESTS = "/me/flatmate-requests";

        /** Authenticated — accept or decline one incoming request. Host-scoped. */
        public static final String MY_REQUEST_BY_ID = MY_REQUESTS + "/{id}";

        /** Authenticated — every ask the caller has <em>sent</em>, through any of the three doors. */
        public static final String MY_INTERESTS = "/me/flatmate-interests";

        /** Authenticated — take back an ask, while it is still unanswered. */
        public static final String INTEREST_BY_TARGET = "/flatmates/{kind}/{id}/interest";

        public static final String RENEW = "/flatmates/{kind}/{id}/renew";

        public static final String FEED = "/flatmates/feed";

        /** {@code GET} public — rooms. {@code POST} authenticated — offer a spare room. */
        public static final String ROOMS = "/flatmates/rooms";

        /** Authenticated — withdraw a room I posted. */
        public static final String ROOM_BY_ID = ROOMS + "/{id}";

        /** Authenticated — reopen or close a seat. Seat-model rooms only. */
        public static final String ROOM_SEATS = ROOMS + "/{id}/seats";

        /** Authenticated — record how many people live in a room. Owner-split rooms only. */
        public static final String ROOM_OCCUPANTS = ROOMS + "/{id}/occupants";

        /** Authenticated — enquire about a room, carrying the share intent. */
        public static final String ROOM_INTEREST = ROOMS + "/{id}/interest";

        /** {@code GET} public — groups. {@code POST} authenticated — start one. */
        public static final String GROUPS = "/flatmates/groups";

        /** Authenticated — remove a group I created. */
        public static final String GROUP_BY_ID = GROUPS + "/{id}";

        /** Authenticated — reopen or close a group seat. */
        public static final String GROUP_SEATS = GROUP_BY_ID + "/seats";

        public static final String OWNER_CONSENT = "/flatmates/owner-consent";

        /** Authenticated — ask to join. An open-policy group accepts outright. */
        public static final String GROUP_JOIN = GROUP_BY_ID + "/join";

        public static final String GROUP_MEMBERSHIP = GROUP_BY_ID + "/membership";

        public static final String GROUP_MEMBER = GROUP_BY_ID + "/members/{memberId}";

        /** Authenticated — the groups the caller started, moderation state and all. */
        public static final String MY_GROUPS = "/me/flatmate-groups";

        /** Authenticated — the rooms the caller posted, moderation state and all. */
        public static final String MY_ROOMS = "/me/flatmate-rooms";

        /** Authenticated — a formed group applies to an owner's whole-flat listing. */
        public static final String GROUP_APPLY = GROUP_BY_ID + "/apply";

        /** Authenticated — applications addressed to the caller's own listings (owner inbox). */
        public static final String MY_GROUP_APPLICATIONS = "/me/group-applications";

        /** Authenticated — accept or decline one application. Owner-scoped. */
        public static final String MY_GROUP_APPLICATION_BY_ID = MY_GROUP_APPLICATIONS + "/{id}";
    }

    public static final class Reviews {

        private Reviews() {
        }

        /** {@code GET} public, {@code POST} authenticated — reviews of one listing. */
        public static final String FOR_PROPERTY = "/properties/{propId}/reviews";

        /** {@code GET} public, {@code POST} authenticated — reviews of a society, locality or owner. */
        public static final String FOR_ENTITY = "/reviews/{entityType}/{entityId}";
    }

    public static final class Content {

        private Content() {
        }

        public static final String FAQS = "/faqs";
    }

    public static final class MeDocuments {

        private MeDocuments() {
        }

        private static final String BASE = "/me/documents";

        public static final String FOR_PROPERTY = BASE + "/{propId}";

        public static final String BY_ID = BASE + "/{propId}/{docId}";

        /** The caller's own KYC papers (list + upload) — Aadhaar, PAN, a passport photo. */
        public static final String PERSONAL = BASE + "/personal";

        public static final String PERSONAL_BY_ID = PERSONAL + "/{docId}";

        public static final String FOR_MANAGED = BASE + "/managed/{managedId}";

        public static final String MANAGED_BY_ID = FOR_MANAGED + "/{docId}";

        public static final String REQUESTS = BASE + "/requests";

        public static final String REQUEST_BY_ID = REQUESTS + "/{reqId}";
    }

    public static final class Documents {

        private Documents() {
        }

        private static final String BASE = "/documents";

        public static final String REQUESTS = BASE + "/requests";

        /** Public but token-scoped — read the documents a grant unlocked. */
        public static final String SHARED = BASE + "/shared";
    }

    public static final class MeDocumentRequests {

        private MeDocumentRequests() {
        }

        public static final String BASE = "/me/document-requests";

        /** Buyer — the documents one of their own granted requests unlocked, read while signed in. */
        public static final String DOCUMENTS_BY_ID = BASE + "/{reqId}/documents";
    }

    public static final class MeRentAgreements {

        private MeRentAgreements() {
        }

        public static final String BASE = "/me/rent-agreements";
    }

    public static final class ServiceRequests {

        private ServiceRequests() {
        }

        public static final String BASE = "/service-requests";

        public static final String QUEUE_SUMMARY = BASE + "/queue-summary";

        public static final String BY_ID = BASE + "/{id}";

        public static final String CO_FILL_CREATE = BASE + "/co-fill";

        public static final String STATUS = BY_ID + "/status";

        public static final String MESSAGES = BY_ID + "/messages";

        public static final String DOCS = BY_ID + "/docs";

        public static final String DOCS_FROM_VAULT = DOCS + "/from-vault";

        public static final String CHECKLIST = BY_ID + "/checklist";
        public static final String CHECKLIST_ITEM = CHECKLIST + "/{category}";

        /** The parties' PAN and Aadhaar — <strong>written by the requester, read only by the staff
         * member the request is assigned to</strong>. */
        public static final String IDENTITIES = BY_ID + "/identities";

        public static final String DRAFT = BY_ID + "/draft";

        public static final String DRAFT_DECISION = DRAFT + "/decision";

        public static final String DRAFT_OTP = DRAFT + "/otp";

        public static final String DRAFT_CHECK = DRAFT + "/check";

        public static final String DRAFT_OPENED = DRAFT + "/opened";

        public static final String FINAL_DOC = BY_ID + "/final-doc";

        /** Staff/admin — the tenancy rows the registered copy produced, for the second-operator check. */
        public static final String RENT_AGREEMENTS = BY_ID + "/rent-agreements";

        public static final String OVERLAPS = BY_ID + "/overlaps";

        public static final String AMENDMENTS = BY_ID + "/amendments";
        public static final String AMENDMENT_ACCEPT = AMENDMENTS + "/{amendmentId}/accept";
        public static final String AMENDMENT_WITHDRAW = AMENDMENTS + "/{amendmentId}/withdraw";

        public static final String REFUNDS = BY_ID + "/refunds";
        public static final String REFUND_APPROVE = REFUNDS + "/{refundId}/approve";
        public static final String REFUND_REJECT = REFUNDS + "/{refundId}/reject";

        public static final String POLICE_INTIMATION = BY_ID + "/police-intimation";

        public static final String PARTIES = BY_ID + "/parties";

        public static final String PARTY_BY_ID = PARTIES + "/{partyId}";

        public static final String PARTY_DETAILS = BY_ID + "/party-details";

        public static final String CHECKOUT = BY_ID + "/checkout";

        /** Authenticated, {@code local} profile only ({@code @LocalOnly}) — settles a mock checkout. */
        public static final String PAYMENT_SIMULATE = BY_ID + "/payment/simulate";

        public static final String READ = BY_ID + "/read";

        public static final String MY_INVITES = "/me/service-request-invites";

        public static final String INVITE_DECISION = MY_INVITES + "/{partyId}";
    }

    /** Subscriptions. The plan catalogue itself is published on {@link Bootstrap#BASE}. */
    public static final class Plans {

        private Plans() {
        }

        /** Authenticated — {@code GET} the caller's current plan, {@code POST} to change it. */
        public static final String SUBSCRIPTION = "/me/subscription";

        /** Authenticated — what the caller is entitled to do: owner contacts and listing slots. */
        public static final String ENTITLEMENTS = "/me/entitlements";
    }

    /** Staff/admin — quote an order and drive it to completion. */
    public static final class Referrals {

        private Referrals() {
        }

        public static final String BASE = "/referrals";

        /** Authenticated — the caller's own code and rewards. */
        public static final String MINE = "/me/referrals";

        /** Authenticated — redeem someone else's code. */
        public static final String REDEEM = BASE + "/redeem";

        public static final String APPROVE = BASE + "/{id}/approve";

        public static final String REJECT = BASE + "/{id}/reject";

        public static final String CLAWBACK = BASE + "/{id}/clawback";
    }

    public static final class Tickets {

        private Tickets() {
        }

        public static final String BASE = "/tickets";

        public static final String BY_ID = BASE + "/{id}";

        public static final String NOTES = BY_ID + "/notes";
    }

    public static final class ServiceWaitlist {

        private ServiceWaitlist() {
        }

        /** Public and rate-limited per mobile; there is no read — see {@code TicketService}. */
        public static final String BASE = "/service-waitlist";
    }

    /** Trust &amp; safety and the back-office (slice 9) — the platform's first admin trust boundary. */
    public static final class Moderation {

        private Moderation() {
        }

        public static final String PROPERTY_STATUS = Properties.BY_ID + "/status";

        public static final String PROPERTY_FLAG = Properties.BY_ID + "/flag";

        public static final String PROPERTY_ADMIN_UPDATE = Properties.BY_ID + "/admin";

        /** Authenticated, participant-scoped. No {@code x-roles}: the owner is a participant, so
         * role-gating it would lock them out of their own review. */
        public static final String PROPERTY_VERIFICATION = Properties.BY_ID + "/verification";

        /** Authenticated, participant-scoped — post to the thread. */
        public static final String VERIFICATION_MESSAGES = PROPERTY_VERIFICATION + "/messages";

        /** Authenticated, participant-scoped — mark the caller's own side of the thread read. */
        public static final String VERIFICATION_READ = PROPERTY_VERIFICATION + "/read";

        public static final String VERIFICATION_DECISION = PROPERTY_VERIFICATION + "/decision";

        public static final String VERIFICATION_CHECKLIST = PROPERTY_VERIFICATION + "/checklist";

        /** The ownership gate. GET is participant-scoped — an owner must see which required fact they
         * are waiting on — while POST, which grants the badge, is staff/admin. */
        public static final String VERIFICATION_OWNERSHIP = PROPERTY_VERIFICATION + "/ownership";

        public static final String VERIFICATION_OWNERSHIP_EVIDENCE = VERIFICATION_OWNERSHIP + "/evidence";

        public static final String VERIFICATION_OWNERSHIP_DOCUMENTS = VERIFICATION_OWNERSHIP + "/documents";

        public static final String VERIFICATION_OWNERSHIP_REQUEST = VERIFICATION_OWNERSHIP + "/request";

        public static final String VERIFICATION_OWNERSHIP_DECLINE = VERIFICATION_OWNERSHIP + "/decline";

        public static final String ADMIN_PROPERTY_REVIEWS = "/admin/property-reviews";

        public static final String ME_PROPERTY_REVIEWS = "/me/property-reviews";

        public static final String REPORTS = "/reports";

        public static final String REPORT_BY_ID = REPORTS + "/{id}";

        public static final String REVIEW_STATUS = "/reviews/{id}/status";

        public static final String NOTES_FOR_ENTITY = "/admin/notes/{entityType}/{entityId}";

        public static final String ADMIN_REVIEWS = "/admin/reviews";

        public static final String ADMIN_PROPERTIES = "/admin/properties";

        public static final String ADMIN_PROPERTIES_SUMMARY = ADMIN_PROPERTIES + "/summary";

        public static final String ADMIN_PROPERTIES_OWNER_STANDING =
                ADMIN_PROPERTIES + "/owner-standing";

        public static final String ADMIN_PROPERTIES_DUPLICATES = ADMIN_PROPERTIES + "/duplicates";

        public static final String ADMIN_PROPERTIES_DUPLICATES_MERGE =
                ADMIN_PROPERTIES_DUPLICATES + "/merge";

        public static final String ADMIN_PROPERTIES_DUPLICATES_DISMISS =
                ADMIN_PROPERTIES_DUPLICATES + "/dismiss";

        public static final String PROPERTY_OUTREACH = Properties.BY_ID + "/outreach";

        public static final String ADMIN_ENQUIRIES = "/admin/enquiries";

        public static final String ADMIN_VISITS = "/admin/visits";

        public static final String ADMIN_DEALS = "/admin/deals";

        public static final String ADMIN_ENQUIRY_BY_ID = ADMIN_ENQUIRIES + "/{id}";

        /** Admin — one site visit, visitor's mobile unmasked and audited. See {@link #ADMIN_ENQUIRY_BY_ID}. */
        public static final String ADMIN_VISIT_BY_ID = ADMIN_VISITS + "/{id}";

        /** Admin — one deal, counterparty's mobile unmasked and audited. See {@link #ADMIN_ENQUIRY_BY_ID}. */
        public static final String ADMIN_DEAL_BY_ID = ADMIN_DEALS + "/{id}";

        public static final String FLATMATE_REVIEWS = "/admin/flatmate-reviews";

        /** Ops — decide one host verification. A rejection must carry a reason. */
        public static final String FLATMATE_REVIEW_BY_ID = FLATMATE_REVIEWS + "/{id}";


        /** Under {@code /admin} rather than {@code /me} because every status past {@code draft} asserts
         * what a sub-registrar did, and the flatmate trust sweep reads that field as badge evidence. */
        public static final String RENT_AGREEMENT_BY_ID = "/admin/rent-agreements/{id}";

        public static final String IDENTITY_REVIEWS = "/moderation/identity-reviews";

        public static final String IDENTITY_REVIEW_SUMMARY = IDENTITY_REVIEWS + "/summary";

        public static final String IDENTITY_REVIEW_BY_ID = IDENTITY_REVIEWS + "/{id}";

        public static final String IDENTITY_REVIEW_APPROVE = IDENTITY_REVIEW_BY_ID + "/approve";

        public static final String IDENTITY_REVIEW_REJECT = IDENTITY_REVIEW_BY_ID + "/reject";

        public static final String IDENTITY_REVIEW_REVOKE = IDENTITY_REVIEW_BY_ID + "/revoke";

        public static final String FLATMATE_MODERATION = "/admin/flatmates/{id}/moderation";

        public static final String FLATMATE_MODERATION_QUEUE = "/admin/flatmates/moderation";

        public static final String FLATMATE_MODERATION_DETAIL = "/admin/flatmates/{id}";

        public static final String GROUP_APPLICATIONS = "/admin/group-applications";

        /** Admin — moderate one group application. */
        public static final String GROUP_APPLICATION_BY_ID = GROUP_APPLICATIONS + "/{id}";
    }

    /** User administration. Distinct from {@link Auth#ME}, which is the caller's own profile:
     * everything here acts on <em>somebody else's</em> account. */
    public static final class Users {

        private Users() {
        }

        /** Staff/admin — paged directory, full mobiles; the detail read is the audited one. */
        public static final String BASE = "/users";

        public static final String BY_ID = BASE + "/{id}";

        public static final String KYC_PROFILE = BY_ID + "/kyc-profile";

        public static final String ARCHIVE = BY_ID + "/archive";

        public static final String RESTORE = BY_ID + "/restore";

        public static final String SUSPEND = BY_ID + "/suspend";

        public static final String REACTIVATE = BY_ID + "/reactivate";

        public static final String BADGE = BY_ID + "/badge";

        public static final String FLAG = BY_ID + "/flag";

        public static final String TIMELINE = BY_ID + "/timeline";

        public static final String STAFF = BASE + "/staff";

        /** Admin only — send a fresh set-password invite (forgotten password, expired invite). */
        public static final String REISSUE_INVITE = BY_ID + "/reissue-invite";

        /** Admin only — clear a lost authenticator; the holder enrols again at next sign-in. */
        public static final String RESET_TWO_FACTOR = BY_ID + "/reset-2fa";

        /** Admin only — read or replace one back-office account's permission document. */
        public static final String PERMISSIONS = BY_ID + "/permissions";
    }

    /** The back-office: the ops dashboard, platform configuration, CMS authoring and the audit read. */
    public static final class Admin {

        private Admin() {
        }

        public static final String AUDIT_LOG = "/admin/audit-log";

        public static final String STAFF_ACTIVITY = "/admin/staff-activity";

        public static final String STAFF_ACTIVITY_SUMMARY = STAFF_ACTIVITY + "/summary";

        public static final String TEAM_PERFORMANCE = "/admin/team-performance";

        public static final String MY_WORK = "/admin/my-work";

        public static final String BADGE_GRANTS = "/admin/badge-grants";

        public static final String BADGE_GRANT_APPROVE = BADGE_GRANTS + "/{id}/approve";

        public static final String BADGE_GRANT_REJECT = BADGE_GRANTS + "/{id}/reject";

        public static final String DASHBOARD = "/admin/dashboard";

        public static final String BELL = "/admin/bell";

        public static final String SUPPLY_GAP = "/admin/supply-gap";

        /** Staff/admin — what live flats are asked for, per locality, from the listings. */
        public static final String ANALYTICS_PRICING = "/admin/analytics/pricing";

        public static final String ANALYTICS_SLA = "/admin/analytics/sla";

        public static final String ANALYTICS_TRAFFIC = "/admin/analytics/traffic";

        /** Staff/admin — what visitors did once they arrived: session depth, bounce rate, top pages. */
        public static final String ANALYTICS_ENGAGEMENT = "/admin/analytics/engagement";

        public static final String ANALYTICS_SURFERS = "/admin/analytics/surfers";

        public static final String ANALYTICS_FUNNEL = "/admin/analytics/funnel";

        public static final String SUPPORT_TICKETS = "/admin/support-tickets";

        public static final String FINANCE = "/admin/finance";

        public static final String FINANCE_SERIES = FINANCE + "/series";

        public static final String FINANCE_TRANSACTIONS = FINANCE + "/transactions";

        public static final String SETTINGS = "/admin/settings";

        /** Admin only — one curated city's launch state. */
        public static final String CITY_BY_SLUG = "/admin/cities/{slug}";

        public static final String CITY_WAITLIST = "/admin/cities/waitlist";


        public static final String FUNCTION_CATALOGUE = "/admin/function-catalogue";

        public static final String TEAM = "/admin/team";

        public static final String MESSAGE_TEMPLATES = "/admin/message-templates";

        public static final String CONTENT = "/admin/content/{type}";

        public static final String CONTENT_ITEM = CONTENT + "/{id}";

        public static final String CONTENT_ARCHIVE = CONTENT_ITEM + "/archive";

        public static final String CONTENT_RESTORE = CONTENT_ITEM + "/restore";
    }

    public static final class DemandSignals {

        private DemandSignals() {
        }

        /** POST is public and capped per IP by {@code WriteRateLimitFilter}. There is no GET. */
        public static final String BASE = "/demand-signals";
    }

    public static final class PageViews {

        private PageViews() {
        }

        /** POST is public and capped per IP by {@code WriteRateLimitFilter}; the client batches so
         * that a beacon cannot spend a visitor's whole write budget. */
        public static final String BASE = "/page-views";
    }

    public static final class HelpFeedback {

        private HelpFeedback() {
        }

        /** POST is public and capped per caller by {@code WriteRateLimitFilter}. There is no GET — the
         * verdicts are for whoever maintains the articles, not for the next reader. */
        public static final String BASE = "/help/feedback";
    }

    /** POST is public and rate-limited per mobile; GET is staff/admin and paged. */
    public static final class Webhooks {

        private Webhooks() {
        }

        /** Public — Cashfree payment result. Signature-verified, deduped on order id, always 200. */
        public static final String CASHFREE_PAYMENT = "/webhooks/cashfree/payment";
    }
}
