package com.draazy.api.common.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.Version;

/**
 * An {@link AuditedEntity} that also carries an optimistic-locking version (tech debt D48).
 *
 * <p><strong>What it buys.</strong> Hibernate adds {@code version} to the {@code WHERE} clause of
 * every {@code UPDATE} and increments it. Two transactions that both read a row and both write it
 * therefore cannot both succeed: the second update matches zero rows and Spring raises
 * {@link org.springframework.dao.OptimisticLockingFailureException}, which
 * {@code GlobalExceptionHandler} answers as a {@code 409}. Without it the later write silently wins
 * and the earlier one is gone with nothing recorded anywhere.
 *
 * <p><strong>Why this is not on {@link AuditedEntity} itself.</strong> That would version all 37
 * audited tables, including {@code users}, {@code properties} and {@code transactions}. D48 is a
 * {@code Low} item about a specific situation — two ops staff working the same row on the same
 * board — and those three tables do not have that situation: they have one writer, or they are
 * append-only. Versioning them would add a column and a failure mode to every write path on the
 * platform in exchange for nothing, and would make every raw-SQL test fixture a potential
 * {@code 409} the first time someone loaded an entity around one. The extension point is here and
 * named, so the next entity that genuinely gains a second concurrent writer changes one word.
 *
 * <p><strong>Why a version and not {@code updated_at}.</strong> A timestamp comparison is a
 * comparison of clocks; two updates inside the same millisecond are indistinguishable, and the
 * column is written by both Hibernate and a database trigger, so it is not a value this side owns.
 * A counter has neither problem.
 */
@MappedSuperclass
public abstract class VersionedEntity extends AuditedEntity {

    /**
     * Managed entirely by Hibernate — never set it, and note there is deliberately no accessor.
     * The number is infrastructure, not a field of the resource, and nothing outside the
     * persistence layer has a legitimate reason to read it. Access is by field (the {@code @Id} is
     * on a field), so Hibernate does not need one either.
     */
    @Version
    @Column(name = "version", nullable = false)
    private long version;
}
