package com.draazy.api.moderation.duplicate;

import com.draazy.api.catalog.property.PropertyResponse;
import java.util.List;

/**
 * One derived cluster of listings that look like the same doorway.
 *
 * <p>Not a stored row. The cluster is computed from live signals on every request, so this record
 * exists only for the length of one response — see {@link ListingDuplicateClusterService}.
 *
 * @param id        the cluster's {@link DuplicateClusterSignature}, which is also what a dismissal
 *                  is keyed on. Doubles as the render key; there is no other stable identity a
 *                  derived cluster could offer.
 * @param reason    which arm fired: {@code address}, {@code image}, or {@code address+image}.
 *                  Sorted and joined so the value is deterministic — the prototype joined in
 *                  encounter order and therefore emitted both {@code address+image} and
 *                  {@code image+address}, which the console had to carry two labels for.
 * @param sameOwner every listing here belongs to one account. Surfaced rather than filtered, and
 *                  the console says so on the card: same-owner collisions are usually an owner who
 *                  forgot they had already posted, which is a nudge rather than a moderation case.
 *                  See {@link ListingDuplicateClusterService} for why this desk sees them at all
 *                  when {@code findDuplicateCandidates} deliberately does not.
 * @param listings  the members, newest first.
 */
public record DuplicateCluster(
        String id,
        String reason,
        boolean sameOwner,
        List<PropertyResponse> listings) {

    /** The doorway arm: a shared electricity meter, or a shared address key within one locality. */
    public static final String REASON_ADDRESS = "address";

    /** The photo arm: two listings showing the same photograph, verified with {@code sameShot}. */
    public static final String REASON_IMAGE = "image";

    /**
     * Both arms fired somewhere in the cluster.
     *
     * <p>Note "somewhere": a cluster's reason is the union over its pairs, not a property of any one
     * pair. {A,B} matching on address and {B,C} on photos yields one cluster reading
     * {@code address+image} in which no single pair matched on both. That is the honest rendering —
     * the operator is being shown a component, and the component really was joined by both kinds of
     * evidence.
     */
    public static final String REASON_BOTH = REASON_ADDRESS + "+" + REASON_IMAGE;
}
