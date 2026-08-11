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

        /**
         * Owner-only — {@code POST} lets this flat room by room, {@code DELETE} withdraws that.
         *
         * <p>Lives here rather than under {@code /flatmates} because the resource being acted on is
         * the <em>listing</em>: it is the owner changing how their own flat is offered, and the
         * rooms it produces are a consequence. That is also what the contract says.
         */
        public static final String SPLIT = BY_ID + "/split";

        /**
         * Public — the rooms this flat has been split into, plus its occupancy ledger.
         *
         * <p>Sits beside {@link #SPLIT} for the same reason: the subject is the listing. Note this
         * is a <em>deeper</em> path than {@link #ANY_SINGLE} matches, so it needs its own entry in
         * the security chain's public allowlist — being a read on a public listing does not make it
         * public by inheritance.
         */
        public static final String ROOMS = BY_ID + "/rooms";
    }

    /**
     * The public reference catalogue: cities, localities, societies, reels and the fee schedule.
     *
     * <p>Every route below is {@code security: []} in the contract, and every one of them except
     * {@link Cities#WAITLIST} is a read. They are the pages a visitor sees before deciding whether
     * PuneNest is worth signing up for, so putting them behind a token would defeat their purpose.
     */
    public static final class Cities {

        private Cities() {
        }

        /** Public — the city picker, live cities first. */
        public static final String BASE = "/cities";

        /** Public — the one write in the catalogue: "tell me when you launch in my city". */
        public static final String WAITLIST = BASE + "/waitlist";
    }

    /** Public — Pune's localities, the unit almost every search and price signal is keyed on. */
    public static final class Localities {

        private Localities() {
        }

        public static final String BASE = "/localities";

        /** Public — one locality with its narrative fields and price trend. */
        public static final String BY_SLUG = BASE + "/{slug}";

        /**
         * Security-chain matcher for the whole family. Single-segment ({@code *}) on purpose: the
         * contract has no deeper locality route today, and a {@code **} here would silently make any
         * future one public.
         */
        public static final String ANY_SINGLE = BASE + "/*";
    }

    /** Public — housing societies, browsable and individually addressable. */
    public static final class Societies {

        private Societies() {
        }

        /** Public — paged, filterable society directory. */
        public static final String BASE = "/societies";

        /** Public — one society with its homes and community aggregates. */
        public static final String BY_SLUG = BASE + "/{slug}";

        /** Security-chain matcher; single-segment for the same reason as {@link Localities#ANY_SINGLE}. */
        public static final String ANY_SINGLE = BASE + "/*";
    }

    /** Public — the short-video discovery feed. */
    public static final class Reels {

        private Reels() {
        }

        public static final String BASE = "/reels";
    }

    /** Public — what it costs to transact, published before the sign-up wall. */
    public static final class Fees {

        private Fees() {
        }

        public static final String BASE = "/fees";
    }

    /** The authenticated owner's own listings. */
    public static final class MeListings {

        private MeListings() {
        }

        public static final String BASE = "/me/listings";

        public static final String BY_ID = BASE + "/{id}";
    }

    /**
     * The authenticated owner's private "single-player" property records — the Owner Hub / Property
     * Passport / rent tracker. Distinct from {@link MeListings}: these are private by default and
     * only enter the marketplace via {@link #PUBLISH}, which spawns a normal pending listing.
     */
    public static final class MeManagedProperties {

        private MeManagedProperties() {
        }

        public static final String BASE = "/me/managed-properties";

        public static final String BY_ID = BASE + "/{id}";

        /** Publish one record into the marketplace (creates a pending listing, links back). */
        public static final String PUBLISH = BASE + "/{id}/publish";
    }

    /**
     * Listing photo upload. Unscoped by property on purpose: in the create-listing wizard the
     * photos are chosen before the property exists, so there is nothing to scope to yet. Any
     * signed-in user may upload — the same stance as {@link MeDocuments}, since anyone becomes an
     * owner the moment they post a listing — and the returned CDN URL travels with the listing
     * through the normal create/update contract.
     */
    public static final class MePhotos {

        private MePhotos() {
        }

        public static final String BASE = "/me/photos";
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

        /**
         * The owner's "waiting on you" badge — a count, not a list.
         *
         * <p>Declared as a sibling of {@link #BASE} rather than a query parameter on it because it
         * answers a different question with a different shape. It exists because {@link #BASE} is
         * paged: the badge used to be a client-side filter over the whole inbox, which stops being
         * the right number the moment the inbox has a second page (tech-debt D78).
         *
         * <p>Ordered before {@link #BY_ID} in this class for readability only — Spring matches the
         * literal segment ahead of the {@code {reqId}} template regardless of declaration order, so
         * {@code pending-count} can never be parsed as a request id.
         */
        public static final String PENDING_COUNT = BASE + "/pending-count";

        /** {@code reqId}, not {@code id} — the contract's {@code ReqId} path parameter. */
        public static final String BY_ID = BASE + "/{reqId}";
    }

    /**
     * In-app buyer&lt;-&gt;owner chat. Opening a thread requires an approved contact request in one
     * direction or the other; see {@code ConversationService}.
     */
    public static final class Conversations {

        private Conversations() {
        }

        /** Authenticated — GET the caller's inbox, POST to open (or re-open) a thread. */
        public static final String BASE = "/messages";

        /** Participants only — one thread with its messages. A non-participant gets a 404. */
        public static final String BY_ID = BASE + "/{id}";

        /** Participants only — send a message. */
        public static final String REPLY = BY_ID + "/reply";

        /** Participants only — mark everything the caller did not write as read. */
        public static final String READ = BY_ID + "/read";
    }

    /** The customer's own support thread with the platform. Distinct from the ops board above. */
    public static final class SupportTickets {

        private SupportTickets() {
        }

        /** Authenticated — GET the caller's own tickets (spec fix S47), POST to raise one. */
        public static final String BASE = "/support/tickets";

        /** The raiser or ops — one ticket with its thread. */
        public static final String BY_ID = BASE + "/{id}";

        /** The raiser or ops — add a message. */
        public static final String MESSAGES = BY_ID + "/messages";

        /**
         * The raiser or ops — clear the caller's own unread flag, and only that one (D50, V53).
         * The platform-wide queue this feeds is {@link Admin#SUPPORT_TICKETS}.
         */
        public static final String READ = BY_ID + "/read";
    }

    /** The offer negotiation lifecycle: submit, respond, list mine, list on my listings. */
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

    /** The deal lifecycle: reserve, close, reopen, parties. Strictly owner-scoped. */
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

        /** Authenticated — remove a specific party. */
        public static final String PARTY_BY_ID = PARTIES + "/{partyId}";
    }

    /** The finalization maker/checker flow: buyer requests, owner accepts/declines. */
    public static final class Finalization {

        private Finalization() {
        }

        /** Authenticated — request finalization for a property (buyer, maker step). */
        public static final String REQUEST = "/finalization/{propId}/request";

        /** Authenticated — GET status / DELETE cancel (initiator). */
        public static final String STATUS = "/finalization/{propId}/status";

        /** Authenticated — requests awaiting the caller's decision (owner inbox). */
        public static final String ME_REQUESTS = "/me/finalization-requests";

        /** Authenticated — accept a finalization request (owner, checker step). */
        public static final String ACCEPT = "/finalization/requests/{reqId}/accept";

        /** Authenticated — decline a finalization request (owner). */
        public static final String DECLINE = "/finalization/requests/{reqId}/decline";
    }

    /** The visit lifecycle: schedule, list, update status, reschedule. Two surfaces, one entity (D3). */
    public static final class Visits {

        private Visits() {
        }

        /** Authenticated — visitor surface: list/schedule visits. */
        public static final String BASE = "/visits";

        /** Authenticated — owner surface: visit requests on my listings. */
        public static final String ME_REQUESTS = "/me/visit-requests";

        /** Authenticated — create a visit (owner-adjacent surface, same as POST /visits). */
        public static final String REQUEST_BASE = "/visit-requests";

        /** Authenticated — update visit status (confirm/cancel/complete/no-show). */
        public static final String STATUS = "/visit-requests/{id}/status";

        /** Authenticated — reschedule a live visit to a new slot; either participant may (D87). */
        public static final String SLOT = BASE + "/{id}/slot";
    }

    /** The caller's opt-in identity badge (L2). Absence never blocks anything (ADR-019). */
    public static final class Verification {

        private Verification() {
        }

        /** Authenticated — {@code GET} reads the badge, {@code POST} starts the DigiLocker flow. */
        public static final String AADHAAR = "/me/verification/aadhaar";

        /**
         * Authenticated, <strong>{@code dev} profile only</strong> ({@code @DevOnly}) — grants the
         * caller the badge by synthesizing a DigiLocker success, so the earned-badge state can be
         * demonstrated in http/dev mode where no real webhook ever arrives (D122).
         */
        public static final String AADHAAR_SIMULATE = AADHAAR + "/simulate";
    }

    /**
     * The owner's private property finance ledger (slice 5). Every route is {@code /me/**} and
     * strictly owner-scoped — a non-owner gets 404, not 403, because a 403 would confirm that a
     * property id belongs to someone else.
     */
    public static final class Finances {

        private Finances() {
        }

        /** Authenticated — the per-property ledger root. Not itself a route. */
        private static final String BASE = "/me/finances/{propId}";

        /** Authenticated — {@code GET} lists the ledger, {@code POST} records a row. */
        public static final String TRANSACTIONS = BASE + "/transactions";

        /** Authenticated — {@code PATCH} edits one row, {@code DELETE} soft-deletes it. */
        public static final String TRANSACTION_BY_ID = TRANSACTIONS + "/{txnId}";

        /** Authenticated — {@code GET}/{@code PUT} the purchase and valuation figures. */
        public static final String BASIS = BASE + "/basis";

        /** Authenticated — income/expense/net over a window. */
        public static final String SUMMARY = BASE + "/summary";

        /** Authenticated — monthly cashflow series. */
        public static final String CASHFLOW = BASE + "/cashflow";

        /** Authenticated — recurring rows projected to their next occurrence. */
        public static final String DUES = BASE + "/dues";
    }

    /**
     * Tenancies and tenant screening profiles (slice 5). Every read is participant-scoped; the
     * one mobile-keyed read is relationship-guarded and answers 404 for every refusal (spec fix
     * S10). There is no create route — a tenancy is only ever opened by closing a rent deal (S9).
     */
    public static final class Tenancies {

        private Tenancies() {
        }

        /** Authenticated — tenancies the caller holds as tenant. */
        public static final String MINE = "/me/tenancies";

        /** Authenticated — tenancies on the caller's listings. */
        public static final String OWNED = "/tenancies";

        /** Authenticated — {@code GET}/{@code PUT} the caller's own tenant profile. */
        public static final String MY_PROFILE = "/me/tenant-profile";

        /** Authenticated — an owner screening a tenant they have a relationship with. */
        public static final String PROFILE_BY_MOBILE = "/tenant-profiles/{mobile}";

        /**
         * Authenticated — the badge-only batch of {@link #PROFILE_BY_MOBILE} (D114).
         *
         * <p>{@code POST} because the input is a list of mobile numbers: a query string carrying
         * them would put the identifier the whole contact gate exists to protect into access logs,
         * proxy caches and browser history. No collision with {@link #PROFILE_BY_MOBILE} — that is
         * a {@code GET} and this is a {@code POST}, so the two never compete for a path pattern.
         */
        public static final String PROFILES_VERIFIED = "/tenant-profiles/verified";
    }

    /**
     * The rent money rail (slice 6) — payments, autopay mandates and the owner's payout account.
     *
     * <p>Every route is caller-scoped by participation in a tenancy: {@link #PAYMENTS} is the
     * tenant's side and {@link #LEDGER} the owner's side of the same rows. No role guard, because
     * the contract carries no {@code x-roles} — whether you are "the owner" is a fact about the
     * tenancy, not a claim in a token.
     */
    public static final class Rent {

        private Rent() {
        }

        /** Authenticated — {@code GET} the caller's payments, {@code POST} to pay rent. */
        public static final String PAYMENTS = "/me/rent-payments";

        /** Authenticated — rent received on the caller's listings. */
        public static final String LEDGER = "/me/rent-ledger";

        /** Authenticated — {@code GET}/{@code PUT} the caller's autopay mandate. */
        public static final String MANDATE = "/me/rent-mandate";

        /** Authenticated — {@code GET}/{@code PUT} where the caller's rent is settled to. */
        public static final String PAYOUT_ACCOUNT = "/me/payout-account";
    }

    /**
     * Engagement (slice 8) — the things a signed-in person accumulates: a shortlist, followed
     * societies, saved searches, notifications.
     *
     * <p>Every route here is {@code /me/**} or otherwise principal-scoped, so there is no
     * {@code x-roles} and no owner check: the caller <em>is</em> the scope. Nothing in this holder is
     * public, which is why none of it appears in the security chain's {@code permitAll} block —
     * "authenticated by default" is the rule these rely on.
     */
    public static final class Engagement {

        private Engagement() {
        }

        /** Authenticated — the caller's shortlist, as full property summaries. */
        public static final String SAVED = "/me/saved";

        /** Authenticated — {@code PUT} shortlists a property, {@code DELETE} removes it. Idempotent both ways. */
        public static final String SAVED_BY_PROPERTY = SAVED + "/{propId}";

        /** Authenticated — {@code PUT}/{@code DELETE} the caller's follow on one society. */
        public static final String SOCIETY_FOLLOW = "/me/societies/{slug}/follow";

        /** Authenticated — {@code GET} the caller's saved searches, {@code POST} to add one. */
        public static final String SAVED_SEARCHES = "/me/saved-searches";

        /** Authenticated — {@code DELETE} one saved search the caller owns. */
        public static final String SAVED_SEARCH_BY_ID = SAVED_SEARCHES + "/{id}";

        /** Authenticated — the caller's notifications, newest first, paged. */
        public static final String NOTIFICATIONS = "/notifications";

        /** Authenticated — marks the given ids read, or all of them when the body is absent. */
        public static final String NOTIFICATIONS_READ = NOTIFICATIONS + "/read";

        /** Authenticated — {@code DELETE} one notification the caller owns (dismiss). */
        public static final String NOTIFICATION_BY_ID = NOTIFICATIONS + "/{id}";
    }

    /**
     * The flatmates market.
     *
     * <p>Its own holder rather than more constants on {@link Engagement}, because it is the one part
     * of engagement with a route family of its own — everything else there hangs off {@code /me}.
     * One public read sits on a path that differs from two authenticated writes only by method and
     * suffix, so the security chain must name each individually: a path-prefix matcher would open
     * {@link #POST_INTEREST}, which releases a phone number.
     *
     * <p>Replaced the {@code /share-flat/*} family, retired in V28.
     */
    public static final class Flatmates {

        private Flatmates() {
        }

        /** {@code GET} public — the team-up supply. {@code POST} authenticated — advertise yourself. */
        public static final String POSTS = "/flatmates/posts";

        /** Authenticated — {@code PATCH} edits, {@code DELETE} takes down. Author-scoped. */
        public static final String POST_BY_ID = POSTS + "/{id}";

        /** Authenticated — answer an ad, releasing the <em>requester's</em> contact to the host. */
        public static final String POST_INTEREST = POST_BY_ID + "/interest";

        /** Authenticated — the caller's incoming requests (host inbox). */
        public static final String MY_REQUESTS = "/me/flatmate-requests";

        /** Authenticated — accept or decline one incoming request. Host-scoped. */
        public static final String MY_REQUEST_BY_ID = MY_REQUESTS + "/{id}";

        /**
         * Public — the tab-aware mixed feed, and the surface the consumer page actually renders.
         *
         * <p>{@code move-in} returns rooms plus groups that already hold an address; {@code team-up}
         * returns solo seeker posts plus address-less groups. Sorted as one list, because merging
         * two pre-sorted lists would stack every room above every group.
         */
        public static final String FEED = "/flatmates/feed";

        /** {@code GET} public — rooms. {@code POST} authenticated — offer a spare room. */
        public static final String ROOMS = "/flatmates/rooms";

        /** Authenticated — reopen or close a seat. Seat-model rooms only. */
        public static final String ROOM_SEATS = ROOMS + "/{id}/seats";

        /** Authenticated — record how many people live in a room. Owner-split rooms only. */
        public static final String ROOM_OCCUPANTS = ROOMS + "/{id}/occupants";

        /** Authenticated — a room changed hands, so the flat's joint agreement must be reissued. */
        public static final String ROOM_AGREEMENT_REISSUE = ROOMS + "/{id}/agreement/reissue";

        /** Authenticated — enquire about a room, carrying the share intent. */
        public static final String ROOM_INTEREST = ROOMS + "/{id}/interest";

        /** {@code GET} public — groups. {@code POST} authenticated — start one. */
        public static final String GROUPS = "/flatmates/groups";

        /** Authenticated — remove a group I created. */
        public static final String GROUP_BY_ID = GROUPS + "/{id}";

        /** Authenticated — reopen or close a group seat. */
        public static final String GROUP_SEATS = GROUP_BY_ID + "/seats";

        /** Authenticated — request, then confirm, the flat owner's OTP consent. */
        public static final String GROUP_OWNER_CONSENT = GROUP_BY_ID + "/owner-consent";

        /** Authenticated — ask to join. An open-policy group accepts outright. */
        public static final String GROUP_JOIN = GROUP_BY_ID + "/join";
    }

    /**
     * Reviews (slice 8). Two route families over one {@code reviews} table, and the contract keeps
     * them apart for us: {@link #FOR_ENTITY} declares {@code enum: [society, locality, owner]}, which
     * is disjoint from the property target {@link #FOR_PROPERTY} writes. They are not the same
     * resource — only a property review can carry a visit/tenancy badge — so they get two controllers.
     *
     * <p>Both reads are {@code security: []}: reviews are what an anonymous visitor is weighing up
     * before they will consider signing up. Both writes are authenticated, because an unattributable
     * review is not evidence of anything.
     */
    public static final class Reviews {

        private Reviews() {
        }

        /**
         * {@code GET} public, {@code POST} authenticated — reviews of one listing.
         *
         * <p>Spelled out rather than composed from {@link Properties#BY_ID}, which is
         * {@code /properties/&#123;id&#125;}: the contract names this variable {@code propId}, and a
         * URI template's variable names are part of what the controller binds to. Composing would
         * match the same requests while quietly disagreeing with the spec.
         */
        public static final String FOR_PROPERTY = "/properties/{propId}/reviews";

        /**
         * {@code GET} public — the server-computed rating summary for one listing (D79).
         *
         * <p>A sibling of {@link #FOR_PROPERTY} rather than a field on it: the list is unpaged by
         * ruling D8.6 and stays that way, so this adds the aggregate without touching the array's
         * shape or anything reading it.
         */
        public static final String SUMMARY_FOR_PROPERTY = FOR_PROPERTY + "/summary";

        /** {@code GET} public, {@code POST} authenticated — reviews of a society, locality or owner. */
        public static final String FOR_ENTITY = "/reviews/{entityType}/{entityId}";

        /**
         * {@code GET} public — the server-computed rating summary for a society, locality or owner.
         *
         * <p>One route for all three rather than three bespoke ones, because nothing below this line
         * distinguishes them: {@code ReviewTargetKey} already turns {@code (entityType, entityId)}
         * into the single canonical {@code target_id} the table stores, and the aggregate queries
         * take {@code target_type} as a parameter. Three routes would be three spellings of one
         * query, and the fourth entity type would be a fourth.
         *
         * <p>The property summary stays on its own path ({@link #SUMMARY_FOR_PROPERTY}) for the same
         * reason the property list does: {@code entityType} is declared
         * {@code enum: [society, locality, owner]} in the contract, disjoint from {@code property},
         * and only a property review carries an evidenced badge.
         */
        public static final String SUMMARY_FOR_ENTITY = FOR_ENTITY + "/summary";
    }

    /**
     * Editorial content (slice 8) — announcements, the services directory, FAQs and banners.
     *
     * <p>All four are public reads of admin-curated rows. They are grouped because they share one
     * property that drives the whole implementation: each is a small, hand-maintained list that the
     * marketing surface renders in full, so none of them is paged (api-standards.md §5.1 — the test
     * is growth, and an editor is the growth limit).
     */
    public static final class Content {

        private Content() {
        }

        /** Public — active announcements, the banner strip at the top of the app. */
        public static final String ANNOUNCEMENTS = "/announcements";

        /** Public — the paid-services directory (packers, painters, legal). */
        public static final String SERVICES = "/services";

        /** Public — frequently asked questions, grouped by category. */
        public static final String FAQS = "/faqs";

        /** Public — promotional banners by placement slot. */
        public static final String BANNERS = "/banners";
    }

    /**
     * Documents, sharing and agreements (slice 10) — the paperwork half of a deal.
     *
     * <p><strong>Route-shape hazard worth stating once.</strong> {@link MeDocuments#REQUESTS} sits
     * at {@code /me/documents/requests}, directly under the {@code {propId}} template of
     * {@link MeDocuments#FOR_PROPERTY}. Both patterns match that URI; Spring's
     * {@code PathPattern} comparator ranks the literal segment above the variable, so the inbox
     * wins and a property can never be called {@code requests}. That is the contract's shape, not
     * ours — but it is a resolution rule doing load-bearing work, so
     * {@code DocumentRequestFlowTest} pins it rather than trusting it.
     */
    public static final class MeDocuments {

        private MeDocuments() {
        }

        private static final String BASE = "/me/documents";

        /** Owner — the document vault for one of their listings (list + upload). */
        public static final String FOR_PROPERTY = BASE + "/{propId}";

        /** Owner — remove one document from that vault. */
        public static final String BY_ID = BASE + "/{propId}/{docId}";

        /**
         * The caller's own KYC papers (list + upload) — Aadhaar, PAN, a passport photo. A literal
         * segment, so like {@link #REQUESTS} it ranks above the {@code {propId}} template and a
         * property can never be called {@code personal}; that ordering is what routes these URIs to
         * the personal handlers rather than the vault, and {@code PersonalDocumentFlowTest} pins it.
         */
        public static final String PERSONAL = BASE + "/personal";

        /** Owner — remove one of their personal documents. */
        public static final String PERSONAL_BY_ID = PERSONAL + "/{docId}";

        /** Owner — the inbox of buyer access requests across all their listings. */
        public static final String REQUESTS = BASE + "/requests";

        /** Owner — grant or decline one request. */
        public static final String REQUEST_BY_ID = REQUESTS + "/{reqId}";
    }

    /** The buyer/anonymous side of documents: asking for access, and reading a granted share. */
    public static final class Documents {

        private Documents() {
        }

        private static final String BASE = "/documents";

        /** Buyer — ask the owner for access to a listing's documents. */
        public static final String REQUESTS = BASE + "/requests";

        /**
         * Public but token-scoped — read the documents a grant unlocked. Anonymous by contract
         * ({@code security: []}) because the share link is forwarded to a lawyer or a banker who
         * has no PuneNest account; the unguessable, expiring token is the credential.
         */
        public static final String SHARED = BASE + "/shared";
    }

    /** Owner — the Leave &amp; License agreement records for their properties. */
    public static final class MeRentAgreements {

        private MeRentAgreements() {
        }

        public static final String BASE = "/me/rent-agreements";
    }

    /** Owner — their own KYC record. Singular: one per user, so no id anywhere in the shape. */
    public static final class MeOwnerKyc {

        private MeOwnerKyc() {
        }

        public static final String BASE = "/me/owner-kyc";
    }

    /**
     * Service requests (slice 11) — the assisted-service workflow: a customer asks for a rent
     * agreement or a legal opinion, ops does the work, and a draft goes back for approval.
     *
     * <p><strong>Two audiences on one resource.</strong> {@link #BASE} and {@link #BY_ID} are
     * customer-facing and caller-scoped; {@link #STATUS}, {@link #DRAFT} and {@link #FINAL_DOC} are
     * staff-only; {@link #DRAFT_DECISION} is the customer's alone. That last one is the
     * maker-checker hinge — staff propose the draft, and only the person who asked for the work
     * may accept it — so it is guarded by participant identity rather than by role.
     */
    public static final class ServiceRequests {

        private ServiceRequests() {
        }

        /** Customer — their own requests; staff/admin — the whole queue (spec fix S40). */
        public static final String BASE = "/service-requests";

        /** Customer or staff — one request with its timeline, documents and messages. */
        public static final String BY_ID = BASE + "/{id}";

        /** Staff/admin — drive the workflow. */
        public static final String STATUS = BY_ID + "/status";

        /** Customer or staff — the conversation on the request. */
        public static final String MESSAGES = BY_ID + "/messages";

        /** Customer or staff — attach a document to the request. */
        public static final String DOCS = BY_ID + "/docs";

        /**
         * The parties' PAN and Aadhaar (D151) — <strong>written by the requester, read only by the
         * staff member the request is assigned to</strong>.
         *
         * <p>The narrowest route on this resource, and the only one whose read guard is neither a
         * role nor "the requester" but a specific person. A Leave &amp; License prints these numbers,
         * so the drafting desk needs them; {@code details} used to carry them and echoed them to
         * every staff read of the queue, which is why they now have a route of their own instead of
         * a field on {@link #BY_ID}.
         */
        public static final String IDENTITIES = BY_ID + "/identities";

        /** Staff/admin — the maker: share a draft for approval (spec fix S41). */
        public static final String DRAFT = BY_ID + "/draft";

        /** The requesting customer only — the checker: approve or send it back. */
        public static final String DRAFT_DECISION = DRAFT + "/decision";

        /** Staff/admin — the registered copy; uploading it completes the request. */
        public static final String FINAL_DOC = BY_ID + "/final-doc";
    }

    /**
     * Billing catalogue and subscriptions (slice 13). {@link #BASE} is public — the price list is
     * published before the sign-up wall, exactly like {@link Fees}.
     */
    public static final class Plans {

        private Plans() {
        }

        /** Public — the plan catalogue. */
        public static final String BASE = "/plans";

        /** Authenticated — {@code GET} the caller's current plan, {@code POST} to change it. */
        public static final String SUBSCRIPTION = "/me/subscription";
    }

    /** Listing merchandising a seller can buy (slice 13). The pack list is public. */
    public static final class Boosts {

        private Boosts() {
        }

        /** Public — the boost pack catalogue. */
        public static final String PACKS = "/boost-packs";

        /**
         * The listing owner only — buy a boost for one of their properties.
         *
         * <p>{@code propId}, not {@code id} — the contract's {@code PropId} path parameter, and it
         * accepts a UUID or a slug.
         */
        public static final String LISTING = "/me/properties/{propId}/boost";
    }

    /**
     * The services marketplace (slice 13) — packers, interiors, legal, loans. The catalogue is
     * public; orders are caller-scoped.
     *
     * <p>Distinct from {@link ServiceRequests}: that is the fulfilment workflow staff drive, this is
     * the storefront a customer buys from.
     */
    public static final class ServiceCatalog {

        private ServiceCatalog() {
        }

        /** Public — the offering catalogue. */
        public static final String BASE = "/service-catalog";

        /** Authenticated — {@code GET} the caller's orders, {@code POST} to place one. */
        public static final String ORDERS = "/me/service-orders";

        /** One of the caller's own orders. Not served on its own; the two verbs below hang off it. */
        public static final String ORDER = ORDERS + "/{id}";

        /**
         * The customer's decision on a quote (D58). Theirs alone — ops sets the price, the customer
         * agrees to it, and {@link #ORDER_STATUS} cannot reach {@code scheduled}.
         */
        public static final String ORDER_ACCEPT = ORDER + "/accept";

        /** The customer calling the job off, any time before work starts (D58). */
        public static final String ORDER_CANCEL = ORDER + "/cancel";

        /**
         * Staff/admin — quote an order and drive it to completion (D58).
         *
         * <p>Off {@code /service-orders} rather than {@code /me/service-orders}: the desk is acting
         * on somebody else's order, and hanging an ops verb off a {@code /me/} path would make the
         * one place in this API where {@code /me/} does not mean "the caller's own".
         */
        public static final String ORDER_STATUS = "/service-orders/{id}/status";
    }

    /**
     * The referral scheme (slice 13).
     *
     * <p>Two audiences. {@link #MINE} and {@link #REDEEM} belong to any signed-in user; {@link #BASE}
     * and the three decisions are the fraud desk's and carry {@code x-roles: [staff, admin]} (spec
     * fix S53).
     */
    public static final class Referrals {

        private Referrals() {
        }

        /** Staff/admin — the review queue. */
        public static final String BASE = "/referrals";

        /** Authenticated — the caller's own code and rewards. */
        public static final String MINE = "/me/referrals";

        /** Authenticated — redeem someone else's code. */
        public static final String REDEEM = BASE + "/redeem";

        /** Staff/admin — the checker releases the reward. */
        public static final String APPROVE = BASE + "/{id}/approve";

        /** Staff/admin — the checker refuses it. */
        public static final String REJECT = BASE + "/{id}/reject";

        /** Staff/admin — reverse a reward already released. */
        public static final String CLAWBACK = BASE + "/{id}/clawback";
    }

    /**
     * The ops ticket board (slice 11). Team-scoped work items — the lightweight queue beside the
     * {@link ServiceRequests} workflow.
     *
     * <p>{@code POST} carries no {@code x-roles} on purpose (S43): a customer raising a request is
     * the point of the queue, exactly as with {@link Moderation#REPORTS}. Reading and working the
     * board are staff/admin, and the read is additionally narrowed to the caller's own team.
     */
    public static final class Tickets {

        private Tickets() {
        }

        public static final String BASE = "/tickets";

        /** Staff/admin — status, priority, assignment, team. */
        public static final String BY_ID = BASE + "/{id}";

        /** Staff/admin — append an internal note. Never editable, never deleted. */
        public static final String NOTES = BY_ID + "/notes";
    }

    /**
     * Trust &amp; safety and the back-office (slice 9) — the platform's first admin trust boundary.
     *
     * <p>Every route here except {@link Moderation#REPORTS} (which any signed-in user must be able
     * to POST to — that is the point of an abuse queue) carries {@code x-roles} in the contract and
     * is guarded with {@code @PreAuthorize} on the controller method, per api-standards.md §6.
     *
     * <p>The property-moderation and verification paths deliberately hang off
     * {@link Properties#BY_ID} rather than living under an {@code /admin} prefix: that is what the
     * contract specifies, and it means {@link Properties#ANY_SINGLE} — the single-segment
     * {@code permitAll} matcher for the public listing read — cannot sweep them into the public
     * allowlist, because every one of them is at least one segment deeper.
     */
    public static final class Moderation {

        private Moderation() {
        }

        /** Staff/admin — approve or reject a listing. */
        public static final String PROPERTY_STATUS = Properties.BY_ID + "/status";

        /** Staff/admin — toggle homepage merchandising. */
        public static final String PROPERTY_FEATURED = Properties.BY_ID + "/toggle-featured";

        /**
         * Staff/admin — raise (POST) or clear (DELETE) a moderation flag. One path, two methods,
         * so the mappings must be method-level or the two would collide.
         */
        public static final String PROPERTY_FLAG = Properties.BY_ID + "/flag";

        /** Staff/admin — correct another user's listing in place. */
        public static final String PROPERTY_ADMIN_UPDATE = Properties.BY_ID + "/admin";

        /**
         * Authenticated, participant-scoped — the owner&lt;-&gt;ops clarification thread. No
         * {@code x-roles}: the owner is a participant, so role-gating it would lock them out of
         * their own review.
         */
        public static final String PROPERTY_VERIFICATION = Properties.BY_ID + "/verification";

        /** Authenticated, participant-scoped — post to the thread. */
        public static final String VERIFICATION_MESSAGES = PROPERTY_VERIFICATION + "/messages";

        /** Authenticated, participant-scoped — mark the caller's own side of the thread read. */
        public static final String VERIFICATION_READ = PROPERTY_VERIFICATION + "/read";

        /** Staff/admin — the checker half of the maker-checker listing review. */
        public static final String VERIFICATION_DECISION = PROPERTY_VERIFICATION + "/decision";

        /** Staff/admin — list verification case files (D91). */
        public static final String ADMIN_PROPERTY_REVIEWS = "/admin/property-reviews";

        /**
         * POST is open to any signed-in user (file a report); GET is staff/admin (read the queue).
         * The asymmetry is the whole design of an abuse queue and is enforced per-method.
         */
        public static final String REPORTS = "/reports";

        /** Staff/admin — triage one report (spec fix S30). */
        public static final String REPORT_BY_ID = REPORTS + "/{id}";

        /** Staff/admin — take a review down or restore it (spec fix S31). */
        public static final String REVIEW_STATUS = "/reviews/{id}/status";

        /**
         * Staff/admin — the review moderation queue.
         *
         * <p>Added because {@link #REVIEW_STATUS} shipped without it: the platform could act on a
         * review but had no way to <em>find</em> one. Reviews are post-moderated (published on
         * write), and every public read filters to {@code published}, so a moderator's only route to
         * a reported review was the report itself — and nothing listed reviews by status at all.
         *
         * <p>Deliberately {@code /admin/reviews} rather than a {@code GET /reviews}: the public
         * review routes are {@code /reviews/{entityType}/{entityId}} and adding a collection read at
         * the family root would put a staff-only, all-statuses list one path segment away from an
         * anonymous one. Distance in the URL space is worth having here.
         */
        public static final String ADMIN_REVIEWS = "/admin/reviews";

        /**
         * Staff/admin — the listing moderation queue.
         *
         * <p>Added for exactly the reason {@link #ADMIN_REVIEWS} was, and the omission was worse
         * here: {@link #PROPERTY_STATUS}, {@link #PROPERTY_FEATURED} and {@link #PROPERTY_FLAG} all
         * shipped with no read that could find a listing to act on. {@code GET /properties} pins
         * {@code status = 'approved' AND archived = false} unconditionally — it takes no principal,
         * so it cannot relax for staff — and {@code GET /me/listings} is scoped to the caller's own
         * {@code owner_id}. Between them there was no way to enumerate the pending backlog, which is
         * the one list a verification queue exists to show.
         *
         * <p>Deliberately {@code /admin/properties} rather than widening {@code GET /properties} for
         * staff: the public search is opened by path in {@code SecurityConfig}, so a role branch
         * inside it would put the unapproved catalogue behind a runtime {@code if} on an endpoint
         * whose matcher says {@code permitAll}. A separate path keeps the authorization decision
         * where it can be read off the routing table.
         */
        public static final String ADMIN_PROPERTIES = "/admin/properties";

        /**
         * Ops — the flatmate host-verification queue.
         *
         * <p>Tenant-tier posts and contested addresses only. Owner-tier posts never appear: they
         * were vetted through the parent listing's own documents, so reviewing them again is
         * theatre that costs Ops real time.
         */
        public static final String FLATMATE_REVIEWS = "/admin/flatmate-reviews";

        /** Ops — decide one host verification. A rejection must carry a reason. */
        public static final String FLATMATE_REVIEW_BY_ID = FLATMATE_REVIEWS + "/{id}";

        /**
         * Admin — the moderation axis on any flatmate post, room or group.
         *
         * <p>Strictly the moderation axis: it must never write a group application's <em>owner</em>
         * decision, which belongs to the host and means something different.
         */
        public static final String FLATMATE_MODERATION = "/admin/flatmates/{id}/moderation";

        /**
         * Admin — the flatmate moderation queue: what is waiting to be let out (D72).
         *
         * <p>Since D72 a seeker post, room or group starts {@code pending} and is invisible until a
         * moderator says otherwise. That rule is only honest if there is somewhere to see the
         * backlog; without this route "moderate before public" would mean "never public".
         *
         * <p>Separate from {@link #FLATMATE_REVIEWS}, which is the <em>verification</em> queue —
         * "has this host proved what they claimed" — and answers a different question about a
         * different table. Collapsing them would make an unbadged post look like an unvetted one.
         *
         * <p>The caller names one {@code kind} per request rather than getting a merged board.
         * Posts, rooms and groups live in three tables with three shapes; a union would have to
         * page across all three, which cannot be done without either loading everything or lying
         * about the total.
         */
        public static final String FLATMATE_MODERATION_QUEUE = "/admin/flatmates/moderation";

        /** Admin — flatmate group applications to owners' listings. */
        public static final String GROUP_APPLICATIONS = "/admin/group-applications";

        /** Admin — moderate one group application. */
        public static final String GROUP_APPLICATION_BY_ID = GROUP_APPLICATIONS + "/{id}";
    }

    /**
     * User administration (slice 9). Distinct from {@link Auth#ME}, which is the caller's own
     * profile: everything here acts on <em>somebody else's</em> account.
     *
     * <p>Reads are staff/admin (ops must be able to look a caller up); writes are admin-only. The
     * sharpest of them is {@link #STAFF} — the operation that mints an account with a privileged
     * role, and therefore the one endpoint on the platform that can manufacture an attacker.
     */
    public static final class Users {

        private Users() {
        }

        /** Staff/admin — paged directory. Mobile is masked here; the detail read reveals it. */
        public static final String BASE = "/users";

        /**
         * Staff/admin — one user, with the contact detail ops needs to act. Declared after
         * {@link #STAFF} in the contract but matched by Spring on method + shape, so the literal
         * {@code /users/staff} POST cannot be swallowed by this pattern.
         */
        public static final String BY_ID = BASE + "/{id}";

        /** Admin — suspend an account (soft; never a hard delete). */
        public static final String ARCHIVE = BY_ID + "/archive";

        /** Admin — reinstate a suspended account. */
        public static final String RESTORE = BY_ID + "/restore";

        /** Admin only — create a staff/admin account. The privilege-escalation surface. */
        public static final String STAFF = BASE + "/staff";
    }

    /** The back-office: the ops dashboard, platform configuration, CMS authoring and the audit read. */
    public static final class Admin {

        private Admin() {
        }

        /**
         * Admin only — the append-only record of privileged actions. Deliberately not staff-visible:
         * the log exists to hold privileged users to account, and a reader who can also act is a
         * reader with a motive to check whether they were noticed.
         */
        public static final String AUDIT_LOG = "/admin/audit-log";

        /** Staff/admin — the KPI scorecard. Revenue is blanked for staff; see {@code AdminKpis}. */
        public static final String DASHBOARD = "/admin/dashboard";

        /** Staff/admin — one metric, bucketed over a date range. */
        public static final String ANALYTICS = "/admin/analytics";

        /**
         * Staff/admin — the platform-wide support queue, paged (D51).
         *
         * <p>Lives here rather than as a role branch inside {@code GET /support/tickets}, which is
         * the caller's own tickets for everybody (S47). One operation cannot be a bare array for a
         * customer and a page envelope for an admin, and "every support conversation on the
         * platform" unpaged is a PII export whichever role asks for it.
         */
        public static final String SUPPORT_TICKETS = "/admin/support-tickets";

        /**
         * Admin only — revenue, liabilities and the revenue split.
         *
         * <p>One rung above {@link #DASHBOARD} deliberately: ops needs listing and user counts to do
         * its job and does not need to know what the platform earns.
         */
        public static final String FINANCE = "/admin/finance";

        /** Admin only — the platform configuration document. GET reads it, PUT merges into it. */
        public static final String SETTINGS = "/admin/settings";

        /**
         * Staff/admin — CMS rows of one type. {@code {type}} is the discriminator across the four
         * managed tables (announcements, services, faqs, banners).
         */
        public static final String CONTENT = "/admin/content/{type}";

        /** Staff/admin — one CMS row. */
        public static final String CONTENT_ITEM = CONTENT + "/{id}";

        /** Staff/admin — soft-delete a CMS row; it disappears from the public read. */
        public static final String CONTENT_ARCHIVE = CONTENT_ITEM + "/archive";

        /** Staff/admin — undo an archive. */
        public static final String CONTENT_RESTORE = CONTENT_ITEM + "/restore";
    }

    /**
     * The B2B pipeline: a society or builder asking to be onboarded in bulk.
     *
     * <p>Not under {@code /admin} because the submit is public by contract — the person filling the
     * form is a building secretary who has never signed in, and requiring an account before the
     * platform will hear from a 400-flat society defeats the point of the form.
     */
    public static final class SocietyLeads {

        private SocietyLeads() {
        }

        /** POST is public and rate-limited per mobile; GET is staff/admin and paged. */
        public static final String BASE = "/society-leads";

        /** Staff/admin — work the pipeline. */
        public static final String BY_ID = BASE + "/{id}";
    }

    /** Server-to-server callbacks. Unauthenticated by contract ({@code security: []}) — a webhook
     *  carries no user session; its authenticity comes from an HMAC signature over the raw body,
     *  which is verified in the handler, not by the filter chain. */
    public static final class Webhooks {

        private Webhooks() {
        }

        /** Public — Cashfree/DigiLocker verification result. Signature-verified, idempotent, always 200. */
        public static final String CASHFREE_DIGILOCKER = "/webhooks/cashfree/digilocker";

        /** Public — Cashfree payment result. Signature-verified, deduped on order id, always 200. */
        public static final String CASHFREE_PAYMENT = "/webhooks/cashfree/payment";
    }
}
