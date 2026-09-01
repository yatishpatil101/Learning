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

        /**
         * Public — a newly minted back-office colleague redeems their single-use invite and sets
         * their own password (tech debt D206).
         *
         * <p>Necessarily unauthenticated: the person holding the token has no credential yet, which
         * is the entire point. The unguessable, expiring, single-use token <em>is</em> the
         * credential, and it is verified in {@code identity.auth.StaffInviteService} — the same
         * shape as {@code GET /documents/shared}.
         */
        public static final String STAFF_INVITE_REDEEM = "/auth/staff-invite/redeem";

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

        /**
         * Public — how much of the live catalogue is verified, optionally for one locality.
         *
         * <p>A literal sibling of {@link #BY_ID}, which is safe for the same reason {@link #FEATURED}
         * is: an exact path outranks a template one, so {@code /properties/trust-stats} can never be
         * read as a listing whose id is {@code trust-stats}. Hyphenated rather than camel-cased
         * because every other multi-word path in this contract is.
         */
        public static final String TRUST_STATS = BASE + "/trust-stats";

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
     * The public seller card: who is behind a listing, for a visitor deciding whether to enquire.
     *
     * <p><strong>Deliberately not under {@link Users}.</strong> That family is the staff directory —
     * every route on it acts on somebody else's <em>account</em>, and all of them are behind a role.
     * This one is the marketplace surface a stranger lands on from a listing, so it answers a
     * different question about the same row and is capped to the handful of facts a stranger has any
     * business knowing. Two names for one table is the point: it makes the ceiling a property of the
     * route rather than a discipline anybody has to remember.
     */
    public static final class Owners {

        private Owners() {
        }

        /**
         * Public — one owner's profile card. There is deliberately no collection read: a public
         * {@code GET /owners} would be a downloadable list of the platform's landlords, which is
         * worth more to a scraper than to any visitor.
         */
        public static final String BY_ID = "/owners/{id}";

        /**
         * Security-chain matcher. Single-segment on purpose, for the same reason as
         * {@link Localities#ANY_SINGLE}: there is no deeper owner route, and a {@code **} would make
         * one public before anybody had decided it should be.
         */
        public static final String ANY_SINGLE = "/owners/*";
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

        /**
         * Staff — the curation console. Under {@code /admin} rather than as a method on
         * {@code /localities} so that the security chain's public matcher above stays a statement
         * about one prefix: everything under {@code /localities} is readable by anyone, and nothing
         * under it is writable by anyone.
         */
        public static final String ADMIN_BASE = "/admin/localities";

        /** Staff — edit or retire one locality. */
        public static final String ADMIN_BY_SLUG = ADMIN_BASE + "/{slug}";
    }

    /**
     * Staff — the listings the resolver could not place, and the assignment that clears one
     * (register item 24).
     *
     * <p><strong>Not under {@code /admin/localities}, deliberately, twice over.</strong> The rows
     * are listings, not localities: what this returns is {@code properties} the catalogue cannot
     * file, so it is gated on {@code properties:read}/{@code properties:write} while everything
     * under {@link Localities#ADMIN_BASE} is gated on {@code localities:*}. Nesting it there would
     * put two permission postures under one prefix, which is the arrangement where the wrong
     * annotation is invisible. And {@link Localities#ADMIN_BY_SLUG} is {@code /admin/localities/
     * {slug}} — a nested {@code /queue} would collide with a locality that happened to be keyed
     * {@code queue}, a collision no reviewer would predict and no test would catch.
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
         * Public — where the caller stands in this society: their residency, whether they are the
         * committee, the society's live claim, and how many residents are verified.
         *
         * <p>Public and caller-aware for the same reason {@link #BY_SLUG} is: a logged-out visitor
         * gets the society's public facts and empty personal ones, and the hub renders in one pass
         * instead of flickering controls in as three separate reads land.
         */
        public static final String MEMBERSHIP = BY_SLUG + "/membership";

        /**
         * Authenticated — {@code POST} asks to be recognised as a resident of one flat.
         *
         * <p>Under the society rather than under {@code /me} because the resource being created
         * belongs to the society's register, not to the caller's account: the committee reads it,
         * the committee decides it, and its uniqueness rule is scoped to the building.
         */
        public static final String RESIDENTS = BY_SLUG + "/residents";

        /** Committee or staff — {@code GET} the residency queue for this society. */
        public static final String RESIDENTS_QUEUE = RESIDENTS;

        /** Committee or staff — {@code PATCH} verifies or rejects one residency request. */
        public static final String RESIDENT_BY_ID = RESIDENTS + "/{residentId}";

        /** Authenticated — {@code POST} claims this society on behalf of its committee. */
        public static final String CLAIM = BY_SLUG + "/claim";

        /**
         * Public {@code GET}, authenticated {@code POST} — questions asked about this society.
         *
         * <p>Deliberately not gated on residency: the person with the most to ask has not moved in
         * yet. The reader is protected by the {@code authorIsResident} badge instead.
         */
        public static final String QUESTIONS = BY_SLUG + "/questions";

        /** Authenticated — {@code POST} answers one question. */
        public static final String ANSWERS = QUESTIONS + "/{questionId}/answers";

        /**
         * Public {@code GET}, resident/committee {@code POST} — the society noticeboard.
         *
         * <p>Reading is open because an active noticeboard is the most honest signal a society hub
         * can give a prospective buyer; posting is not, because a notice asserts something about
         * the building.
         */
        public static final String BOARD = BY_SLUG + "/board";

        /** Author, committee or staff — {@code DELETE} takes one item down. */
        public static final String BOARD_ITEM = BOARD + "/{itemId}";

        /**
         * Public {@code GET}, authenticated {@code POST} — the community tab's tips, trusted picks
         * and photos.
         *
         * <p>Unfiltered: the tab's chips carry a count for every bucket including the ones you are
         * not looking at, so the page is drawn from one read and filtered in the browser. The
         * public read withholds a recommended person's phone number — they never agreed to be on
         * the open web.
         */
        public static final String CONTRIBUTIONS = BY_SLUG + "/contributions";

        /** Author, committee or staff — {@code DELETE} removes one contribution. */
        public static final String CONTRIBUTION = CONTRIBUTIONS + "/{contributionId}";

        /**
         * Authenticated — {@code PUT} marks a contribution helpful, {@code DELETE} unmarks it.
         *
         * <p>Two verbs rather than one toggle, so a request retried after a timeout cannot silently
         * undo the vote it just cast.
         */
        public static final String CONTRIBUTION_HELPFUL = CONTRIBUTION + "/helpful";

        /** Authenticated — {@code POST} replies in the thread under a contribution. */
        public static final String CONTRIBUTION_REPLIES = CONTRIBUTION + "/replies";

        /** Reply author, committee or staff — {@code DELETE} removes one reply. */
        public static final String CONTRIBUTION_REPLY = CONTRIBUTION_REPLIES + "/{replyId}";

        /**
         * Public {@code GET}, authenticated {@code POST} — what the community says this society is.
         *
         * <p>One resource for three proposals that share one lifecycle: missing details, the
         * resident WhatsApp invite, and a corrected map pin. The read publishes every pending
         * proposal plus whether a resident group exists at all; the invite URL itself reaches only
         * a verified resident, approved or not.
         */
        public static final String PROPOSALS = BY_SLUG + "/proposals";

        /** Security-chain matcher; single-segment for the same reason as {@link Localities#ANY_SINGLE}. */
        public static final String ANY_SINGLE = BASE + "/*";
    }

    /**
     * Staff — the society claim queue.
     *
     * <p>Not inside {@link Societies}: every route there is addressed by a society slug and all but
     * two are public, whereas this is a cross-society work queue that starts from no society at all.
     * Same reasoning that keeps {@code /admin/locality-queue} out of {@link Localities}.
     */
    public static final class SocietyClaims {

        private SocietyClaims() {
        }

        /** Staff — the pipeline of committees asking to run their own page, oldest first. */
        public static final String BASE = "/admin/society-claims";

        /** Staff — {@code PATCH} approves or rejects one claim. */
        public static final String BY_ID = BASE + "/{id}";

        /**
         * Staff — {@code GET} mints one short-lived link to this claim's registration certificate.
         *
         * <p><strong>Hung off the claim, not off the document.</strong> The certificate lives in the
         * claimant's personal vault, beside their Aadhaar and their salary slips, so a route shaped
         * {@code /admin/documents/{documentId}} would be a route that reads any of them for anyone
         * holding the {@code societies:read} atom. Starting from the claim means the only reachable
         * document is the one that claim recorded, and the id never travels in from the client at
         * all — it is read off the row.
         *
         * <p>On demand rather than folded into the queue read for a second reason: the queue pages
         * at twenty and most rows are never opened, so signing every row would be twenty signatures
         * and twenty expiring URLs per page view to serve the one an operator actually clicks.
         */
        public static final String CERTIFICATE = BY_ID + "/certificate";
    }

    /**
     * Staff — the community-proposal queue: society details, WhatsApp invites, corrected pins.
     *
     * <p>Beside {@link SocietyClaims} rather than inside {@link Societies}, for the same reason: it
     * is a cross-society work queue that starts from no society at all. It is also the queue whose
     * absence made all three features theatre — it used to read the operator's own browser, so it
     * was permanently empty however many residents filled the form in on theirs.
     */
    public static final class SocietyProposals {

        private SocietyProposals() {
        }

        /** Staff — everything the community has proposed, oldest first, filterable by kind. */
        public static final String BASE = "/admin/society-proposals";

        /** Staff — {@code PATCH} approves or rejects one, applying it to the society on approval. */
        public static final String BY_ID = BASE + "/{id}";
    }

    /**
     * Staff — the queue of societies members added because the catalogue did not have them.
     *
     * <p>Beside {@link SocietyClaims} and {@link SocietyProposals} for the same reason all three sit
     * here: a cross-society work queue starts from no society at all. This is the third queue that
     * was permanently empty because it read the operator's own browser — and the one whose emptiness
     * meant no member-added society has ever been confirmed.
     */
    public static final class SocietyCandidates {

        private SocietyCandidates() {
        }

        /** Staff — member-added societies nobody has checked yet, oldest first. */
        public static final String BASE = "/admin/society-candidates";

        /** Staff — {@code POST} confirms one is real. */
        public static final String VERIFY = BASE + "/{slug}/verify";
    }

    /**
     * Staff — every society's residency queue at once.
     *
     * <p>The fourth of the four queues that sit here rather than under {@link Societies}, and the
     * last one still answered out of the operator's own browser. {@link Societies#RESIDENTS_QUEUE}
     * exists and works, but it is addressed by slug: an operator asking "who is waiting anywhere"
     * through it would issue one request per society to find the handful with anything pending, and
     * the console would get slower every time the catalogue grew.
     *
     * <p><strong>Read only, deliberately.</strong> There is no {@code BY_ID} here because
     * {@link Societies#RESIDENT_BY_ID} already decides one request and already lets staff decide any
     * society's, and every row this queue publishes carries the slug that addresses it. A second
     * decision route would be a second copy of the unit-uniqueness rule, and the two would drift.
     */
    public static final class SocietyResidents {

        private SocietyResidents() {
        }

        /** Staff — residency requests across every society, oldest first, filterable by status. */
        public static final String BASE = "/admin/society-residents";
    }

    /**
     * Staff — the duplicate societies that have been folded into the ones that survive them.
     *
     * <p>The fifth queue beside {@link SocietyClaims}, {@link SocietyProposals},
     * {@link SocietyCandidates} and {@link SocietyResidents}, and here for the same reason: a merge
     * is about two societies, so it cannot be addressed under either one of them. {@code POST
     * /societies/{slug}/merge} would have made the losing society the subject of the request, which
     * reads as an edit of that society and is not — it is the creation of a relationship between
     * two, and the survivor has as much claim to being the subject as the duplicate does.
     *
     * <p><strong>Why the collection is the merges and not the societies.</strong> {@code GET} here
     * lists merges in force rather than merged-away societies, because the thing an operator needs
     * to review is the decision — which way round it went, when, and who made it. Modelling it that
     * way is also what makes {@code DELETE} mean something unambiguous: it removes the merge, not
     * the society.
     */
    public static final class SocietyMerges {

        private SocietyMerges() {
        }

        /**
         * Staff — {@code GET} lists every merge in force, newest first; {@code POST} records one.
         *
         * <p>The list is not a convenience. A merged-away society is absent from the directory and
         * its slug resolves to the survivor, so without this there is no surface on which an
         * operator could find a merge in order to undo it, and the undo would exist only in theory.
         */
        public static final String BASE = "/admin/society-merges";

        /**
         * Staff — {@code DELETE} undoes one merge, addressed by the slug of the society that was
         * merged away.
         *
         * <p>By the duplicate's slug and not the survivor's, because one survivor can absorb
         * several duplicates and "undo the merge on this society" would then be ambiguous — an
         * ambiguity the server would have to resolve by guessing.
         */
        public static final String BY_SLUG = BASE + "/{slug}";
    }

    /**
     * Staff — correcting one society's own facts.
     *
     * <p>Under {@code /admin} rather than as a verb on {@link Societies#BY_SLUG}, because the two
     * are different resources to different readers: {@code /societies/{slug}} is an anonymous read
     * of a building's public record, and this is the operator's view of the same row including a
     * note that must never appear on the first. Sharing a path would have made "may I see this?"
     * depend on the method rather than on the route, which is exactly the shape that leaks.
     *
     * <p><strong>Not beside the five queues</strong> ({@link SocietyClaims}, {@link
     * SocietyProposals}, {@link SocietyCandidates}, {@link SocietyResidents}, {@link
     * SocietyMerges}) in kind, only in neighbourhood. Those exist because a cross-society backlog
     * starts from no society at all; this one starts from exactly one society, which the operator
     * reached through the directory, so it is addressed by that society and has no collection.
     */
    public static final class AdminSocieties {

        private AdminSocieties() {
        }

        /**
         * Staff — {@code PATCH} corrects registration, conveyance, maintenance, claim status and
         * the internal note on one society.
         *
         * <p>There is deliberately no {@code BASE} beside this. An operator finds the society to
         * edit in the public directory, which is already paged, searchable and the same list they
         * would be given here; a second listing route would be a second set of filters to keep in
         * step with it for no reader who lacks one.
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

    /**
     * Public — which product features the client should render.
     *
     * <p><strong>Why this is not simply read from {@code /admin/settings}.</strong> The flags are
     * one block of that document, and that document is admin-only in both directions on purpose:
     * it also carries the fee table and the permission map, and knowing exactly what the platform
     * charges and which team may do what is itself a privileged answer. But the flags gate what a
     * <em>logged-out visitor</em> sees — the map view, the EMI calculator, the referral offer,
     * whether signups are open at all — so a surface only an administrator can read cannot be the
     * client's source for them. It was not: the browser read a copy out of local storage, which is
     * why toggling maintenance mode reported success and did nothing.
     *
     * <p>So this route publishes exactly one block and nothing else. It is the narrowest thing that
     * makes the toggles real, and it deliberately does not become "the public settings endpoint" —
     * the next block that needs a public reader gets its own route and its own argument for why it
     * is safe to publish.
     */
    public static final class Flags {

        private Flags() {
        }

        public static final String BASE = "/flags";
    }

    /**
     * Public — the Move-in Pack's launch state and its price list.
     *
     * <p><strong>Why this is a route of its own rather than more of {@link Flags}.</strong> That
     * endpoint's contract is {@code map of boolean}, and it drops non-booleans on purpose so the
     * response cannot lie about its own schema. Half of this block is prices. Widening {@code
     * /flags} to carry them would break the guarantee that makes it safe to read blindly, and its
     * own documentation asks the next block that needs a public reader to make its own case rather
     * than to move in. This is that case.
     *
     * <p><strong>Why the prices are public.</strong> The same argument {@code /fees} already
     * settled: a price a visitor is quoted before they sign in is not a privileged fact, and the
     * page that quotes it renders for people who have never had an account. The admin-only
     * {@code /admin/settings} cannot serve it, because that document also holds the permission map.
     *
     * <p><strong>Why {@code enabled} travels with the prices instead of joining the flags.</strong>
     * It is a feature toggle by any reading, and splitting it off would be defensible — but it
     * decides whether the prices beside it may be shown at all, and configuration that has to be
     * consistent should not be assembled from two responses that can arrive in either order or fail
     * independently.
     */
    public static final class MovePack {

        private MovePack() {
        }

        public static final String BASE = "/move-pack";
    }

    /**
     * Public — what PuneNest charges for its own products.
     *
     * <p><strong>Why it is not {@link Fees}, and why the names had to diverge.</strong> {@code
     * /fees} answers "what will this transaction cost me", keyed by deal intent, and most of what
     * it quotes is not ours — stamp duty and registration are the state's, and the zero beside
     * {@code brokerage} is the platform's entire pitch. This answers a different question: what
     * PuneNest sells and for how much. Bolting the plan prices onto {@code /fees} would have put
     * "the government charges 1% of the agreement value" and "Owner Pro is 4,999 a year" in one
     * array of one shape, and a reader could not have told which of the two it was holding. Two
     * questions, two routes, and the names have to be different enough that nobody has to check.
     *
     * <p><strong>Why not another key on {@link Flags}.</strong> The same answer {@link MovePack}
     * gives: that endpoint's contract is map-of-boolean and it drops everything else on purpose, so
     * a price list cannot go there without withdrawing the guarantee that makes it safe to read
     * blindly. Its documentation asks the next block that needs a public reader to make its own
     * case; {@link MovePack} made one for a service catalogue and this makes one for the platform's
     * own price list.
     *
     * <p><strong>Why the prices are public.</strong> The argument {@code /fees} settled and {@link
     * MovePack} reused: a price quoted before the sign-up wall is not a privileged fact, and this
     * one is quoted on the plans page, the paywall and the boost dialog — two of which a visitor
     * reaches without an account. {@code /admin/settings} cannot serve it, because that document
     * also carries the permission map.
     *
     * <p><strong>Why it is seven named fields and not the {@code fees} block.</strong> That block
     * also holds {@code freeContactLimit}, {@code referralContactBonus} and {@code
     * referralQualifyPerMonth}, and the last of those is the threshold past which a referral stops
     * qualifying automatically and goes to the fraud desk. Publishing a fraud threshold tells the
     * one reader who most wants to know it exactly where the line is. A projection of "the fees
     * document" would have carried it; a typed response of the seven prices cannot, and the next
     * key an operator adds to that block is not published by accident.
     */
    public static final class Pricing {

        private Pricing() {
        }

        public static final String BASE = "/pricing";
    }

    /**
     * Public — where the platform operates, and which places it will not suggest.
     *
     * <p><strong>Why this is a route of its own rather than more of {@link Flags}.</strong> The
     * same reason {@link MovePack} is. That endpoint is typed map-of-boolean and drops everything
     * else on purpose; this block is coordinates, a per-city roster and a list. Two of its three
     * parts could not survive the trip.
     *
     * <p><strong>Why it has to be public.</strong> It decides what a logged-out visitor is shown:
     * which cities the navbar offers, where a map centres, whether a locality search is fenced to
     * the city bounds, and which places are hidden from every suggestion box. The document it lives
     * in is admin-only in both directions because it also carries the fee table and the permission
     * map, so an administrator-only reader cannot be the client's source for it. It was not one —
     * every consumer read a copy out of its own local storage, so an operator could take a city
     * live, be told it saved, and have it reach nobody.
     *
     * <p><strong>What is deliberately not on it.</strong> Each blacklist entry carries an operator's
     * free-text reason for hiding the place. That is moderator prose about a named building, it is
     * never read by the matcher, and it does not go out on a route a stranger can call. The admin
     * console reads the whole block through {@code /admin/settings}, where the note belongs.
     */
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

        /**
         * Owner-only — "yes, this is still available", the anti-staleness heartbeat (V86).
         *
         * <p><strong>Why {@code POST} on a sub-path rather than a field on the {@code PATCH}.</strong>
         * The edit route reverts a listing to {@code pending} when a foundation field changes, and
         * raises a re-check when an attribute one does. Confirming availability must do neither —
         * an owner answering the nudge would otherwise take their own listing out of search, which
         * turns the one action the platform most wants owners to perform into a punishment. Keeping
         * it on its own path means the rule cannot be reached by accident from an edit body.
         *
         * <p><strong>Why it lives under {@code /me/listings} and not {@code /properties}.</strong>
         * The neighbours there — {@code archive}, {@code restore} — are owner-<em>or</em>-staff
         * moderation actions. This is neither: it is a claim only the owner can make, and its
         * meaning is exactly that the owner made it. Ops confirming availability on an owner's
         * behalf would be the platform vouching for a fact it has not checked.
         */
        public static final String CONFIRM_AVAILABLE = BY_ID + "/confirm-available";

        /**
         * Owner-only — "have I already listed this?", asked before the wizard submits (D226).
         *
         * <p><strong>Why {@code POST} on a read.</strong> The body carries an electricity meter
         * number, which is the one identifier on a listing that names a real-world utility account.
         * A query string puts it in the access log, the browser history and any {@code Referer} that
         * leaves the page, none of which are places that value belongs; the {@code properties} row
         * keeps it out of every response for the same reason. The request is idempotent and writes
         * nothing — the method is chosen by where the parameters end up, not by what the handler does.
         *
         * <p><strong>Why a sub-path of {@code /me/listings} and not a top-level route.</strong> The
         * answer is drawn exclusively from the caller's own listings, which is what makes it safe to
         * answer at all: the staff duplicate probe cannot report a finding to an owner, because a
         * finding about a stranger's listing turns a guessed meter number into a lookup. Sitting
         * under {@code /me/listings} is the statement of that scope.
         *
         * <p>Static, so it cannot be shadowed by {@link #BY_ID} — that path takes {@code GET} and
         * {@code PATCH} only, and this takes {@code POST}.
         */
        public static final String DUPLICATE_CHECK = BASE + "/duplicate-check";
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

        /**
         * Participants only — upload a file to attach to a later message (D49).
         *
         * <p>Separate from {@link #REPLY} because the reply takes JSON and bytes do not travel in
         * JSON. The upload is unclaimed until a reply names it, so this endpoint on its own reveals
         * nothing: what it returns is an id only its uploader can use, on a thread they already had
         * to be a participant of.
         */
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
         * The raiser or ops — upload a file to attach to a later message (D49). Same two-phase
         * shape as {@link Conversations#ATTACHMENTS}, and guarded by the same rule that guards the
         * thread itself.
         */
        public static final String ATTACHMENTS = BY_ID + "/attachments";

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
     * Local-disk object bytes, <strong>{@code dev} profile only</strong> ({@code @DevOnly}) — the
     * thing {@code MockFileStorage.signedDownloadUrl} points at (D120).
     *
     * <p>Under {@code dev} there is no object store, so the mock's download URLs pointed at
     * {@code https://mock.storage.local/…} — a host that does not resolve. Every document read
     * therefore answered with a URL-shaped fiction, and the service tracker's document preview
     * could not be exercised at all without real R2 credentials. This is the missing half: the
     * mock writes the bytes to disk already, and this serves them back.
     *
     * <p><strong>Not in the contract, and not in production.</strong> The controller is
     * {@code @DevOnly}, so the route does not exist anywhere the {@code dev} profile is not named,
     * and {@code SpecCoverageTest} exempts it for exactly that reason: publishing an operation that
     * 404s everywhere that matters is the inverse of the rot that test exists to catch. In a real
     * deployment the equivalent URL is R2's own signed URL and never touches this server.
     */
    public static final class DevStorage {

        private DevStorage() {
        }

        /**
         * The object itself. {@code {*key}} rather than {@code {key}} because a storage key has
         * slashes in it ({@code documents/{propertyId}/{uuid}}) and a single-segment template would
         * match none of them.
         */
        public static final String OBJECT = "/dev/storage/{*key}";

        /** The same routes as a servlet pattern, for the security matcher that fronts them. */
        public static final String ANY = "/dev/storage/**";
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

        /**
         * Authenticated — stays claimed on one listing (D194).
         *
         * <p>{@code POST} declares one, {@code GET} returns what the caller may see: every claim if
         * they own the listing, their own otherwise. Nested under the property because that is the
         * only place either side acts on it — a name is recognisable next to the flat it is about,
         * and never in a list of strangers across a portfolio.
         */
        public static final String DECLARATIONS = "/properties/{propId}/tenancy-declarations";

        /** Authenticated — the owner agrees a claimed stay happened. Their listing only. */
        public static final String DECLARATION_CONFIRM = "/tenancy-declarations/{id}/confirm";

        /**
         * Authenticated — the owner disagrees, or withdraws an earlier confirmation.
         *
         * <p>{@code POST}, not {@code DELETE}: the row survives. Eligibility stops either way, but
         * "claimed, agreed, withdrawn" is the trail an abuse investigation needs, and a deleted row
         * says nothing at all.
         */
        public static final String DECLARATION_REVOKE = "/tenancy-declarations/{id}/revoke";
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

        /**
         * Authenticated — {@code GET} the societies the caller follows, paged, newest follow first.
         *
         * <p>Does not collide with {@link #SOCIETY_FOLLOW}: that pattern has a further path segment
         * after the variable, so {@code /me/societies/following} can only match this literal.
         */
        public static final String SOCIETIES_FOLLOWING = "/me/societies/following";

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

        /**
         * Authenticated — {@code GET}/{@code PUT} the caller's notification and communication
         * settings: channel switches, the master match-alert switch, quiet hours and language.
         *
         * <p>Under {@code /me} rather than under {@link #NOTIFICATIONS}, though it is about
         * notifications, because the resource is the <em>caller</em> and not a notification. A
         * {@code /notifications/preferences} would sit in the same path space as
         * {@link #NOTIFICATION_BY_ID} and be shadowed by it in a reader's mind even where the
         * matcher gets it right — and a {@code DELETE /notifications/preferences} would then read
         * as dismissing a notification called "preferences".
         */
        public static final String NOTIFICATION_PREFERENCES = "/me/notification-preferences";
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

        /**
         * Authenticated — who answered <em>this</em> ad. Poster-scoped, and never public (D70).
         *
         * <p>Plural, one character away from {@link #POST_INTEREST}, and that is uncomfortably
         * close for two routes with opposite audiences: the singular is a write by a stranger, this
         * is a read by the author. They are distinguished by method as well as by suffix, and
         * neither is reachable through the {@code permitAll} matcher on {@link #POSTS}, which is
         * exact-path and {@code GET}-only.
         */
        public static final String POST_INTERESTS = POST_BY_ID + "/interests";

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

        /**
         * Authenticated — withdraw a room I posted.
         *
         * <p>A delete rather than a status flag, matching {@link #GROUP_BY_ID}: a host who takes a
         * room down is saying it was never really on offer, not that it filled. Closing the last
         * seat already expresses "taken", and conflating the two would leave a withdrawn room
         * scoring in the feed's freshness ordering.
         */
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

        /** Authenticated — ask to join. An open-policy group accepts outright. */
        public static final String GROUP_JOIN = GROUP_BY_ID + "/join";

        /**
         * Authenticated — the groups the caller started, moderation state and all.
         *
         * <p>{@link #GROUPS} is the public feed and its card projection deliberately carries no
         * host identity, so a client cannot pick its own groups out of it. That is correct for the
         * feed and useless for a host, hence a separate caller-scoped read rather than a
         * {@code ?mine} flag that would have to change what the shared projection contains.
         */
        public static final String MY_GROUPS = "/me/flatmate-groups";

        /**
         * Authenticated — the rooms the caller posted, moderation state and all.
         *
         * <p>The counterpart of {@link #MY_GROUPS}, and separate from {@link #ROOMS} for the same
         * reason: the public room feed is hard-floored to approved posts, so a host's pending or
         * rejected room is invisible to it. A host who could not see their own rejected post would
         * simply post it again.
         */
        public static final String MY_ROOMS = "/me/flatmate-rooms";

        /**
         * Authenticated — a formed group applies to an owner's whole-flat listing.
         *
         * <p>Hangs off the <em>group</em> rather than off the listing because the group is what is
         * being committed: the host is signing their members up, and the listing is the argument.
         * The mirror route ({@code /properties/{id}/applications}) would have read as "the listing
         * acquires an application", which is the owner's side of the same fact and is served by
         * {@link #MY_GROUP_APPLICATIONS}.
         */
        public static final String GROUP_APPLY = GROUP_BY_ID + "/apply";

        /**
         * Authenticated — applications addressed to the caller's own listings (owner inbox).
         *
         * <p>Under {@code /me} for the same reason {@link #MY_REQUESTS} is: the scope is the
         * caller, not a listing, and an owner with four flats wants one queue rather than four.
         */
        public static final String MY_GROUP_APPLICATIONS = "/me/group-applications";

        /**
         * Authenticated — accept or decline one application. Owner-scoped.
         *
         * <p>Deliberately <em>not</em> the same path as
         * {@link Routes.Moderation#GROUP_APPLICATION_BY_ID}. They write different columns for
         * different people: this one is the owner's yes/no, that one is the admin's moderation
         * axis, and a shared route would have made the separation a matter of who happened to be
         * signed in.
         */
        public static final String MY_GROUP_APPLICATION_BY_ID = MY_GROUP_APPLICATIONS + "/{id}";
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

        /**
         * Owner — the private vault on one of their managed records (list + upload), V93/D32.
         *
         * <p>A third bucket, not a third way into the first. {@link #FOR_PROPERTY} is a
         * <em>listing's</em> vault: those files are shareable with buyers through the
         * request/grant flow. A managed record is a flat the owner tracks privately and may never
         * advertise, so its papers live in their own table and are never shared. Routing them
         * through {@code {propId}} would have meant one path serving two audiences.
         *
         * <p>A literal segment, so like {@link #PERSONAL} and {@link #REQUESTS} it ranks above the
         * {@code {propId}} template and a property can never be called {@code managed}.
         */
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

        /**
         * Public but token-scoped — read the documents a grant unlocked. Anonymous by contract
         * ({@code security: []}) because the share link is forwarded to a lawyer or a banker who
         * has no PuneNest account; the unguessable, expiring token is the credential.
         */
        public static final String SHARED = BASE + "/shared";
    }

    /**
     * The buyer's own asks — the requester's half of {@link MeDocuments#REQUESTS} (D123).
     *
     * <p>Its own top-level nest rather than a member of {@link MeDocuments}, because that nest is
     * the <em>owner's</em> vault: every route under {@code /me/documents} is scoped to properties
     * the caller owns, and hanging a requester-scoped route off the same prefix would put two
     * different authorisation rules under one path. {@code /me/document-requests} is a sibling of
     * {@code /me/contact-requests}, which is the same shape on the other gate.
     */
    public static final class MeDocumentRequests {

        private MeDocumentRequests() {
        }

        /**
         * Buyer — every access request <em>they</em> wrote, newest first, paged. Never carries the
         * share token: the grant is delivered to the requester out of band, and a list endpoint
         * that echoed it would turn one leaked page into every unlocked vault.
         */
        public static final String BASE = "/me/document-requests";

        /**
         * Buyer — the documents one of their own granted requests unlocked, read while signed in.
         *
         * <p>The same rows {@link Documents#SHARED} returns, reached by a different proof. That
         * route is anonymous and authenticated by a bearer token in a URL fragment, because its
         * audience is a lawyer or a banker with no account here; this one is authenticated by the
         * caller's JWT, because its audience is the buyer who made the request and is already
         * signed in. Two credentials for one read is not duplication — it is the difference
         * between a link you forward and a page you own.
         *
         * <p><strong>Why this exists at all.</strong> Until it did, a granted buyer's only way in
         * was the token, and the token is shown to the <em>owner</em> so they can forward the link
         * deliberately. A buyer whose owner never forwarded it saw "Granted" and a dead end. The
         * fix is emphatically not to hand the buyer the token — see
         * {@link com.punenest.api.documents.request.DocumentRequestMapper#toRequesterDto} for why
         * that stays redacted — but to give them a read that needs no forwardable credential.
         *
         * <p>Requester-scoped, not owner-scoped: {@code {reqId}} is only accepted once the row's
         * {@code requester_id} matches the JWT, so this route can never widen into the owner's
         * vault the way a property-scoped one would.
         */
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

        /** The requester only — create a co-fill rent agreement and invite the second party. */
        public static final String CO_FILL_CREATE = BASE + "/co-fill";

        /** Staff/admin — drive the workflow. */
        public static final String STATUS = BY_ID + "/status";

        /** Customer or staff — the conversation on the request. */
        public static final String MESSAGES = BY_ID + "/messages";

        /** Customer or staff — attach a document to the request. */
        public static final String DOCS = BY_ID + "/docs";

        /**
         * Customer or staff — <strong>read-only</strong> progress against the named paperwork the
         * request needs (D120).
         *
         * <p>A sibling of {@link #DOCS} rather than a field on {@link #BY_ID} because it answers a
         * different question: {@code BY_ID} lists the files that <em>exist</em>, and the tracker's
         * document column has to show the ones that do <em>not</em>. Derived on read from the
         * request's own documents — nothing about a checklist is stored, so there is no second
         * source of truth to fall out of step with the vault.
         */
        public static final String CHECKLIST = BY_ID + "/checklist";

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

        /**
         * The requester only — name the other side of a co-filled agreement (D121).
         *
         * <p>A rent agreement is two people's paperwork, and every route above this one scopes to a
         * single requester. This is the route that makes the second person exist: it resolves a
         * mobile to an <em>account</em> and records an invitation to it. The mobile is not stored,
         * and there is deliberately no route that opens an invitation by its id — see
         * {@link #MY_INVITES}.
         */
        public static final String PARTIES = BY_ID + "/parties";

        /**
         * The requester only — take back an unanswered invitation (V107).
         *
         * <p>Nested under the request rather than hung off a top-level {@code /parties} collection,
         * because a party has no meaning apart from the matter it is on and the authorisation rule
         * is a fact about that matter.
         */
        public static final String PARTY_BY_ID = PARTIES + "/{partyId}";

        /** An accepted co-fill party — submit their section of the agreement details. */
        public static final String PARTY_DETAILS = BY_ID + "/party-details";

        /** The requester only — open checkout for a deferred co-fill request. */
        public static final String CHECKOUT = BY_ID + "/checkout";

        /**
         * Anyone on the request — mark the other side's messages seen (D121).
         *
         * <p>{@code POST} rather than {@code PATCH} on {@link #MESSAGES}: the reader is not editing
         * the messages, and the receipt is taken for the thread rather than message by message.
         */
        public static final String READ = BY_ID + "/read";

        /**
         * The invited person only — the invitations addressed to them (D121).
         *
         * <p>Under {@code /me} rather than as a link with a token in it, which is what the frontend
         * prototype sent over WhatsApp. An invitation reveals that a named person is arranging a
         * tenancy; the only safe address for it is the authenticated account it names.
         */
        public static final String MY_INVITES = "/me/service-request-invites";

        /** The invited person only — accept or decline. Accepting is what widens their read scope. */
        public static final String INVITE_DECISION = MY_INVITES + "/{partyId}";
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

        /**
         * Authenticated — what the caller is entitled to do: owner contacts and listing slots (D31b).
         *
         * <p>Beside {@link #SUBSCRIPTION} rather than under the contact gate because entitlements
         * are decided by what has been bought and earned, not by the feature that spends them. A
         * caller's contact allowance and their listing allowance come from the same subscription and
         * the same referrals, and the day a third thing becomes metered it belongs on this response
         * too.
         *
         * <p>Distinct from {@link #SUBSCRIPTION}: that reports a purchase, including a pending one
         * still awaiting payment; this reports capability, which a pending purchase does not confer.
         */
        public static final String ENTITLEMENTS = "/me/entitlements";
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
     * "Tell me when this service launches" — the one public write that reaches the ops board (D4).
     *
     * <p><strong>Deliberately not under {@link Tickets}.</strong> It creates a ticket, so the
     * obvious home is {@code /tickets/waitlist}; that would put an anonymous path inside a prefix
     * where everything else is ops-only. Prefix matchers are how security configuration is usually
     * written and usually corrected, and one {@code /tickets/**} added in either direction — opening
     * the board or closing the form — would be a one-line change with no test to fail. A separate
     * top-level path cannot be swept up by either edit. {@code /society-leads} sits outside
     * {@code /admin} for the same reason.
     */
    public static final class ServiceWaitlist {

        private ServiceWaitlist() {
        }

        /** Public and rate-limited per mobile; there is no read — see {@code TicketService}. */
        public static final String BASE = "/service-waitlist";
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

        /**
         * Staff/admin — tick one checklist line as checked, or untick it (D218).
         *
         * <p>Not participant-scoped, unlike the thread it sits beside: the checklist is the
         * reviewer's working record of what they have inspected, and an owner who could tick their
         * own would be marking their own homework.
         */
        public static final String VERIFICATION_CHECKLIST = PROPERTY_VERIFICATION + "/checklist";

        /**
         * The ownership gate (D190). GET is participant-scoped — an owner must be able to see which
         * of the three required facts their listing is still waiting on — while POST, which grants
         * the badge, is staff/admin. One path, two guards, so the mappings are method-level.
         */
        public static final String VERIFICATION_OWNERSHIP = PROPERTY_VERIFICATION + "/ownership";

        /** Staff/admin — record one document against the ownership gate (D190). */
        public static final String VERIFICATION_OWNERSHIP_EVIDENCE = VERIFICATION_OWNERSHIP + "/evidence";

        /** Staff/admin — list verification case files (D91). */
        public static final String ADMIN_PROPERTY_REVIEWS = "/admin/property-reviews";

        /**
         * The owner's own side of the same queue (D218).
         *
         * <p>Not a filter on {@link #ADMIN_PROPERTY_REVIEWS}: that route is guarded by
         * {@code properties:read}, and the whole point of this one is that it needs no back-office
         * grant at all — it is scoped by the caller's id, so there is nothing to leak. Same reason
         * every other {@code /me/**} route exists alongside its {@code /admin/**} counterpart.
         *
         * <p>It earns its place over N calls to {@code GET /properties/{id}/verification} because
         * the owner dashboard renders a status chip and an unread badge on every listing card at
         * once; without this, a twenty-listing dashboard is twenty requests.
         */
        public static final String ME_PROPERTY_REVIEWS = "/me/property-reviews";

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
         * Staff/admin — internal notes on one listing, person, review or report (D29).
         *
         * <p>Under {@code /admin} rather than hanging off each of the four families, which is the
         * shape the alternative would have taken: {@code /properties/{id}/notes},
         * {@code /users/{id}/notes}, {@code /reviews/{id}/notes} and {@code /reports/{id}/notes} —
         * four paths, four controllers and four chances for one of them to be guarded differently
         * from the rest. Notes are one thing with one audience and one permission atom, and the
         * routing table should say so.
         *
         * <p>The {@code /admin} prefix also does the same work it does for {@link #ADMIN_REVIEWS}:
         * {@code Properties#ANY_SINGLE} is the single-segment {@code permitAll} matcher for the
         * public listing read, and a notes route parked one segment from an anonymous one is a
         * standing invitation to a future matcher change that sweeps it in.
         *
         * <p>{@code entityType} is the contract's word for the kind — {@code property}, not
         * {@code listing}. See {@code NoteEntityTypes}.
         */
        public static final String NOTES_FOR_ENTITY = "/admin/notes/{entityType}/{entityId}";

        /**
         * Staff/admin — rewrite one note's text.
         *
         * <p>Two segments where {@link #NOTES_FOR_ENTITY} has three, so the two cannot collide.
         * There is no DELETE: a note is a record that somebody on the team knew something, and
         * withdrawing it is what an edit is for.
         */
        public static final String NOTE_BY_ID = "/admin/notes/{id}";

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
         * Staff/admin — the moderation console's headline counts, over every listing.
         *
         * <p>A separate route rather than a field on {@link #ADMIN_PROPERTIES}, because the two
         * answer different questions and only one of them pages. The queue read is clamped to 100
         * rows, so a console folding its own counters out of the returned page reports "how many
         * pending listings are in the newest hundred" under the label "Pending" — and the number
         * stops moving at exactly the backlog size that makes it worth reading.
         *
         * <p>Same guard as the queue ({@code properties:read}): the counts are a strictly coarser
         * view of rows that endpoint already returns, so a second, weaker lock on the same
         * cupboard would be no lock.
         */
        public static final String ADMIN_PROPERTIES_SUMMARY = ADMIN_PROPERTIES + "/summary";

        /**
         * Staff/admin — how much of their listing ceiling one owner is using.
         *
         * <p>Exists because the concierge desk stopped being refused by that ceiling. Posting on an
         * owner's behalf inherited the owner's freemium cap, which meant an operator on a call with
         * somebody who has three flats could record one of them; the exemption fixed that, and this
         * is the other half of it. The desk may now post past the plan, so the desk is told when it
         * is about to — the operator is the only person on the call in a position to raise an
         * upgrade, and a rule that is silently not enforced is worse than one that is enforced.
         *
         * <p>Under {@link #ADMIN_PROPERTIES} rather than beside the billing routes because the
         * question is "may this desk add another listing here", not "what is this person paying".
         * It answers with counts, never with a plan name or a price — the operator needs to know
         * there is a conversation, not what the account is worth.
         *
         * <p>Takes a {@code mobile} query parameter, like {@code POST} on the collection takes a
         * mobile in its body, and for the same reason: on a first call the owner has no account and
         * therefore no id.
         */
        public static final String ADMIN_PROPERTIES_OWNER_STANDING =
                ADMIN_PROPERTIES + "/owner-standing";

        /**
         * Staff/admin — move a staff-created listing along the owner hand-back funnel.
         *
         * <p>Under {@code /properties/{id}} rather than {@code /admin/properties/{id}} because it
         * acts on the listing itself, exactly like {@link #PROPERTY_STATUS} and
         * {@link #PROPERTY_FEATURED} beside it. {@code /admin/properties} is the collection an
         * operator browses and adds to; the per-listing verbs have always lived on the listing.
         */
        public static final String PROPERTY_PIPELINE = Properties.BY_ID + "/pipeline";

        /**
         * Staff/admin — chase this listing's owner, and the record of every previous chase.
         *
         * <p>{@code POST} composes a message from a template and hands back a link the staff
         * member's WhatsApp opens; {@code GET} is the outreach history the Follow-up tab renders.
         *
         * <p>Singular {@code /outreach} rather than {@code /messages}, because {@code /messages}
         * already means something on this platform — the buyer-owner conversation thread — and the
         * two are opposites. That one is a conversation between two users the platform merely
         * carries; this is the platform itself pursuing somebody who has not yet replied and may
         * never. Sharing a noun would invite sharing a surface.
         */
        public static final String PROPERTY_OUTREACH = Properties.BY_ID + "/outreach";

        /**
         * Ops — the demand board: every contact request on the platform, newest first.
         *
         * <p>Named for the console module rather than for the table, and it is the one route here
         * where those differ. There is no {@code enquiries} table; the console's Enquiries page was
         * a mock-side union of contact requests, chat threads, visits and deals. Three of those are
         * real and get a route each ({@link #ADMIN_VISITS}, {@link #ADMIN_DEALS}, and the
         * conversations surface under {@code conversations:read}); the fourth, {@code call}, never
         * existed. See {@code EnquiryBoardService}.
         *
         * <p>Read-only, and there is deliberately no write counterpart: every row belongs to two
         * other people, and the console's old "mark responded" / "close" buttons wrote the owner's
         * decision field with the operator's opinion.
         */
        public static final String ADMIN_ENQUIRIES = "/admin/enquiries";

        /** Ops — every site visit on the platform. Read-only; see {@link #ADMIN_ENQUIRIES}. */
        public static final String ADMIN_VISITS = "/admin/visits";

        /** Ops — every deal on the platform, the funnel's floor. Read-only. */
        public static final String ADMIN_DEALS = "/admin/deals";

        /**
         * Admin — one row of the demand board with the counterparty's mobile <strong>unmasked</strong>,
         * and never without an {@code audit_log} row (D25).
         *
         * <p><strong>These three routes reverse a decision this file used to state.</strong> The
         * board masked unconditionally, on the reasoning that an operator is party to none of these
         * conversations. That reasoning is still correct about the <em>list</em> and is why the list
         * still masks — what it got wrong is that "party to the conversation" is not the only
         * legitimate reason to hold someone's number. A support agent working "the buyer booked a
         * visit and nobody turned up" is not eavesdropping; they are doing the job the platform
         * asked them to do, and {@code 98XXXXX210} does not let them do it.
         *
         * <p>Three properties make that safe, and all three are load-bearing:
         *
         * <ol>
         *   <li><strong>It is a different door.</strong> A detail {@code GET} per row, never a
         *       {@code ?reveal=true} on the list — a parameter would make "show me every mobile on
         *       the platform" a single request, which is the shape of an export rather than of a
         *       support action. One id, one row, one audit entry.</li>
         *   <li><strong>Admin-only, on the same atom.</strong> The role term is raised to
         *       {@code admin} while {@code enquiries:read} is kept, exactly as {@code TIMELINE_READ}
         *       does. The board stays a floor tool; unmasking does not. No new atom is minted,
         *       because a new atom is a new checkbox on the permissions grid and this is not a new
         *       capability so much as a narrower audience for an existing one.</li>
         *   <li><strong>The audit write happens first.</strong> Before the response is composed, so
         *       a reveal cannot succeed unlogged. The row stores the <em>masked</em> number: the log
         *       records that a reveal occurred, not a second copy of the thing revealed.</li>
         * </ol>
         *
         * <p>Consumer-side contact reveals still go through {@code ContactGate}, and this is not a
         * way around it. That gate answers "has this viewer earned this number by relationship",
         * which an operator never has and never will; these routes answer a different question with
         * a different justification and leave a different trace.
         */
        public static final String ADMIN_ENQUIRY_BY_ID = ADMIN_ENQUIRIES + "/{id}";

        /** Admin — one site visit, visitor's mobile unmasked and audited. See {@link #ADMIN_ENQUIRY_BY_ID}. */
        public static final String ADMIN_VISIT_BY_ID = ADMIN_VISITS + "/{id}";

        /** Admin — one deal, counterparty's mobile unmasked and audited. See {@link #ADMIN_ENQUIRY_BY_ID}. */
        public static final String ADMIN_DEAL_BY_ID = ADMIN_DEALS + "/{id}";

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
         * Admin — read one conversation as a moderator, for a chat that has been reported (D53).
         *
         * <p><strong>Why this exists at all.</strong> {@code ConversationService.mine} admits
         * participants and nobody else, staff and admin included, so until now a reported chat could
         * not be read by the people asked to act on the report. That is the correct default and it
         * is not a workable end state: a harassment report about a message nobody may read is a
         * queue item that can only be closed by guessing.
         *
         * <p><strong>Why a separate path and not a role branch in the participant guard.</strong>
         * The register's D53 row names the failure directly — a role check hidden inside a
         * participant guard is how private surfaces quietly stop being private. Every future reader
         * of {@code mine} would have to notice the branch to know the surface is no longer
         * participants-only. Here the exemption is a route, with its own permission atom, its own
         * handler and an audit write that cannot be skipped, so it can be found by grep, revoked by
         * an admin, and counted in the log.
         *
         * <p>Deliberately {@code /admin/conversations/{id}} rather than a widening of
         * {@code GET /messages/{id}}: the public path is one segment from a participant-only read,
         * and the same distance argument that put {@link #ADMIN_REVIEWS} and
         * {@link #ADMIN_PROPERTIES} under {@code /admin} applies with more force to private
         * correspondence.
         */
        public static final String ADMIN_CONVERSATION = "/admin/conversations/{id}";

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

        /** Admin — remove an account from the directory (soft; never a hard delete). */
        public static final String ARCHIVE = BY_ID + "/archive";

        /** Admin — bring an archived account back into the directory. */
        public static final String RESTORE = BY_ID + "/restore";

        /**
         * Admin — stop an account obtaining a session, without removing it (V77).
         *
         * <p><strong>Not a synonym for {@link #ARCHIVE}, and the difference is the point.</strong>
         * Archiving is a soft delete: the row leaves the directory, its {@code archived} flag is
         * what every read path already filters on, and bringing it back is a restoration. Suspension
         * leaves the account exactly where it is, visibly marked, and only takes away the ability to
         * sign in. A moderator investigating a live account wants the second and has, until now, had
         * to reach for the first — which hides the very account they are investigating.
         *
         * <p>{@code PATCH} rather than {@code POST} because it is a state transition on the account
         * and it <em>is</em> idempotent: suspending a suspended account is a no-op, not a conflict.
         */
        public static final String SUSPEND = BY_ID + "/suspend";

        /** Admin — return a suspended account to {@code active}. Idempotent, like {@link #SUSPEND}. */
        public static final String REACTIVATE = BY_ID + "/reactivate";

        /**
         * Admin — grant or withdraw the L2 "Verified" badge by hand (V77).
         *
         * <p>The badge is normally earned through DigiLocker
         * ({@code identity.verification.VerificationService}), and that remains the only path that
         * sets {@code aadhaar_verified}. This route exists for the case the automated funnel cannot
         * reach: a person whose documents an administrator has checked off-platform. The two are
         * deliberately distinguishable on the wire — a hand-granted badge is
         * {@code verified && !aadhaarVerified} — so nothing has to trust a column to tell an
         * operator-asserted identity from a verified one.
         */
        public static final String BADGE = BY_ID + "/badge";

        /**
         * Admin — raise or lower the internal review flag (V77).
         *
         * <p>Under {@code /users/{id}} and not under {@code /admin} for the same reason as
         * {@link #PERMISSIONS}: the flag is a property of the account and dies with it.
         */
        public static final String FLAG = BY_ID + "/flag";

        /**
         * Admin — this person's activity across the platform, newest first (V77).
         *
         * <p>A read, not an action, and the only route here that reaches outside {@code users}: it
         * unions enquiries, visits, service requests, listings and moderation actions. Under the
         * account rather than under {@code /admin} because it is scoped to one person and answers
         * "who is this", which is the question the rest of this directory exists to support.
         */
        public static final String TIMELINE = BY_ID + "/timeline";

        /** Admin only — create a staff/admin account. The privilege-escalation surface. */
        public static final String STAFF = BASE + "/staff";

        /**
         * Admin only — the accounts minted through {@link #STAFF} that are still waiting for a
         * second administrator to approve them (D200).
         *
         * <p>A literal segment under {@code /users}, so it out-ranks the {@link #BY_ID} template on
         * Spring's {@code PathPattern} comparator the same way {@link #STAFF} does. It exists
         * because a maker-checker rule nobody can see the queue for is a rule that strands people:
         * the blocked colleague cannot sign in to say so, and the administrator who could unblock
         * them has no screen that lists who is waiting.
         */
        public static final String PENDING_APPROVALS = BASE + "/pending-approvals";

        /**
         * Admin only — turn the second key on an account minted by <em>another</em> administrator
         * (D200).
         *
         * <p>{@code POST} rather than {@code PATCH}: this is not an edit to a field of the account,
         * it is a decision recorded against it, and it is not idempotent — the second attempt is a
         * conflict, not a repeat.
         */
        public static final String APPROVE = BY_ID + "/approve";

        /**
         * Admin only — read or replace one back-office account's permission document (D192/D13).
         *
         * <p>Under {@code /users/{id}} rather than under {@code /admin} because the resource is the
         * account, not a platform setting: it is deleted when the account is, it is meaningless
         * without an account to name, and an operator looking for "what may this person do" looks
         * where they found the person.
         */
        public static final String PERMISSIONS = BY_ID + "/permissions";
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

        /**
         * Admin only — the same rows as {@link #AUDIT_LOG}, narrowed to back-office actors and
         * resolved to the person who acted rather than their id.
         *
         * <p>Not a second audit log and not a weaker one: it reads the same table under the same
         * {@code audit:read} permission, because a route that borrows another module's data inherits
         * that module's ceiling. What differs is the question. The audit log answers "what happened
         * to this record"; this answers "what has this colleague been doing", which is the review
         * question, and it is the only one of the two that needs a name attached.
         */
        public static final String STAFF_ACTIVITY = "/admin/staff-activity";

        /**
         * Admin only — totals, the per-entity split, the action vocabulary and the leaderboard for
         * the same window, aggregated in one round trip.
         *
         * <p>Separate from the feed because it is a different shape, and computed on the server
         * because a leaderboard built from one page of a feed ranks the page, not the team.
         */
        public static final String STAFF_ACTIVITY_SUMMARY = STAFF_ACTIVITY + "/summary";

        /** Staff/admin — the KPI scorecard. Revenue is blanked for staff; see {@code AdminKpis}. */
        public static final String DASHBOARD = "/admin/dashboard";

        /** Staff/admin — one metric, bucketed over a date range. */
        public static final String ANALYTICS = "/admin/analytics";

        /**
         * Staff/admin — live listings against recorded demand, per locality.
         *
         * <p>A sibling of {@link #ANALYTICS} rather than a metric inside it: every other analytics
         * series is one number over time, and this is two unrelated quantities compared across a
         * dimension that is not time. Squeezing it into {@code ?metric=} would have meant a series
         * endpoint that sometimes returns something that is not a series.
         *
         * <p>The demand half is the only place the anonymous {@code /demand-signals} writes can be
         * read, and it is aggregate-only by construction — see {@code SupplyGapRow}.
         */
        public static final String SUPPLY_GAP = "/admin/supply-gap";

        /**
         * Staff/admin — asking price against the locality's curated market rate.
         *
         * <p>A sibling of {@link #ANALYTICS} for the same reason {@link #SUPPLY_GAP} is: it compares
         * two quantities across locality, not one quantity over time, so {@code ?metric=} would
         * again have to return something that is not a series.
         *
         * <p>Both halves are already in the schema and neither is inferred: the asking side is
         * {@code properties.price / properties.area} over approved listings, and the market side is
         * {@code localities.rate_per_sqft} / {@code localities.avg_rent}, which are curated figures
         * the reference seed maintains. The tab this feeds used to compute the same comparison in
         * the browser against whatever that browser had loaded, which meant the deviation shown to
         * an operator depended on their scroll position.
         */
        public static final String ANALYTICS_PRICING = "/admin/analytics/pricing";

        /**
         * Staff/admin — moderation turnaround against the review SLA.
         *
         * <p><strong>Measured, not modelled.</strong> The tab this replaces generated every
         * turnaround from {@code rng(314159)}, so the "average approval time" an operator read was
         * a constant dressed as a measurement — it did not move when the team got faster or slower.
         *
         * <p>There is no {@code properties.reviewed_at} column and this deliberately does not add
         * one: {@code audit_log} already records a {@code property.status} row per decision, with
         * the actor and the timestamp, because {@code PropertyModerationService} writes one on every
         * transition. Turnaround is {@code properties.created_at} to the <em>first</em> such row for
         * that entity — first, because a re-approval is a later check on the same listing, not a
         * second first decision, and averaging it in would flatter the number.
         */
        public static final String ANALYTICS_SLA = "/admin/analytics/sla";

        /**
         * Staff/admin — how much traffic arrived, over time and by source.
         *
         * <p>The first of three siblings ({@link #ANALYTICS_ENGAGEMENT},
         * {@link #ANALYTICS_SURFERS}) reading the page-view rollup written from {@code /page-views}.
         * Siblings of {@link #ANALYTICS} rather than metrics inside it because each returns several
         * unrelated quantities in one document — a series, a source split and a device split — and
         * {@code ?metric=} promises exactly one.
         *
         * <p><strong>Reads the daily aggregates, never {@code page_views}.</strong> Raw views are
         * kept ninety days and the console's range picker offers a hundred and eighty, so a report
         * served from raw data would return half a window at its widest setting and would do it
         * silently — the chart rendering, the axis still claiming 180 days, the first three months
         * simply flat. The aggregates carry no identity, so neither the retention sweep nor an
         * erasure request can move a figure that has already been reported.
         */
        public static final String ANALYTICS_TRAFFIC = "/admin/analytics/traffic";

        /**
         * Staff/admin — what visitors did once they arrived: session depth, bounce rate, top pages.
         *
         * <p>The tab this replaces held no data at all. It took no props and every number in it was
         * a literal typed into JSX, so "average session duration" was a figure that could not change
         * no matter what visitors did.
         */
        public static final String ANALYTICS_ENGAGEMENT = "/admin/analytics/engagement";

        /**
         * Staff/admin — the signed-out majority: how many, on which pages, leaving from where.
         *
         * <p>Anonymous by construction, and not merely by omission: the aggregates behind it have no
         * identity column to select, so there is no query that could return a person here even if
         * one were written.
         *
         * <p>What it deliberately cannot answer is who came <em>back</em>. Session ids die with the
         * browser tab, so a returning visitor is indistinguishable from a new one — structurally
         * underivable rather than merely unimplemented, and the price of a token that cannot
         * accumulate into a profile.
         */
        public static final String ANALYTICS_SURFERS = "/admin/analytics/surfers";

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

        /**
         * Admin only — revenue per month, split by source (D235).
         *
         * <p>A sibling of {@link #FINANCE} rather than a shape inside it, for the reason
         * {@link #SUPPLY_GAP} is a sibling of {@link #ANALYTICS}: {@code /admin/finance} answers
         * "where is the money now" in one object, and this answers "how did it get there" as a
         * list. Folding a 24-element array into the overview would make every reader of a single
         * KPI pay for two years of history.
         *
         * <p>And <em>not</em> {@code /admin/analytics?metric=revenue}, which already exists and is
         * staff-visible: that one returns a single total per bucket, deliberately, because the
         * scorecard charts one line. Splitting it by source there would either widen a
         * staff-readable response to carry the revenue mix — re-opening the door
         * {@link #FINANCE} closes — or make one operation return two different shapes.
         */
        public static final String FINANCE_SERIES = FINANCE + "/series";

        /**
         * Admin only — the settlement ledger, paged (D235).
         *
         * <p>Every row is a movement of money the platform can evidence: a rent convenience fee, a
         * paid subscription, a paid boost. It is deliberately <em>not</em> a list of everything that
         * happened commercially — a deal closing off-platform and a service quote are business
         * events with no receipt behind them, and a finance ledger that mixes the two cannot be
         * reconciled against a bank statement, which is the only thing it is for.
         *
         * <p>Paged for the reason {@link #SUPPORT_TICKETS} is: unpaged, this is every transaction
         * the platform has ever recorded, returned to a browser in one response.
         */
        public static final String FINANCE_TRANSACTIONS = FINANCE + "/transactions";

        /** Admin only — the platform configuration document. GET reads it, PUT merges into it. */
        public static final String SETTINGS = "/admin/settings";

        /** Admin only — one curated city's launch state. */
        public static final String CITY_BY_SLUG = "/admin/cities/{slug}";

        /**
         * Admin only — every per-account permission the server actually enforces (D192/D13).
         *
         * <p>Served rather than hard-coded in the console so that the grid an administrator ticks
         * cannot offer a permission the server would ignore. That divergence is what {@code V61}
         * had to clean up: the console composed bundles from its own module list, the server spoke
         * a different vocabulary, and the document in between granted nothing.
         */
        public static final String PERMISSION_CATALOGUE = "/admin/permission-catalogue";

        /**
         * Staff/admin — the outreach template library, filtered by channel.
         *
         * <p>Served rather than bundled for the same reason as {@link #PERMISSION_CATALOGUE}: a list
         * the console holds its own copy of is a list that drifts. Here the drift would be worse
         * than a stale label, because the console does not merely display these — it picks one by
         * id and asks the server to render it. A template the bundle knows about and the database
         * does not is a send that fails at the last step, in front of an owner on the phone.
         */
        public static final String MESSAGE_TEMPLATES = "/admin/message-templates";

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
     * Anonymous demand telemetry: what people looked for, whether or not the platform had it.
     *
     * <p>Not under {@code /admin} for the same reason {@link SocietyLeads} is not — the write comes
     * from a public surface, and in this case from a visitor who may well be about to leave. Not
     * under {@code /me} either, because the row belongs to nobody: it is deliberately anonymous, and
     * a {@code /me} route would promise a reader that they can see and manage their own signals,
     * which is the opposite of the design.
     */
    public static final class DemandSignals {

        private DemandSignals() {
        }

        /** POST is public and capped per IP by {@code WriteRateLimitFilter}. There is no GET. */
        public static final String BASE = "/demand-signals";
    }

    /**
     * Page-view telemetry: which routes were rendered, grouped into browsing sessions.
     *
     * <p><strong>Not to be confused with {@link Visits}</strong>, which is a person going to look at
     * a property in the physical world. These are pages rendered in a browser. The two words mean
     * different things on this platform, so this one says {@code page-view} everywhere and never
     * {@code visit} — including in its table names.
     *
     * <p>Beside {@link DemandSignals} rather than under {@code /admin} for the same reason — the
     * write comes from a public surface, and the visitors it most needs to hear from are the ones
     * who never signed in. Not under {@code /me} either: a page view belongs to nobody, and a
     * {@code /me} route would promise a reader they can see and manage their own browsing history,
     * which is the opposite of a table designed so that nothing can read it back per person.
     */
    public static final class PageViews {

        private PageViews() {
        }

        /**
         * POST is public and capped per IP by {@code WriteRateLimitFilter}; the client batches so
         * that a beacon cannot spend a visitor's whole write budget. There is no GET — reads are
         * the daily aggregates under {@code /admin/analytics}.
         */
        public static final String BASE = "/page-views";
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
