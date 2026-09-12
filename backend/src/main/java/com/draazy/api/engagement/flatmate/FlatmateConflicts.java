package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.error.ConflictException;

/**
 * The 409 sub-codes the flatmate doors answer with, and the one place they are spelled.
 *
 * <p><strong>Why a sub-code exists at all.</strong> {@link ConflictException} fixes
 * {@code ErrorCodes.CONFLICT}, so every 409 in this domain reaches the client as
 * {@code error: "conflict"}. Two of them mean opposite things and need opposite treatment on screen:
 * {@code already_interested} is benign — the host already has the ask, and the button the requester
 * just pressed was right to be pressed once — while {@code group_full} is a genuine refusal that
 * also tells the board its seat count is stale. The envelope cannot tell them apart, so the reason
 * travels as a marker appended to the message and the client lifts it back out.
 *
 * <p><strong>Why the marker has to be last, and why that is enforced here rather than trusted.</strong>
 * The client's parser (`conflictSubCode` in {@code frontend/src/services/providers/http/flatmateMapper.js})
 * anchors on {@code /\s*\(([a-z_]+)\)\s*$/} — an <em>end-anchored</em> pattern, deliberately, so
 * that prose containing an incidental bracketed word cannot be mistaken for a routing token. That
 * makes "the marker is the last thing in the string" a wire contract, and it used to be upheld by
 * three separate hand-typed literals in two services (D182). Appending a full stop, a trace hint or
 * an i18n wrapper to any one of them would have passed the whole backend suite and quietly turned
 * the benign duplicate back into a red "something went wrong" on the client. Here the call sites
 * hand over prose and this class owns the append, so there is no longer a place to append *after*
 * the marker without editing this file — and the tests that pin the invariant sit next to it.
 *
 * <p>Package-visible on purpose. These markers are an internal routing token between these services
 * and the client that reads them; nothing else in the backend has any business producing one. The
 * flatmate tests share this package, so pinning the contract costs no widening.
 *
 * <p>Strings rather than an enum, for the same reason {@link FlatmateVocabulary} uses strings: the
 * value crosses the wire verbatim and appears in the contract, so an enum would only add a mapping
 * layer whose whole job is to reproduce the string it was given.
 */
final class FlatmateConflicts {

    private FlatmateConflicts() {
    }

    /**
     * The requester has already asked this host, through any of the three doors.
     *
     * <p>Declared on {@code flatmatePostInterest}, {@code flatmateRoomInterest} and
     * {@code flatmateGroupJoin}; the row they collide on is the same row in every case.
     */
    static final String ALREADY_INTERESTED = "already_interested";

    /** The last seat went while the board the requester is looking at was on screen. */
    static final String GROUP_FULL = "group_full";

    /**
     * The host is holding {@code MAX_ACTIVE_HOST_POSTS} live posts already — the anti-broker cap.
     *
     * <p>Named for the rule rather than the remedy, because the remedy differs by surface: the
     * board offers "fill or close one", the dashboard can offer the list to close one *from*.
     */
    static final String HOST_CAPPED = "host_capped";

    /** This host already has a live post against the same address fingerprint. */
    static final String DUPLICATE_ADDRESS = "duplicate_address";

    /**
     * The host has already accepted or declined, so the ask is no longer the requester's to retract.
     *
     * <p>Distinct from a 403 on purpose: the row does belong to the caller, and it is its state that
     * refuses. The client needs to tell those apart to choose between "this isn't yours" and
     * "too late — they've answered", which are different sentences and different next steps.
     */
    static final String ALREADY_DECIDED = "already_decided";

    /**
     * The room's address belongs to the flat it was split out of, so it is not editable here.
     *
     * <p>Already the sub-code the delete path answers with for the same room, which is why it is
     * spelled the same way rather than {@code not_editable}: the client's handling is identical and
     * the reason is identical \u2014 this row is a projection of a property.
     */
    static final String SPLIT_ROOM = "split_room";

    /**
     * A refusal whose reason the client can route on: the prose, then the marker, in that order.
     *
     * <p>The prose is stripped first so that a trailing space in a call site's literal cannot open a
     * gap the client's pattern would still tolerate but a stricter future one might not.
     */
    private static ConflictException marked(String prose, String subCode) {
        return new ConflictException(prose.strip() + " (" + subCode + ")");
    }

    /**
     * The 409 for a repeat ask.
     *
     * <p>Each door supplies its own sentence, because "this post" and "this host" are not the same
     * thing to the person reading it — but they all say the earlier ask survived, which is what the
     * requester actually wants to know after a refused press.
     */
    static ConflictException alreadyInterested(String prose) {
        return marked(prose, ALREADY_INTERESTED);
    }

    /** The 409 for a group whose seats have gone. */
    static ConflictException groupFull(String prose) {
        return marked(prose, GROUP_FULL);
    }

    /**
     * The marker for a guardrail refusal, chosen from what the guardrail actually decided.
     *
     * <p>The eligibility record has carried {@code overCap} and {@code duplicate} as booleans in the
     * 409 body since it was written, so this reason was already machine-readable — through a second
     * mechanism, in a second place, that the client's {@code conflictSubCode} parser does not look
     * at. Two ways to ask "why was this refused" is one too many: a caller that learned the marker
     * from the interest doors would read this 409 and find nothing, and conclude the refusal had no
     * reason. The booleans stay (they are the contract for this body); this only makes the same
     * facts answer the same question the same way.
     *
     * <p>{@code overCap} is tested first because both can be true at once and the cap is the one the
     * host can act on — being told to close a post is useful, being told this address is taken when
     * the real block is the cap sends them to fix the wrong thing.
     */
    static String guardrailSubCode(boolean overCap, boolean duplicate) {
        if (overCap) {
            return HOST_CAPPED;
        }
        return duplicate ? DUPLICATE_ADDRESS : null;
    }

    /** Append a marker that was chosen elsewhere, for callers that already know their sub-code. */
    static String mark(String prose, String subCode) {
        return subCode == null ? prose.strip() : prose.strip() + " (" + subCode + ")";
    }
}
