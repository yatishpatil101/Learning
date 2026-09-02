package com.draazy.api.engagement.history;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * One entry in a signed-in user's "resume your search" rail (V121).
 *
 * <p>Deliberately not a {@code SavedSearch}: that is a standing instruction with an alert frequency
 * that survives until the user deletes it. This is a byproduct of navigating, silently evicted six
 * searches later, and nothing here may change alert semantics.
 *
 * <p>The row's identity is its {@code url}, never its {@code label} — the label is what the user
 * read, the URL is what the search was. Only the service constructs or touches one, and the URL is
 * validated against an allowlist of our own search paths before it ever reaches here.
 */
@Entity
@Table(name = "recent_searches")
@Getter
public class RecentSearch extends AuditedEntity {

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "label", nullable = false, length = 200)
    private String label;

    /** Immutable: a different URL is a different search, so it gets a different row. */
    @Column(name = "url", nullable = false, updatable = false, length = 500)
    private String url;

    @Column(name = "searched_at", nullable = false)
    private Instant searchedAt;

    protected RecentSearch() {
        // JPA
    }

    RecentSearch(UUID userId, String label, String url, Instant searchedAt) {
        this.userId = userId;
        this.label = label;
        this.url = url;
        this.searchedAt = searchedAt;
    }

    /**
     * Re-running a search the user already has: refresh the chip text and move the row to the top.
     *
     * <p>{@code searchedAt} is always assigned, even when the label is unchanged. That is the point
     * of it having its own column — if the only writes were no-ops Hibernate would find the entity
     * clean, skip the UPDATE, and leave the MRU order quietly stale.
     */
    void touch(String label, Instant searchedAt) {
        this.label = label;
        this.searchedAt = searchedAt;
    }
}
