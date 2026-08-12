package com.punenest.api.common.access;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

/**
 * One back-office account's permission document. Maps {@code back_office_permissions} (V65).
 *
 * <p><strong>Why this lives in the shared kernel rather than beside {@code User}.</strong> The
 * resolver that reads it ({@code security.AccountPermissions}) is part of the authorisation chain,
 * and {@code docs/system/package-structure.md} §2 forbids the kernel from importing a feature
 * context — so a document keyed by a user cannot be a field on {@code identity.user.User} without
 * the kernel reaching into {@code identity}. The same constraint is why {@code User} implements
 * {@code TokenSubject} instead of {@code JwtService} importing {@code User}. Keeping the table
 * kernel-owned also keeps the answer to "may this caller do X" inside the kernel end to end, which
 * is where an auditor will look for it.
 *
 * <p><strong>The value is stored, not typed.</strong> {@link #permissions} is the raw JSON array as
 * written, exactly as {@code common.settings.Setting} keeps its block: parsing belongs to the
 * resolver, which has to answer "this is not a JSON array of strings" as a <em>denial</em> rather
 * than as an exception out of a Hibernate load. Mapping it to a {@code List<String>} would move
 * that failure into entity hydration, where the only available behaviours are "throw" and "lose the
 * row" — and losing the row means falling back to the unscoped baseline, which is the one outcome a
 * corrupt access-control document must never produce.
 *
 * <p>No setter for {@link #userId}: a document belongs to the account it was written for, and the
 * only legitimate way to move one is to delete it and write another.
 */
@Entity
@Table(name = "back_office_permissions")
@Getter
public class BackOfficeGrant {

    @Id
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    /** JSON array of {@code module:action} atoms. Validated against the catalogue before it is set. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "permissions", nullable = false)
    private String permissions = "[]";

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by")
    private UUID updatedBy;

    protected BackOfficeGrant() {
        // JPA
    }

    /** A new document scoping {@code userId}, authored by {@code updatedBy}. */
    public BackOfficeGrant(UUID userId, String permissions, UUID updatedBy) {
        this.userId = userId;
        this.permissions = permissions;
        this.updatedBy = updatedBy;
    }

    /**
     * Replace the whole document.
     *
     * <p>Whole rather than incremental on purpose. An administrator ticking boxes is describing the
     * access this account should have, not the access it should additionally have — and a merge
     * would make it impossible to express "remove this one", which is the operation the feature
     * exists for.
     */
    public void replace(String permissions, UUID updatedBy) {
        this.permissions = permissions;
        this.updatedBy = updatedBy;
    }
}
