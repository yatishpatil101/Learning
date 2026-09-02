package com.draazy.api.engagement.society;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;

/**
 * One post on a society's community tab (V103 {@code society_contributions}).
 *
 * <p>Three kinds share this table because they share a page, an author, a moderation rule and a
 * "helpful" button: a <strong>tip</strong> is prose, a <strong>pick</strong> is a person the
 * building actually uses, and a <strong>photo</strong> is the place as it really looks. What
 * differs between them is structure, not behaviour — so {@code body} carries the prose in all
 * three cases (the tip, the pick's note, the photo's caption) and the kind-specific fields sit
 * alongside it under a two-sided check constraint.
 *
 * <p><strong>Why a tip is not resident-gated.</strong> Somebody who lived here for six years and
 * moved out last month is exactly the person whose tip is worth reading, and a departing resident
 * loses their verified badge the moment the committee updates the register. Residency is published
 * as a badge on the post rather than enforced as a gate in front of it. The noticeboard is the
 * opposite (see {@link SocietyBoardItem}) because a notice asserts something about the building
 * rather than reporting an experience of it.
 *
 * <p><strong>{@code referralContact} is a third party's phone number.</strong> The plumber never
 * agreed to appear on the open web, so the service withholds it from an unauthenticated read even
 * though the rest of the post is public. Signing in costs a genuine neighbour one tap and costs a
 * bulk scraper the entire exercise.
 *
 * <p><strong>{@code photoUrl} is a URL, never a data URI.</strong> The browser build kept base64 in
 * {@code localStorage}, which is why a shared photo was invisible on the author's own phone and why
 * the composer needed a "too large" warning at all. Images now go through {@code POST /me/photos}.
 */
@Entity
@Table(name = "society_contributions")
@Getter
public class SocietyContribution extends AuditedEntity {

    @Column(name = "society_id", nullable = false, updatable = false)
    private UUID societyId;

    /**
     * When a moderator took this off the public site, or null. The row survives a removal because
     * the complaint was about its contents — destroying them destroys the appeal.
     */
    @Column(name = "removed_at")
    private java.time.Instant removedAt;

    /** The moderator who removed it. Paired with {@code removedAt} by a CHECK constraint. */
    @Column(name = "removed_by")
    private UUID removedBy;

    @Column(name = "author_id", nullable = false, updatable = false)
    private UUID authorId;

    @Column(name = "kind", nullable = false, updatable = false)
    private String kind;

    @Column(name = "category")
    private String category;

    @Column(name = "body")
    private String body;

    @Column(name = "referral_name")
    private String referralName;

    @Column(name = "referral_contact")
    private String referralContact;

    @Column(name = "photo_url")
    private String photoUrl;

    protected SocietyContribution() {
    }

    SocietyContribution(UUID societyId, UUID authorId, String kind, String category, String body,
            String referralName, String referralContact, String photoUrl) {
        this.societyId = societyId;
        this.authorId = authorId;
        this.kind = kind;
        this.category = category;
        this.body = body;
        this.referralName = referralName;
        this.referralContact = referralContact;
        this.photoUrl = photoUrl;
    }
}
