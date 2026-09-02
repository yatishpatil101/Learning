package com.draazy.api.catalog.property;

import java.util.List;

/**
 * The two funnels a staff-posted listing moves along, each an ordered list of stages.
 *
 * <p><strong>What this tracks.</strong> Staff sometimes create a listing <em>for</em> an owner —
 * typically after a phone call, from photographs and details the owner sent over WhatsApp. That
 * listing starts life owned by an account the owner has never signed into. Until the owner claims
 * it the platform is publishing on behalf of somebody who cannot yet edit it, which is a liability
 * with a clock on it, and the board exists so nobody forgets a half-onboarded owner.
 *
 * <p><strong>Why two lists and not one (D27).</strong> V3 gave the property row a single
 * {@code pipeline_stage} holding six values; the admin console shipped a board holding six
 * <em>different</em> values, agreeing on exactly two. That was never a naming disagreement. The
 * console's early values answer <em>"how far has this owner got towards us having a listing at
 * all"</em>; the server's late values answer <em>"how far have we got towards giving the listing
 * back"</em>. Those are independent questions and a row is at a point on both at once — a listing
 * whose documents are in and whose photographs are up is {@code docs_submitted} on one axis and
 * {@code photos_uploaded} on the other. One column cannot hold both, so whichever question was
 * written last silently erased the other. V92 split them into {@code pipeline_stage} and
 * {@code handback_milestone}, and this class is that split restated where Java can see it.
 *
 * <p><strong>Why {@code under_review} and {@code live} are in neither list.</strong> They are the
 * two console values that did not survive. They are {@code status} under different names, and a row
 * carrying both would hold two opinions about whether it is public — the moment they disagreed
 * somebody would have to decide which half to believe. The board still shows six columns; it
 * derives the last two from {@code status} instead of storing them, so they cannot drift.
 *
 * <p><strong>Why the ordering is the point.</strong> The contract declares {@code claimLinkSent},
 * {@code photosUploaded} and {@code aadhaarVerified} as booleans. They are not stored: each one is
 * "has the hand-back reached this milestone", and storing them alongside the milestone would let
 * the two disagree — a row claiming {@code claimed} with {@code photosUploaded: false} is
 * unanswerable. {@link #reached} derives them from the single stored fact instead.
 */
public final class PipelineStage {

    // ---- Acquisition funnel: getting to a listing ---------------------------------------------

    /**
     * Staff have spoken to the owner and nothing has come back yet. The row exists — it has to, for
     * the board to remember the conversation — but it is a stub the owner has never seen and is
     * pending, so nothing is published on the strength of a phone call.
     */
    public static final String CONTACTED = "contacted";

    /** Enough detail has come back to draft the listing properly. Still not published. */
    public static final String INFO_COLLECTED = "info_collected";

    /** Staff created the listing; nothing has come back from the owner since. */
    public static final String LISTED = "listed";

    /** Ownership paperwork received. The acquisition funnel ends here. */
    public static final String DOCS_SUBMITTED = "docs_submitted";

    // ---- Hand-back axis: giving the listing to its owner --------------------------------------

    /** Photographs received and attached to the listing. */
    public static final String PHOTOS_UPLOADED = "photos_uploaded";

    /** The owner's identity has been checked. */
    public static final String AADHAAR_VERIFIED = "aadhaar_verified";

    /** The claim link has gone out to the owner. */
    public static final String CLAIM_SENT = "claim_sent";

    /** The owner has signed in and taken ownership. The hand-back is finished. */
    public static final String CLAIMED = "claimed";

    /**
     * The acquisition stages in order. Matches {@code properties_pipeline_stage_check} in V92
     * exactly; a value absent here would be rejected by Postgres on write, so this is the
     * constraint restated where Java can see it.
     */
    public static final List<String> ORDER = List.of(
            CONTACTED, INFO_COLLECTED, LISTED, DOCS_SUBMITTED);

    /**
     * The hand-back milestones in order. Matches {@code properties_handback_milestone_check} in
     * V92 exactly. Order is load-bearing — see {@link #reached}.
     */
    public static final List<String> HANDBACK_ORDER = List.of(
            PHOTOS_UPLOADED, AADHAAR_VERIFIED, CLAIM_SENT, CLAIMED);

    private PipelineStage() {
    }

    /**
     * Whether {@code stage} names an acquisition stage.
     *
     * <p>The explicit null check is not defensive noise. {@code List.of(...)} returns an immutable
     * list whose {@code contains} <em>throws</em> {@link NullPointerException} on a null argument
     * rather than answering false, which is the opposite of what every caller here assumes: the
     * column is nullable, so "is this null value a stage" is an ordinary question with an ordinary
     * answer.
     */
    public static boolean isValid(String stage) {
        return stage != null && ORDER.contains(stage);
    }

    /** Whether {@code milestone} names a hand-back milestone. Null-safe, for the reason above. */
    public static boolean isHandback(String milestone) {
        return milestone != null && HANDBACK_ORDER.contains(milestone);
    }

    /**
     * Whether {@code value} names a point on either funnel.
     *
     * <p>The write route takes one {@code stage} field and decides which column it belongs to from
     * the value itself, because the two vocabularies are disjoint and every name is unambiguous.
     * That keeps one route, one permission and one audit action for what a desk experiences as a
     * single act — moving a listing along.
     */
    public static boolean isKnown(String value) {
        return isValid(value) || isHandback(value);
    }

    /**
     * Whether a hand-back at {@code milestone} has passed {@code target}.
     *
     * <p>A null milestone means the hand-back has not started, which has reached nothing. An
     * unrecognised value is treated the same way rather than throwing: this is a read path, and a
     * row that somehow holds a value the constraint should have refused is better rendered as "no
     * progress" than turned into a 500 on a page that was only trying to draw a checkmark.
     *
     * <p>The null check has to be explicit and this is where that was learned the hard way. The
     * first version leaned on {@code indexOf} returning -1, which is true of an {@code ArrayList}
     * and false of the immutable list {@code List.of} produces — that one throws on null. Since a
     * null milestone is the normal state of every listing whose owner has not started handing
     * anything back, the moderation queue answered 500 for the majority case while every unit test
     * passed, because none of them asked about a listing that had not begun.
     */
    public static boolean reached(String milestone, String target) {
        if (milestone == null) {
            return false;
        }
        int at = HANDBACK_ORDER.indexOf(milestone);
        return at >= 0 && at >= HANDBACK_ORDER.indexOf(target);
    }
}
