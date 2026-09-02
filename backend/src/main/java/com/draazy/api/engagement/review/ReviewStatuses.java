package com.draazy.api.engagement.review;

/**
 * The {@code reviews.status} vocabulary — the moderation state a review is in.
 *
 * <p>Only {@link #PUBLISHED} rows are ever returned by the public read. The other two exist in the
 * schema because moderation is a real product surface (the Moderation tag), and this slice must not
 * expose a row that a future moderator has held back or rejected. Writing them down now costs one
 * class and means the read filter is expressed in the vocabulary rather than as a bare string.
 */
public final class ReviewStatuses {

    private ReviewStatuses() {
    }

    /** Awaiting moderation. Never returned by the public read. */
    public static final String PENDING = "pending";

    /** Visible. The default, and the only status this slice writes. */
    public static final String PUBLISHED = "published";

    /** Rejected by a moderator. Never returned by the public read. */
    public static final String REJECTED = "rejected";
}
