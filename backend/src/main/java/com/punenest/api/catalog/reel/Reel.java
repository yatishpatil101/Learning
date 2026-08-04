package com.punenest.api.catalog.reel;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;

/**
 * A short-video property clip in the discovery feed (V3 {@code reels}).
 *
 * <p><strong>Why the fields are copies and not joins.</strong> {@code title}, {@code locality},
 * {@code price} and {@code deal} duplicate what {@code listing_id} points at, and that is
 * deliberate: a reel is a piece of published content, and it must keep saying what it said when it
 * was filmed. If the owner later re-prices the flat, the clip's caption should not silently change
 * underneath a video that shows the old number. {@code listing_id} is also nullable, so a reel can
 * outlive the listing it was made for — which is exactly when the copies stop being redundant.
 *
 * <p>Read-only here: rows are seeded, and creating reels is a content-tooling surface the contract
 * does not expose. No setters.
 */
@Entity
@Table(name = "reels")
@Getter
public class Reel extends AuditedEntity {

    /** The listing this was filmed at, if it still exists. Nullable by design — see the class note. */
    @Column(name = "listing_id")
    private UUID listingId;

    @Column(name = "title")
    private String title;

    /**
     * The locality as it was captioned, e.g. {@code Hinjawadi} — a display label, not a slug, because
     * that is what the clip says on screen. The feed filter matches it case-insensitively so a caller
     * passing either casing gets the same feed.
     */
    @Column(name = "locality")
    private String locality;

    /** Whole rupees. {@code bigint} — money is never a floating-point number. */
    @Column(name = "price")
    private Long price;

    /** {@code buy} or {@code rent}; the column's CHECK constraint is the authority. */
    @Column(name = "deal")
    private String deal;

    @Column(name = "poster")
    private String poster;

    @Column(name = "video")
    private String video;

    @Column(name = "likes", nullable = false)
    private int likes;

    @Column(name = "views", nullable = false)
    private int views;

    @Column(name = "tag")
    private String tag;

    protected Reel() {
        // JPA
    }

}
