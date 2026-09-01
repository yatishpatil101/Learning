package com.punenest.api.engagement.demand;

import com.punenest.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One recorded moment of demand: somebody searched a locality, asked to be told when something
 * appears there, or opened a listing in it.
 *
 * <p><strong>Why this is not a saved search.</strong> The two are created by the same submit on the
 * "notify me" card and are deliberately different records. A {@code SavedSearch} is a promise to a
 * named person — it needs an account, it is editable, it is deletable, and the user is entitled to
 * see it on their dashboard. A demand signal is an anonymous observation that nobody owns and nobody
 * can see. Collapsing them would mean either refusing the observation when the visitor is signed out
 * (which loses exactly the cold-start demand the report exists to measure) or promising an alert to
 * somebody who has no account to receive it — the defect D85 was raised to fix.
 *
 * <p><strong>Append-only, and no setters that matter.</strong> There is no update path and no
 * archive flag. An event that can be edited after the fact is not evidence, and nothing in the
 * product moderates demand. The setters exist for construction only; see
 * {@link DemandSignalService#record}, which is the sole writer.
 *
 * <p>Extends {@link BaseEntity} rather than {@code AuditedEntity}: {@code created_at} is the whole
 * temporal story. A row is never touched again, so {@code updated_at} would record nothing and
 * {@code archived} would describe a state that cannot occur.
 */
@Entity
@Table(name = "demand_signals")
@Getter
public class DemandSignal extends BaseEntity {

    /**
     * {@code search}, {@code alert} or {@code view}, constrained in the schema.
     *
     * <p>Kept as free-ish text behind a check constraint rather than a Postgres enum, matching the
     * rest of the schema: adding a fourth kind should be a one-line constraint change, not a type
     * migration that locks the table.
     */
    @Column(name = "kind", nullable = false, updatable = false)
    @Setter
    private String kind;

    /**
     * The locality the demand is for, as a slug.
     *
     * <p>Nullable, and null is meaningful rather than sloppy: a search with no locality filter is a
     * real search, and an alert request from a visitor who never narrowed to an area is a real
     * request. Both say "somewhere in the city", which the aggregate reports separately instead of
     * silently attributing to a locality nobody named.
     */
    @Column(name = "locality_slug", updatable = false)
    @Setter
    private String localitySlug;

    /** {@code buy} or {@code rent} when the surface knew; null when it did not. */
    @Column(name = "deal", updatable = false)
    @Setter
    private String deal;

    /** Free text such as {@code "2"} or {@code "2/3"} — a multi-select is one signal, not two. */
    @Column(name = "bhk", updatable = false)
    @Setter
    private String bhk;

    /** Set for {@code view} only. Not a foreign key — see the migration header. */
    @Column(name = "property_id", updatable = false)
    @Setter
    private UUID propertyId;

    /** Null for signed-out visitors, which is the common case and the point. */
    @Column(name = "user_id", updatable = false)
    @Setter
    private UUID userId;
}
