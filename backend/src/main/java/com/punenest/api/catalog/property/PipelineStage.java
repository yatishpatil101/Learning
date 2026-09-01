package com.punenest.api.catalog.property;

import java.util.List;

/**
 * The six stages of the post-on-behalf onboarding funnel, in order.
 *
 * <p><strong>What this tracks.</strong> Staff sometimes create a listing <em>for</em> an owner —
 * typically after a phone call, from photographs and details the owner sent over WhatsApp. That
 * listing starts life owned by an account the owner has never signed into. The pipeline is the
 * record of handing it back: documents arrive, photographs are uploaded, identity is checked, a
 * claim link goes out, and finally the owner claims the account. Until the last stage the platform
 * is publishing a listing on behalf of somebody who cannot yet edit it, which is a liability with a
 * clock on it, and the board exists so nobody forgets a half-onboarded owner.
 *
 * <p><strong>Why these six names and not the console's.</strong> The admin console shipped a board
 * labelled {@code contacted, info_collected, listed, docs_submitted, under_review, live}, which
 * agrees with this list on exactly two entries. That vocabulary cannot live on a property row:
 * {@code contacted} and {@code info_collected} describe work done <em>before</em> a listing exists,
 * so there is no row to carry them, and {@code under_review}/{@code live} are {@code status} under
 * different names — a listing would then have two disagreeing opinions about whether it is public.
 * The column, its {@code CHECK} constraint, its partial index and the published contract all
 * already agreed on the list below; the board was the outlier.
 *
 * <p><strong>Why the ordering is the point.</strong> The contract also declares
 * {@code claimLinkSent}, {@code photosUploaded} and {@code aadhaarVerified} as booleans. They are
 * not stored: each one is "has the pipeline reached this stage", and storing them alongside the
 * stage would let the two disagree — a row claiming {@code claimed} with
 * {@code photosUploaded: false} is unanswerable, and somebody would have to decide which half to
 * believe. {@link #reached} derives them from the single stored fact instead.
 */
public final class PipelineStage {

    /** Staff created the listing; nothing has come back from the owner yet. */
    public static final String LISTED = "listed";

    /** Ownership paperwork received. */
    public static final String DOCS_SUBMITTED = "docs_submitted";

    /** Photographs received and attached to the listing. */
    public static final String PHOTOS_UPLOADED = "photos_uploaded";

    /** The owner's identity has been checked. */
    public static final String AADHAAR_VERIFIED = "aadhaar_verified";

    /** The claim link has gone out to the owner. */
    public static final String CLAIM_SENT = "claim_sent";

    /** The owner has signed in and taken ownership. The funnel is finished. */
    public static final String CLAIMED = "claimed";

    /**
     * The stages in funnel order. Order is load-bearing — see {@link #reached}. The list matches
     * {@code properties_pipeline_stage_check} in V3 exactly; a value absent here would be rejected
     * by Postgres on write, so this is the constraint restated where Java can see it.
     */
    public static final List<String> ORDER = List.of(
            LISTED, DOCS_SUBMITTED, PHOTOS_UPLOADED, AADHAAR_VERIFIED, CLAIM_SENT, CLAIMED);

    private PipelineStage() {
    }

    /** Whether {@code stage} is one of the six. Anything else is a client error, not a new stage. */
    public static boolean isValid(String stage) {
        return ORDER.contains(stage);
    }

    /**
     * Whether a listing at {@code stage} has passed {@code milestone}.
     *
     * <p>A null stage means the funnel has not started, which has reached nothing. An unrecognised
     * stage is treated the same way rather than throwing: this is a read path, and a row that
     * somehow holds a value the constraint should have refused is better rendered as "no progress"
     * than turned into a 500 on a page that was only trying to draw a checkmark.
     */
    public static boolean reached(String stage, String milestone) {
        int at = ORDER.indexOf(stage);
        return at >= 0 && at >= ORDER.indexOf(milestone);
    }
}
