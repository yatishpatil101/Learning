package com.draazy.api.catalog.property;

import java.util.List;

/** Whose interest a listing represents - distinct from the {@code owner} role, which says what an account may do. */
public final class PostedByType {

    /** The owner themselves. The only value the self-serve wizard can produce. */
    public static final String OWNER = "owner";

    /** A broker listing somebody else's property, so a brokerage is in play. */
    public static final String AGENT = "agent";

    /** A developer listing their own inventory: not an owner resale, not a brokerage either. */
    public static final String BUILDER = "builder";

    /** Restates {@code properties_posted_by_type_check} (V04) where Java can see it. */
    public static final List<String> ALL = List.of(OWNER, AGENT, BUILDER);

    private PostedByType() {
    }
}
