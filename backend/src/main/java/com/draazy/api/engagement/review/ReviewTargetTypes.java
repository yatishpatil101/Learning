package com.draazy.api.engagement.review;

import java.util.Set;

/**
 * The {@code reviews.target_type} vocabulary, and the rule about which route may write which.
 *
 * <p>String constants rather than a Java enum, per api-standards.md §7.1: these values are the
 * contract's, they are persisted as text, and an enum would add a translation layer whose only
 * effect is to turn an unexpected value from a cleanly rejected request into a deserialisation
 * crash.
 *
 * <p>The split below is not a local convention — it is the contract's. {@code /reviews/{entityType}}
 * declares {@code enum: [society, locality, owner]}, which is disjoint from the {@code property}
 * target that {@code /properties/{propId}/reviews} writes. That disjointness is why these are two
 * resources with two controllers rather than one generic one: only a property review can carry a
 * visit-or-tenancy badge, because only a property is something you can visit or live in.
 */
public final class ReviewTargetTypes {

    private ReviewTargetTypes() {
    }

    /** A specific listing. Written only by the {@code /properties/{propId}/reviews} route. */
    public static final String PROPERTY = "property";

    /** A neighbourhood, keyed by its slug. */
    public static final String LOCALITY = "locality";

    /** A housing society, keyed by its id. */
    public static final String SOCIETY = "society";

    /** A listing owner, keyed by their user id. */
    public static final String OWNER = "owner";

    /** The three the entity route accepts, exactly as the contract enumerates them. */
    public static final Set<String> ENTITY_TARGETS = Set.of(LOCALITY, SOCIETY, OWNER);

    /** True if {@code value} is one of the three targets the entity-review route may address. */
    public static boolean isEntityTarget(String value) {
        return value != null && ENTITY_TARGETS.contains(value);
    }
}
