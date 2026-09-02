package com.draazy.api.common.settings;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * One block of platform configuration. Maps {@code settings} (V1), a key/value document store whose
 * rows are seeded by {@code R__DML_seed_reference_data.sql} ({@code fees}, {@code flags}, {@code site}).
 *
 * <p><strong>Why a document and not columns.</strong> V1's own header says it: "so config can evolve
 * without a migration per key". The contract's {@code AdminSettings} is explicitly
 * {@code additionalProperties: true} in three places — ops adds a fee or a flag by editing a row,
 * not by shipping a schema change.
 *
 * <p>The consequence is that this entity cannot type its contents, so reading it is deliberately
 * kept behind a narrow accessor ({@link PlatformSettings}) rather than exposed as a map. Untyped
 * config that anything can reach into becomes untyped config that everything depends on.
 */
@Entity
@Table(name = "settings")
@Getter
public class Setting {

    @Id
    @Column(name = "key", nullable = false, updatable = false)
    private String key;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "value", nullable = false)
    @Setter
    private String value = "{}";

    protected Setting() {
        // JPA
    }

    /**
     * A new, empty block under {@code key}.
     *
     * <p>Public rather than package-private because {@code AdminSettingsService} — the one writer
     * — lives in the {@code admin} context. The narrow-accessor rule this class's Javadoc argues
     * for is about <em>readers</em>: the point is that no feature reaches in for its own config,
     * not that the settings screen cannot save.
     */
    public Setting(String key) {
        this.key = key;
    }

    /** Replace this block's document. The caller owns merge semantics — see S60. */
}
