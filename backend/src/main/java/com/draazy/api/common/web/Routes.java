package com.draazy.api.common.web;

/**
 * The canonical URI of every HTTP route. One constant binds the controller mapping and the {@code
 * SecurityConfig} matcher, so public-vs-guarded cannot drift. Rules: docs/system/api-standards.md §7.2.
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

        /**
         * Public — a colleague redeems their single-use invite and sets a password. Unauthenticated because
         * the expiring single-use token is itself the credential (checked in StaffInviteService).
         */
        public static final String STAFF_INVITE_REDEEM = "/auth/staff-invite/redeem";

        /** Authenticated — revokes the caller's refresh-token family. */
        public static final String LOGOUT = "/auth/logout";

        /**
         * Authenticated — the caller's own profile. Sits under {@code /auth} per the contract, so the
         * controller lives in the {@code user} package.
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

        /**
         * Public — how much of the live catalogue is verified, optionally for one locality. Safe beside
         * {@link #BY_ID} because an exact path outranks a template one.
         */
        public static final String TRUST_STATS = BASE + "/trust-stats";

        /** Public — single listing by slug or id. */
        public static final String BY_ID = BASE + "/{id}";

        /**
         * Security-chain matcher for the public single-listing read. Single-segment ({@code *}) so deeper
         * write routes such as {@link #ARCHIVE} stay authenticated.
         */
        public static final String ANY_SINGLE = BASE + "/*";

        /** Authenticated — soft-delete (never a hard delete). */
        public static final String ARCHIVE = BY_ID + "/archive";

        /** Authenticated — undo an archive; the listing returns to moderation. */
        public static final String RESTORE = BY_ID + "/restore";

        /**
         * Owner-only — {@code POST} lets this flat room by room, {@code DELETE} withdraws that. Lives here,
         * not under {@code /flatmates}, because the resource acted on is the listing.
         */
        public static final String SPLIT = BY_ID + "/split";

        /**
         * Public — the rooms this flat was split into, plus its occupancy ledger. Deeper than {@link
         * #ANY_SINGLE} matches, so it needs its own public-allowlist entry.
         */
        public static final String ROOMS = BY_ID + "/rooms";
    }

    /**
     * The public seller card: who is behind a listing. Deliberately not under {@link Users} — that family is
     * the staff directory, and this one is capped to what a stranger may know.
     */
    public static final class Owners {

        private Owners() {
        }

        /**
         * Public — one owner's profile card. There is deliberately no collection read: a public {@code GET
         * /owners} would be a downloadable list of the platform's landlords.
         */
        public static final String BY_ID = "/owners/{id}";

        /**
         * Security-chain matcher. Single-segment on purpose: there is no deeper owner route, and a {@code **}
         * would make one public before anybody had decided it should be.
         */
        public static final String ANY_SINGLE = "/owners/*";
    }

    /**
     * The public reference catalogue: cities, localities, societies, reels and the fee schedule. Every route
     * below is {@code security: []} — the pages a visitor sees before deciding to sign up.
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
         * Security-chain matcher for the whole family. Single-segment ({@code *}) on purpose: a {@code **}
         * here would silently make any future deeper locality route public.
         */
        public static final String ANY_SINGLE = BASE + "/*";

        /**
         * Staff — the curation console. Under {@code /admin} so the public matcher above stays one statement:
         * everything under {@code /localities} is readable, nothing under it is writable.
         */
        public static final String ADMIN_BASE = "/admin/localities";

        /** Staff — edit or retire one locality. */
        public static final String ADMIN_BY_SLUG = ADMIN_BASE + "/{slug}";
    }

    /**
     * Staff — the listings the resolver could not place, and the assignment that clears one (register item
     * 24).
     */
    public static final class LocalityQueue {

        private LocalityQueue() {
        }

        public static final String BASE = "/admin/locality-queue";

        /** Staff — give one listing the locality the resolver could not find. */
        public static final String BY_PROPERTY = BASE + "/{propertyId}";
    }

    /** Public — housing societies, browsable and individually addressable. */
    public static final class Societies {

        private Societies() {
        }

        /** Public — paged, filterable society directory. */
        public static final String BASE = "/societies";

        /** Public — one society with its homes and community aggregates. */
        public static final String BY_SLUG = BASE + "/{slug}";

        /**
         * Public — where the caller stands in this society: their residency, whether they are the committee,
         * the society's live claim, and how many residents are verified.
         */
        public static final String MEMBERSHIP = BY_SLUG + "/membership";

        /** Authenticated — {@code POST} asks to be recognised as a resident of one flat. */
        public static final String RESIDENTS = BY_SLUG + "/residents";

        /** Committee or staff — {@code GET} the residency queue for this society. */
        public static final String RESIDENTS_QUEUE = RESIDENTS;

        /** Committee or staff — {@code PATCH} verifies or rejects one residency request. */
        public static final String RESIDENT_BY_ID = RESIDENTS + "/{residentId}";

        /** Authenticated — {@code POST} claims this society on behalf of its committee. */
        public static final String CLAIM = BY_SLUG + "/claim";

        /** Public {@code GET}, authenticated {@code POST} — questions asked about this society. */
        public static final String QUESTIONS = BY_SLUG + "/questions";

        /** Authenticated — {@code POST} answers one question. */
        public static final String ANSWERS = QUESTIONS + "/{questionId}/answers";

        /** Public {@code GET}, resident/committee {@code POST} — the society noticeboard. */
        public static final String BOARD = BY_SLUG + "/board";

        /** Author, committee or staff — {@code DELETE} takes one item down. */
        public static final String BOARD_ITEM = BOARD + "/{itemId}";

        /**
         * Public {@code GET}, authenticated {@code POST} — the community tab's tips, trusted picks and
         * photos.
         */
        public static final String CONTRIBUTIONS = BY_SLUG + "/contributions";

        /** Author, committee or staff — {@code DELETE} removes one contribution. */
        public static final String CONTRIBUTION = CONTRIBUTIONS + "/{contributionId}";

        /** Authenticated — {@code PUT} marks a contribution helpful, {@code DELETE} unmarks it. */
        public static final String CONTRIBUTION_HELPFUL = CONTRIBUTION + "/helpful";

        /** Authenticated — {@code POST} replies in the thread under a contribution. */
        public static final String CONTRIBUTION_REPLIES = CONTRIBUTION + "/replies";

        /** Reply author, committee or staff — {@code DELETE} removes one reply. */
        public static final String CONTRIBUTION_REPLY = CONTRIBUTION_REPLIES + "/{replyId}";

        /** Public {@code GET}, authenticated {@code POST} — what the community says this society is. */
        public static final String PROPOSALS = BY_SLUG + "/proposals";

        /** Security-chain matcher; single-segment for the same reason as {@link Localities#ANY_SINGLE}. */
        public static final String ANY_SINGLE = BASE + "/*";
    }

    /** Staff — the society claim queue. */
    public static final class SocietyClaims {

        private SocietyClaims() {
        }

        /** Staff — the pipeline of committees asking to run their own page, oldest first. */
        public static final String BASE = "/admin/society-claims";

        /** Staff — {@code PATCH} approves or rejects one claim. */
        public static final String BY_ID = BASE + "/{id}";

        /** Staff — {@code GET} mints one short-lived link to this claim's registration certificate. */
        public static final String CERTIFICATE = BY_ID + "/certificate";
    }

    /** Staff — the community-proposal queue: society details, WhatsApp invites, corrected pins. */
    public static final class SocietyProposals {

        private SocietyProposals() {
        }

        /** Staff — everything the community has proposed, oldest first, filterable by kind. */
        public static final String BASE = "/admin/society-proposals";

        /** Staff — {@code PATCH} approves or rejects one, applying it to the society on approval. */
        public static final String BY_ID = BASE + "/{id}";
    }

    /** Staff — the queue of societies members added because the catalogue did not have them. */
    public static final class SocietyCandidates {

        private SocietyCandidates() {
        }

        /** Staff — member-added societies nobody has checked yet, oldest first. */
        public static final String BASE = "/admin/society-candidates";

        /** Staff — {@code POST} confirms one is real. */
        public static final String VERIFY = BASE + "/{slug}/verify";

        /** Staff — societies this candidate may be a second copy of, strongest match first. */
        public static final String DUPLICATES = BASE + "/{slug}/duplicates";
    }

    /** Staff — every society's residency queue at once. */
    public static final class SocietyResidents {

        private SocietyResidents() {
        }

        /** Staff — residency requests across every society, oldest first, filterable by status. */
        public static final String BASE = "/admin/society-residents";
    }

    /** Staff — the duplicate societies that have been folded into the ones that survive them. */
    public static final class SocietyMerges {

        private SocietyMerges() {
        }

        /** Staff — {@code GET} lists every merge in force, newest first; {@code POST} records one. */
        public static final String BASE = "/admin/society-merges";

        /**
         * Staff — {@code DELETE} undoes one merge, addressed by the slug of the society that was merged away.
         */
        public static final String BY_SLUG = BASE + "/{slug}";
    }

    /** Staff — correcting one society's own facts. */
    public static final class AdminSocieties {

        private AdminSocieties() {
        }

        /**
         * Staff — {@code PATCH} corrects registration, conveyance, maintenance, claim status and the internal
         * note on one society.
         */
        public static final String BY_SLUG = "/admin/societies/{slug}";
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

    /** Public — which product features the client should render. */
    public static final class Flags {

        private Flags() {
        }

        public static final String BASE = "/flags";
    }

    /** Public — the Move-in Pack's launch state and its price list. */
    public static final class MovePack {

        private MovePack() {
        }

        public static final String BASE = "/move-pack";
    }

    /** Public — what Draazy charges for its own products. */
    public static final class Pricing {

        private Pricing() {
        }

        public static final String BASE = "/pricing";
    }

    /** Public — where the platform operates, and which places it will not suggest. */
    public static final class Geo {

        private Geo() {
        }

        public static final String BASE = "/geo";
    }

    /** The authenticated owner's own listings. */
    public static final class MeListings {

        private MeListings() {
        }

        public static final String BASE = "/me/listings";

        public static final String BY_ID = BASE + "/{id}";

        /** Owner-only — "yes, this is still available", the anti-staleness heartbeat. */
        public static final String CONFIRM_AVAILABLE = BY_ID + "/confirm-available";

        /** Owner-only — "have I already listed this?", asked before the wizard submits. */
        public static final String DUPLICATE_CHECK = BASE + "/duplicate-check";
    }

    /**
     * The authenticated owner's private "single-player" property records — the Owner Hub / Property Passport
     * / rent tracker.
     */
    public static final class MeManagedProperties {

        private MeManagedProperties() {
        }

        public static final String BASE = "/me/managed-properties";

        public static final String BY_ID = BASE + "/{id}";

        /** Publish one record into the marketplace (creates a pending listing, links back). */
        public static final String PUBLISH = BASE + "/{id}/publish";

        /**
         * Rent the owner recorded as received outside Draazy's payment rail — {@code GET} the recent ledger,
         * {@code POST} to record one month.
         */
        public static final String RENT_RECEIPTS = BY_ID + "/rent-receipts";
    }

    /**
     * Listing photo upload. Unscoped by property on purpose: in the create-listing wizard the photos are
     * chosen before the property exists, so there is nothing to scope to yet.
     */
    public static final class MePhotos {

        private MePhotos() {
        }

        public static final String BASE = "/me/photos";
    }

    /** The "request more photos" demand signal — a buyer's side. */
    public static final class PropertyPhotoRequests {

        private PropertyPhotoRequests() {
        }

        /** Authenticated. Sign-in is the whole gate — no badge, no quota; see {@code PhotoRequestService}. */
        public static final String BASE = Properties.BY_ID + "/photo-requests";
    }

    /**
     * The listing owner's side of the photo-request signal. Strictly owner-scoped, like {@link
     * MeContactRequests}.
     */
    public static final class MePhotoRequests {

        private MePhotoRequests() {
        }

        public static final String BASE = "/me/photo-requests";

        /**
         * The owner's "buyers want more photos" badge — a count, not a list, because {@link #BASE} is
         * paged and a badge derived from one page is wrong as soon as there are two.
         */
        public static final String PENDING_COUNT = BASE + "/pending-count";

        /** {@code reqId}, mirroring {@link MeContactRequests#BY_ID}. */
        public static final String BY_ID = BASE + "/{reqId}";
    }

    /**
     * The owner's private annotations on their own leads — a note and a follow-up date, never seen by the
     * buyer and never joined into a buyer-facing payload.
     */
    public static final class MeLeadNotes {

        private MeLeadNotes() {
        }

        /** Authenticated. {@code GET} returns every note the caller owns; the inbox indexes them by key. */
        public static final String BASE = "/me/lead-notes";

        /**
         * {@code PUT} upserts, and clears when the body is empty — there is no {@code DELETE}, because there
         * is no path through the UI that reaches one.
         */
        public static final String BY_KEY = BASE + "/{leadKey}";
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

        /** The owner's "waiting on you" badge — a count, not a list. */
        public static final String PENDING_COUNT = BASE + "/pending-count";

        /** {@code reqId}, not {@code id} — the contract's {@code ReqId} path parameter. */
        public static final String BY_ID = BASE + "/{reqId}";
    }

    /**
     * In-app buyer&lt;-&gt;owner chat. Opening a thread requires an approved contact request in one direction
     * or the other; see {@code ConversationService}.
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

        /** Participants only — upload a file to attach to a later message. */
        public static final String ATTACHMENTS = BY_ID + "/attachments";

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
         * The raiser or ops — upload a file to attach to a later message. Same two-phase shape as
         * {@link Conversations#ATTACHMENTS}, and guarded by the same rule that guards the thread itself.
         */
        public static final String ATTACHMENTS = BY_ID + "/attachments";

        /**
         * The raiser or ops — clear the caller's own unread flag, and only that one. The
         * platform-wide queue this feeds is {@link Admin#SUPPORT_TICKETS}.
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

    /** The visit lifecycle: schedule, list, update status, reschedule. Two surfaces, one entity. */
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

        /** Authenticated — reschedule a live visit to a new slot; either participant may. */
        public static final String SLOT = BASE + "/{id}/slot";
    }

    /** The caller's opt-in identity badge (L2). Absence never blocks anything (ADR-019). */
    public static final class Verification {

        private Verification() {
        }

        /**
         * Authenticated — {@code GET} reads the case, {@code POST} (multipart) submits live-captured document
         * photos and a selfie for staff review.
         */
        public static final String IDENTITY = "/me/verification/identity";

        /**
         * Authenticated, {@code local} profile only ({@code @LocalOnly}) — approves the caller's case so
         * the earned-badge state can be demonstrated in dev without a second staff session.
         */
        public static final String IDENTITY_SIMULATE = IDENTITY + "/simulate";
    }

    /**
     * Local-disk object bytes, <strong>{@code local} profile only</strong> ({@code @LocalOnly}) — the thing
     * {@code MockFileStorage.signedDownloadUrl} points at.
     */
    public static final class DevStorage {

        private DevStorage() {
        }

        /**
         * The object itself. {@code {*key}} rather than {@code {key}} because a storage key has slashes in it
         * ({@code documents/{propertyId}/{uuid}}) and a single-segment template would match none of them.
         */
        public static final String OBJECT = "/dev/storage/{*key}";

        /** The same routes as a servlet pattern, for the security matcher that fronts them. */
        public static final String ANY = "/dev/storage/**";
    }

    /** The owner's private property finance ledger (slice 5). */
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
     * The tenant's own record of the home they rent — the counterpart to {@link Finances}, which is the
     * owner's.
     */
    public static final class Rentals {

        private Rentals() {
        }

        /** Authenticated — {@code GET} lists the caller's rentals, {@code POST} records one. */
        public static final String MINE = "/me/rentals";

        /** Authenticated — {@code PATCH} edits one, {@code DELETE} soft-deletes it. */
        public static final String BY_ID = MINE + "/{rentalId}";
    }

    /**
     * Tenancies and tenant screening profiles (slice 5). Every read is participant-scoped; the one
     * mobile-keyed read is relationship-guarded and answers 404 for every refusal (spec fix S10).
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

        /** Authenticated — the badge-only batch of {@link #PROFILE_BY_MOBILE}. */
        public static final String PROFILES_VERIFIED = "/tenant-profiles/verified";

        /** Authenticated — stays claimed on one listing. */
        public static final String DECLARATIONS = "/properties/{propId}/tenancy-declarations";

        /** Authenticated — the owner agrees a claimed stay happened. Their listing only. */
        public static final String DECLARATION_CONFIRM = "/tenancy-declarations/{id}/confirm";

        /** Authenticated — the owner disagrees, or withdraws an earlier confirmation. */
        public static final String DECLARATION_REVOKE = "/tenancy-declarations/{id}/revoke";
    }

    /**
     * Engagement (slice 8) — the things a signed-in person accumulates: a shortlist, followed societies,
     * saved searches, notifications.
     */
    public static final class Engagement {

        private Engagement() {
        }

        /** Authenticated — the caller's shortlist, as full property summaries. */
        public static final String SAVED = "/me/saved";

        /**
         * Authenticated — {@code PUT} shortlists a property, {@code DELETE} removes it. Idempotent both ways.
         */
        public static final String SAVED_BY_PROPERTY = SAVED + "/{propId}";

        /** Authenticated — the caller's flatmate shortlist, as full card projections. */
        public static final String FLATMATE_SAVES = "/me/flatmate-saves";

        /** Authenticated — the caller's flatmate shortlist as bare keys, unpaged. */
        public static final String FLATMATE_SAVE_KEYS = FLATMATE_SAVES + "/keys";

        /**
         * Authenticated — {@code PUT} shortlists one flatmate post, {@code DELETE} removes it. Idempotent
         * both ways.
         */
        public static final String FLATMATE_SAVE_BY_ID = FLATMATE_SAVES + "/{kind}/{id}";

        /** Authenticated — {@code PUT}/{@code DELETE} the caller's follow on one society. */
        public static final String SOCIETY_FOLLOW = "/me/societies/{slug}/follow";

        /** Authenticated — {@code GET} the societies the caller follows, paged, newest follow first. */
        public static final String SOCIETIES_FOLLOWING = "/me/societies/following";

        /** Authenticated — {@code GET} the caller's saved searches, {@code POST} to add one. */
        public static final String SAVED_SEARCHES = "/me/saved-searches";

        /** Authenticated — {@code DELETE} one saved search the caller owns. */
        public static final String SAVED_SEARCH_BY_ID = SAVED_SEARCHES + "/{id}";

        /**
         * Authenticated — {@code GET} the caller's recent searches (the "resume your search" rail), {@code
         * PUT} to record one.
         */
        public static final String RECENT_SEARCHES = "/me/recent-searches";

        /** Authenticated — the caller's notifications, newest first, paged. */
        public static final String NOTIFICATIONS = "/notifications";

        /** Authenticated — marks the given ids read, or all of them when the body is absent. */
        public static final String NOTIFICATIONS_READ = NOTIFICATIONS + "/read";

        /** Authenticated — {@code DELETE} one notification the caller owns (dismiss). */
        public static final String NOTIFICATION_BY_ID = NOTIFICATIONS + "/{id}";

        /**
         * Authenticated — {@code GET}/{@code PUT} the caller's notification and communication settings:
         * channel switches, the master match-alert switch, quiet hours and language.
         */
        public static final String NOTIFICATION_PREFERENCES = "/me/notification-preferences";
    }

    /** The flatmates market. */
    public static final class Flatmates {

        private Flatmates() {
        }

        /** {@code GET} public — the team-up supply. {@code POST} authenticated — advertise yourself. */
        public static final String POSTS = "/flatmates/posts";

        /** Authenticated — {@code PATCH} edits, {@code DELETE} takes down. Author-scoped. */
        public static final String POST_BY_ID = POSTS + "/{id}";

        /** Authenticated — answer an ad, releasing the <em>requester's</em> contact to the host. */
        public static final String POST_INTEREST = POST_BY_ID + "/interest";

        /** Authenticated — who answered <em>this</em> ad. Poster-scoped, and never public. */
        public static final String POST_INTERESTS = POST_BY_ID + "/interests";

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

        /** Public — the tab-aware mixed feed, and the surface the consumer page actually renders. */
        public static final String FEED = "/flatmates/feed";

        /** {@code GET} public — rooms. {@code POST} authenticated — offer a spare room. */
        public static final String ROOMS = "/flatmates/rooms";

        /** Authenticated — withdraw a room I posted. */
        public static final String ROOM_BY_ID = ROOMS + "/{id}";

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
        /**
         * Authenticated — request, then confirm, the flat owner's OTP consent <em>before</em> the group
         * exists.
         */
        public static final String OWNER_CONSENT = "/flatmates/owner-consent";

        /** Authenticated — ask to join. An open-policy group accepts outright. */
        public static final String GROUP_JOIN = GROUP_BY_ID + "/join";

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

    /** Reviews (slice 8). */
    public static final class Reviews {

        private Reviews() {
        }

        /** {@code GET} public, {@code POST} authenticated — reviews of one listing. */
        public static final String FOR_PROPERTY = "/properties/{propId}/reviews";

        /** {@code GET} public — the server-computed rating summary for one listing. */
        public static final String SUMMARY_FOR_PROPERTY = FOR_PROPERTY + "/summary";

        /** {@code GET} public, {@code POST} authenticated — reviews of a society, locality or owner. */
        public static final String FOR_ENTITY = "/reviews/{entityType}/{entityId}";

        /** {@code GET} public — the server-computed rating summary for a society, locality or owner. */
        public static final String SUMMARY_FOR_ENTITY = FOR_ENTITY + "/summary";
    }

    /** Editorial content (slice 8) — announcements, the services directory, FAQs and banners. */
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

    /** Documents, sharing and agreements (slice 10) — the paperwork half of a deal. */
    public static final class MeDocuments {

        private MeDocuments() {
        }

        private static final String BASE = "/me/documents";

        /** Owner — the document vault for one of their listings (list + upload). */
        public static final String FOR_PROPERTY = BASE + "/{propId}";

        /** Owner — remove one document from that vault. */
        public static final String BY_ID = BASE + "/{propId}/{docId}";

        /** The caller's own KYC papers (list + upload) — Aadhaar, PAN, a passport photo. */
        public static final String PERSONAL = BASE + "/personal";

        /** Owner — remove one of their personal documents. */
        public static final String PERSONAL_BY_ID = PERSONAL + "/{docId}";

        /** Owner — the private vault on one of their managed records (list + upload). */
        public static final String FOR_MANAGED = BASE + "/managed/{managedId}";

        /** Owner — remove one paper from a managed record's vault. */
        public static final String MANAGED_BY_ID = FOR_MANAGED + "/{docId}";

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

        /** Public but token-scoped — read the documents a grant unlocked. */
        public static final String SHARED = BASE + "/shared";
    }

    /** The buyer's own asks — the requester's half of {@link MeDocuments#REQUESTS}. */
    public static final class MeDocumentRequests {

        private MeDocumentRequests() {
        }

        /** Buyer — every access request <em>they</em> wrote, newest first, paged. */
        public static final String BASE = "/me/document-requests";

        /** Buyer — the documents one of their own granted requests unlocked, read while signed in. */
        public static final String DOCUMENTS_BY_ID = BASE + "/{reqId}/documents";
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
     * Service requests (slice 11) — the assisted-service workflow: a customer asks for a rent agreement or a
     * legal opinion, ops does the work, and a draft goes back for approval.
     */
    public static final class ServiceRequests {

        private ServiceRequests() {
        }

        /** Customer — their own requests; staff/admin — the whole queue (spec fix S40). */
        public static final String BASE = "/service-requests";

        /** Customer or staff — one request with its timeline, documents and messages. */
        public static final String BY_ID = BASE + "/{id}";

        /** The requester only — create a co-fill rent agreement and invite the second party. */
        public static final String CO_FILL_CREATE = BASE + "/co-fill";

        /** Staff/admin — drive the workflow. */
        public static final String STATUS = BY_ID + "/status";

        /** Customer or staff — the conversation on the request. */
        public static final String MESSAGES = BY_ID + "/messages";

        /** Customer or staff — attach a document to the request. */
        public static final String DOCS = BY_ID + "/docs";

        /**
         * Customer or staff — <strong>read-only</strong> progress against the named paperwork the request
         * needs.
         */
        public static final String CHECKLIST = BY_ID + "/checklist";

        /**
         * The parties' PAN and Aadhaar — <strong>written by the requester, read only by the staff
         * member the request is assigned to</strong>.
         */
        public static final String IDENTITIES = BY_ID + "/identities";

        /** Staff/admin — the maker: share a draft for approval (spec fix S41). */
        public static final String DRAFT = BY_ID + "/draft";

        /** The requesting customer only — the checker: approve or send it back. */
        public static final String DRAFT_DECISION = DRAFT + "/decision";

        /** Staff/admin — the registered copy; uploading it completes the request. */
        public static final String FINAL_DOC = BY_ID + "/final-doc";

        /** The requester only — name the other side of a co-filled agreement. */
        public static final String PARTIES = BY_ID + "/parties";

        /** The requester only — take back an unanswered invitation. */
        public static final String PARTY_BY_ID = PARTIES + "/{partyId}";

        /** An accepted co-fill party — submit their section of the agreement details. */
        public static final String PARTY_DETAILS = BY_ID + "/party-details";

        /** The requester only — open checkout for a deferred co-fill request. */
        public static final String CHECKOUT = BY_ID + "/checkout";

        /** Anyone on the request — mark the other side's messages seen. */
        public static final String READ = BY_ID + "/read";

        /** The invited person only — the invitations addressed to them. */
        public static final String MY_INVITES = "/me/service-request-invites";

        /** The invited person only — accept or decline. Accepting is what widens their read scope. */
        public static final String INVITE_DECISION = MY_INVITES + "/{partyId}";
    }

    /**
     * Billing catalogue and subscriptions (slice 13). {@link #BASE} is public — the price list is published
     * before the sign-up wall, exactly like {@link Fees}.
     */
    public static final class Plans {

        private Plans() {
        }

        /** Public — the plan catalogue. */
        public static final String BASE = "/plans";

        /** Authenticated — {@code GET} the caller's current plan, {@code POST} to change it. */
        public static final String SUBSCRIPTION = "/me/subscription";

        /** Authenticated — what the caller is entitled to do: owner contacts and listing slots (D31b). */
        public static final String ENTITLEMENTS = "/me/entitlements";
    }

    /** Listing merchandising a seller can buy (slice 13). The pack list is public. */
    public static final class Boosts {

        private Boosts() {
        }

        /** Public — the boost pack catalogue. */
        public static final String PACKS = "/boost-packs";

        /** The listing owner only — buy a boost for one of their properties. */
        public static final String LISTING = "/me/properties/{propId}/boost";
    }

    /**
     * The services marketplace (slice 13) — packers, interiors, legal, loans. The catalogue is public; orders
     * are caller-scoped.
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
         * The customer's decision on a quote. Theirs alone — ops sets the price, the customer agrees to
         * it, and {@link #ORDER_STATUS} cannot reach {@code scheduled}.
         */
        public static final String ORDER_ACCEPT = ORDER + "/accept";

        /** The customer calling the job off, any time before work starts. */
        public static final String ORDER_CANCEL = ORDER + "/cancel";

        /** Staff/admin — quote an order and drive it to completion. */
        public static final String ORDER_STATUS = "/service-orders/{id}/status";
    }

    /** The referral scheme (slice 13). */
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
     * The ops ticket board (slice 11). Team-scoped work items — the lightweight queue beside the {@link
     * ServiceRequests} workflow.
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

    /** "Tell me when this service launches" — the one public write that reaches the ops board. */
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

        /** Staff/admin — approve or reject a listing. */
        public static final String PROPERTY_STATUS = Properties.BY_ID + "/status";

        /** Staff/admin — toggle homepage merchandising. */
        public static final String PROPERTY_FEATURED = Properties.BY_ID + "/toggle-featured";

        /**
         * Staff/admin — raise (POST) or clear (DELETE) a moderation flag. One path, two methods, so the
         * mappings must be method-level or the two would collide.
         */
        public static final String PROPERTY_FLAG = Properties.BY_ID + "/flag";

        /** Staff/admin — correct another user's listing in place. */
        public static final String PROPERTY_ADMIN_UPDATE = Properties.BY_ID + "/admin";

        /**
         * Authenticated, participant-scoped — the owner&lt;-&gt;ops clarification thread. No {@code x-roles}:
         * the owner is a participant, so role-gating it would lock them out of their own review.
         */
        public static final String PROPERTY_VERIFICATION = Properties.BY_ID + "/verification";

        /** Authenticated, participant-scoped — post to the thread. */
        public static final String VERIFICATION_MESSAGES = PROPERTY_VERIFICATION + "/messages";

        /** Authenticated, participant-scoped — mark the caller's own side of the thread read. */
        public static final String VERIFICATION_READ = PROPERTY_VERIFICATION + "/read";

        /** Staff/admin — the checker half of the maker-checker listing review. */
        public static final String VERIFICATION_DECISION = PROPERTY_VERIFICATION + "/decision";

        /** Staff/admin — tick one checklist line as checked, or untick it. */
        public static final String VERIFICATION_CHECKLIST = PROPERTY_VERIFICATION + "/checklist";

        /**
         * The ownership gate. GET is participant-scoped — an owner must be able to see which required
         * fact their listing is still waiting on — while POST, which grants the badge, is staff/admin.
         */
        public static final String VERIFICATION_OWNERSHIP = PROPERTY_VERIFICATION + "/ownership";

        /** Staff/admin — record one document against the ownership gate. */
        public static final String VERIFICATION_OWNERSHIP_EVIDENCE = VERIFICATION_OWNERSHIP + "/evidence";

        /** Staff/admin — the owner's vault for this listing, so evidence can cite a document. */
        public static final String VERIFICATION_OWNERSHIP_DOCUMENTS = VERIFICATION_OWNERSHIP + "/documents";

        /** Staff/admin — list verification case files. */
        public static final String ADMIN_PROPERTY_REVIEWS = "/admin/property-reviews";

        /** The owner's own side of the same queue. */
        public static final String ME_PROPERTY_REVIEWS = "/me/property-reviews";

        /**
         * POST is open to any signed-in user (file a report); GET is staff/admin (read the queue). The
         * asymmetry is the whole design of an abuse queue and is enforced per-method.
         */
        public static final String REPORTS = "/reports";

        /** Staff/admin — triage one report (spec fix S30). */
        public static final String REPORT_BY_ID = REPORTS + "/{id}";

        /** Staff/admin — take a review down or restore it (spec fix S31). */
        public static final String REVIEW_STATUS = "/reviews/{id}/status";

        /** Staff/admin — internal notes on one listing, person, review or report. */
        public static final String NOTES_FOR_ENTITY = "/admin/notes/{entityType}/{entityId}";

        /** Staff/admin — rewrite one note's text. */
        public static final String NOTE_BY_ID = "/admin/notes/{id}";

        /** Staff/admin — the review moderation queue. */
        public static final String ADMIN_REVIEWS = "/admin/reviews";

        /** Staff/admin — the listing moderation queue. */
        public static final String ADMIN_PROPERTIES = "/admin/properties";

        /** Staff/admin — the moderation console's headline counts, over every listing. */
        public static final String ADMIN_PROPERTIES_SUMMARY = ADMIN_PROPERTIES + "/summary";

        /** Staff/admin — how much of their listing ceiling one owner is using. */
        public static final String ADMIN_PROPERTIES_OWNER_STANDING =
                ADMIN_PROPERTIES + "/owner-standing";

        /** Staff/admin — listings that look like the same doorway, grouped. */
        public static final String ADMIN_PROPERTIES_DUPLICATES = ADMIN_PROPERTIES + "/duplicates";

        /** Staff/admin — keep one listing in a cluster and archive the rest. */
        public static final String ADMIN_PROPERTIES_DUPLICATES_MERGE =
                ADMIN_PROPERTIES_DUPLICATES + "/merge";

        /** Staff/admin — record that a cluster is a coincidence. */
        public static final String ADMIN_PROPERTIES_DUPLICATES_DISMISS =
                ADMIN_PROPERTIES_DUPLICATES + "/dismiss";

        /** Staff/admin — move a staff-created listing along the owner hand-back funnel. */
        public static final String PROPERTY_PIPELINE = Properties.BY_ID + "/pipeline";

        /** Staff/admin — chase this listing's owner, and the record of every previous chase. */
        public static final String PROPERTY_OUTREACH = Properties.BY_ID + "/outreach";

        /** Ops — the demand board: every contact request on the platform, newest first. */
        public static final String ADMIN_ENQUIRIES = "/admin/enquiries";

        /** Ops — every site visit on the platform. Read-only; see {@link #ADMIN_ENQUIRIES}. */
        public static final String ADMIN_VISITS = "/admin/visits";

        /** Ops — every deal on the platform, the funnel's floor. Read-only. */
        public static final String ADMIN_DEALS = "/admin/deals";

        /**
         * Admin — one row of the demand board with the counterparty's mobile <strong>unmasked</strong>, and
         * never without an {@code audit_log} row.
         */
        public static final String ADMIN_ENQUIRY_BY_ID = ADMIN_ENQUIRIES + "/{id}";

        /**
         * Admin — one site visit, visitor's mobile unmasked and audited. See {@link #ADMIN_ENQUIRY_BY_ID}.
         */
        public static final String ADMIN_VISIT_BY_ID = ADMIN_VISITS + "/{id}";

        /** Admin — one deal, counterparty's mobile unmasked and audited. See {@link #ADMIN_ENQUIRY_BY_ID}. */
        public static final String ADMIN_DEAL_BY_ID = ADMIN_DEALS + "/{id}";

        /** Ops — the flatmate host-verification queue. */
        public static final String FLATMATE_REVIEWS = "/admin/flatmate-reviews";

        /** Ops — decide one host verification. A rejection must carry a reason. */
        public static final String FLATMATE_REVIEW_BY_ID = FLATMATE_REVIEWS + "/{id}";

        /**
         * Staff/admin — the identity-verification queue: live-captured ID photos and a selfie awaiting a
         * human decision.
         */
        public static final String IDENTITY_REVIEWS = "/moderation/identity-reviews";

        /** Staff/admin — one case with its images and dedup warnings. */
        public static final String IDENTITY_REVIEW_BY_ID = IDENTITY_REVIEWS + "/{id}";

        /** Staff/admin — approve with the reviewer-confirmed number, name and DOB. */
        public static final String IDENTITY_REVIEW_APPROVE = IDENTITY_REVIEW_BY_ID + "/approve";

        /** Staff/admin — reject with a reason the user can act on. */
        public static final String IDENTITY_REVIEW_REJECT = IDENTITY_REVIEW_BY_ID + "/reject";

        /** Admin — the moderation axis on any flatmate post, room or group. */
        public static final String FLATMATE_MODERATION = "/admin/flatmates/{id}/moderation";

        /** Admin — read one conversation as a moderator, for a chat that has been reported. */
        public static final String ADMIN_CONVERSATION = "/admin/conversations/{id}";

        /** Admin — the flatmate moderation queue: what is waiting to be let out. */
        public static final String FLATMATE_MODERATION_QUEUE = "/admin/flatmates/moderation";

        /** Admin — flatmate group applications to owners' listings. */
        public static final String GROUP_APPLICATIONS = "/admin/group-applications";

        /** Admin — moderate one group application. */
        public static final String GROUP_APPLICATION_BY_ID = GROUP_APPLICATIONS + "/{id}";
    }

    /**
     * User administration (slice 9). Distinct from {@link Auth#ME}, which is the caller's own profile:
     * everything here acts on <em>somebody else's</em> account.
     */
    public static final class Users {

        private Users() {
        }

        /** Staff/admin — paged directory. Mobile is masked here; the detail read reveals it. */
        public static final String BASE = "/users";

        /** Staff/admin — one user, with the contact detail ops needs to act. */
        public static final String BY_ID = BASE + "/{id}";

        /** Admin — remove an account from the directory (soft; never a hard delete). */
        public static final String ARCHIVE = BY_ID + "/archive";

        /** Admin — bring an archived account back into the directory. */
        public static final String RESTORE = BY_ID + "/restore";

        /** Admin — stop an account obtaining a session, without removing it. */
        public static final String SUSPEND = BY_ID + "/suspend";

        /** Admin — return a suspended account to {@code active}. Idempotent, like {@link #SUSPEND}. */
        public static final String REACTIVATE = BY_ID + "/reactivate";

        /** Admin — grant or withdraw the L2 "Verified" badge by hand. */
        public static final String BADGE = BY_ID + "/badge";

        /** Admin — raise or lower the internal review flag. */
        public static final String FLAG = BY_ID + "/flag";

        /** Admin — this person's activity across the platform, newest first. */
        public static final String TIMELINE = BY_ID + "/timeline";

        /** Admin only — create a staff/admin account. The privilege-escalation surface. */
        public static final String STAFF = BASE + "/staff";

        /**
         * Admin only — the accounts minted through {@link #STAFF} that are still waiting for a second
         * administrator to approve them.
         */
        public static final String PENDING_APPROVALS = BASE + "/pending-approvals";

        /** Admin only — turn the second key on an account minted by <em>another</em> administrator. */
        public static final String APPROVE = BY_ID + "/approve";

        /** Admin only — read or replace one back-office account's permission document. */
        public static final String PERMISSIONS = BY_ID + "/permissions";
    }

    /** The back-office: the ops dashboard, platform configuration, CMS authoring and the audit read. */
    public static final class Admin {

        private Admin() {
        }

        /** Admin only — the append-only record of privileged actions. */
        public static final String AUDIT_LOG = "/admin/audit-log";

        /**
         * Admin only — the same rows as {@link #AUDIT_LOG}, narrowed to back-office actors and resolved to
         * the person who acted rather than their id.
         */
        public static final String STAFF_ACTIVITY = "/admin/staff-activity";

        /**
         * Admin only — totals, the per-entity split, the action vocabulary and the leaderboard for the same
         * window, aggregated in one round trip.
         */
        public static final String STAFF_ACTIVITY_SUMMARY = STAFF_ACTIVITY + "/summary";

        /** Staff/admin — the KPI scorecard. Revenue is blanked for staff; see {@code AdminKpis}. */
        public static final String DASHBOARD = "/admin/dashboard";

        /** Staff/admin — one metric, bucketed over a date range. */
        public static final String ANALYTICS = "/admin/analytics";

        /** Staff/admin — live listings against recorded demand, per locality. */
        public static final String SUPPLY_GAP = "/admin/supply-gap";

        /** Staff/admin — asking price against the locality's curated market rate. */
        public static final String ANALYTICS_PRICING = "/admin/analytics/pricing";

        /** Staff/admin — moderation turnaround against the review SLA. */
        public static final String ANALYTICS_SLA = "/admin/analytics/sla";

        /** Staff/admin — how much traffic arrived, over time and by source. */
        public static final String ANALYTICS_TRAFFIC = "/admin/analytics/traffic";

        /** Staff/admin — what visitors did once they arrived: session depth, bounce rate, top pages. */
        public static final String ANALYTICS_ENGAGEMENT = "/admin/analytics/engagement";

        /** Staff/admin — the signed-out majority: how many, on which pages, leaving from where. */
        public static final String ANALYTICS_SURFERS = "/admin/analytics/surfers";

        /** Staff/admin — the platform-wide support queue, paged. */
        public static final String SUPPORT_TICKETS = "/admin/support-tickets";

        /** Admin only — revenue, liabilities and the revenue split. */
        public static final String FINANCE = "/admin/finance";

        /** Admin only — revenue per month, split by source. */
        public static final String FINANCE_SERIES = FINANCE + "/series";

        /** Admin only — the settlement ledger, paged. */
        public static final String FINANCE_TRANSACTIONS = FINANCE + "/transactions";

        /** Admin only — the platform configuration document. GET reads it, PUT merges into it. */
        public static final String SETTINGS = "/admin/settings";

        /** Admin only — one curated city's launch state. */
        public static final String CITY_BY_SLUG = "/admin/cities/{slug}";

        /** Staff/admin — which cities people have asked Draazy to launch in, aggregated. */
        public static final String CITY_WAITLIST = "/admin/cities/waitlist";

        /** Admin only — every per-account permission the server actually enforces. */
        public static final String PERMISSION_CATALOGUE = "/admin/permission-catalogue";

        /** Staff/admin — the outreach template library, filtered by channel. */
        public static final String MESSAGE_TEMPLATES = "/admin/message-templates";

        /**
         * Staff/admin — CMS rows of one type. {@code {type}} is the discriminator across the four managed
         * tables (announcements, services, faqs, banners).
         */
        public static final String CONTENT = "/admin/content/{type}";

        /** Staff/admin — one CMS row. */
        public static final String CONTENT_ITEM = CONTENT + "/{id}";

        /** Staff/admin — soft-delete a CMS row; it disappears from the public read. */
        public static final String CONTENT_ARCHIVE = CONTENT_ITEM + "/archive";

        /** Staff/admin — undo an archive. */
        public static final String CONTENT_RESTORE = CONTENT_ITEM + "/restore";
    }

    /** Anonymous demand telemetry: what people looked for, whether or not the platform had it. */
    public static final class DemandSignals {

        private DemandSignals() {
        }

        /** POST is public and capped per IP by {@code WriteRateLimitFilter}. There is no GET. */
        public static final String BASE = "/demand-signals";
    }

    /** Page-view telemetry: which routes were rendered, grouped into browsing sessions. */
    public static final class PageViews {

        private PageViews() {
        }

        /**
         * POST is public and capped per IP by {@code WriteRateLimitFilter}; the client batches so that a
         * beacon cannot spend a visitor's whole write budget.
         */
        public static final String BASE = "/page-views";
    }

    /** The B2B pipeline: a society or builder asking to be onboarded in bulk. */
    public static final class SocietyLeads {

        private SocietyLeads() {
        }

        /** POST is public and rate-limited per mobile; GET is staff/admin and paged. */
        public static final String BASE = "/society-leads";

        /** Staff/admin — work the pipeline. */
        public static final String BY_ID = BASE + "/{id}";
    }

    /** Server-to-server callbacks. */
    public static final class Webhooks {

        private Webhooks() {
        }

        /** Public — Cashfree payment result. Signature-verified, deduped on order id, always 200. */
        public static final String CASHFREE_PAYMENT = "/webhooks/cashfree/payment";
    }
}
