package com.draazy.api.catalog.property;

import java.util.List;

/**
 * The two funnels a staff-posted listing moves along. Two lists because a row sits on both axes at
 * once; {@code under_review} and {@code live} stay on {@code status} so nothing can hold two opinions.
 */
public final class PipelineStage {

    // ---- Acquisition funnel: getting to a listing ---------------------------------------------

    /**
     * Staff have spoken to the owner and nothing has come back yet. The stub row stays pending, so
     * nothing is published on the strength of a phone call.
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
    public static final String IDENTITY_VERIFIED = "identity_verified";

    /** The claim link has gone out to the owner. */
    public static final String CLAIM_SENT = "claim_sent";

    /** The owner has signed in and taken ownership. The hand-back is finished. */
    public static final String CLAIMED = "claimed";

    /**
     * The acquisition stages in order — {@code properties_pipeline_stage_check} (V92) restated where
     * Java can see it.
     */
    public static final List<String> ORDER = List.of(
            CONTACTED, INFO_COLLECTED, LISTED, DOCS_SUBMITTED);

    /**
     * The hand-back milestones in order. Matches {@code properties_handback_milestone_check} in
     * V92 exactly. Order is load-bearing — see {@link #reached}.
     */
    public static final List<String> HANDBACK_ORDER = List.of(
            PHOTOS_UPLOADED, IDENTITY_VERIFIED, CLAIM_SENT, CLAIMED);

    private PipelineStage() {
    }

    /**
     * Whether {@code stage} names an acquisition stage. The null check is load-bearing:
     * {@code List.of(...).contains(null)} throws rather than answering false, and the column is nullable.
     */
    public static boolean isValid(String stage) {
        return stage != null && ORDER.contains(stage);
    }

    /** Whether {@code milestone} names a hand-back milestone. Null-safe, for the reason above. */
    public static boolean isHandback(String milestone) {
        return milestone != null && HANDBACK_ORDER.contains(milestone);
    }

    /**
     * Whether {@code value} names a point on either funnel. The vocabularies are disjoint, so one
     * route, one permission and one audit action cover what the desk experiences as a single act.
     */
    public static boolean isKnown(String value) {
        return isValid(value) || isHandback(value);
    }

    /**
     * Whether a hand-back at {@code milestone} has passed {@code target}. Null or unrecognised reads
     * as "no progress" — a read path drawing a checkmark must not turn a bad row into a 500.
     */
    public static boolean reached(String milestone, String target) {
        if (milestone == null) {
            return false;
        }
        int at = HANDBACK_ORDER.indexOf(milestone);
        return at >= 0 && at >= HANDBACK_ORDER.indexOf(target);
    }
}
