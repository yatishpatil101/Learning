package com.draazy.api.common.access;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.CreationTimestamp;

/**
 * The two-key record behind one back-office account. Maps {@code staff_account_approvals} (V67).
 *
 * <p><strong>What it is for.</strong> D192 made permission narrowing real but left the account
 * <em>factory</em> unguarded: an administrator narrowed to {@code users:write} could mint a fresh
 * administrator, which has no {@link BackOfficeGrant} and therefore resolves to the full role
 * baseline, and sign in as it. A row here with {@link #approvedAt} still null makes that new account
 * unable to authenticate at all, on every login path, until an administrator who is not its creator
 * turns the second key.
 *
 * <p><strong>Why it lives in the shared kernel rather than beside {@code User}.</strong> Exactly the
 * constraint that put {@link BackOfficeGrant} here. The row is written by {@code moderation} (layer
 * 5) and read by {@code identity.auth} (layer 0), and {@code docs/system/package-structure.md} §2
 * forbids the lower context from importing the higher one. A kernel-owned table with a kernel-owned
 * repository lets both sides reach it without an upward import, and keeps the answer to "may this
 * caller obtain a token at all" inside the kernel, which is where an auditor will look for it.
 *
 * <p><strong>Absence is a state, and it is the common one.</strong> No row means "not subject to
 * maker-checker": every account that existed before V67, and every consumer account forever. That is
 * what makes deploying this a no-op instead of locking the whole back office out on the morning
 * after. It is also the shape the bootstrap escape uses — see {@code UserAdminService#addStaff} —
 * because {@code approved_by = created_by} would be a false record of a two-key decision, and the
 * table's CHECK refuses it on purpose.
 *
 * <p>No setter for {@link #userId} or {@link #createdBy}: which account this is and who made it are
 * the facts the record exists to preserve. {@link #approve(UUID)} is the only mutation, it is
 * one-way, and it refuses the maker — the same rule the database CHECK enforces, stated twice
 * because a two-key rule enforced in one place is a one-key rule.
 */
@Entity
@Table(name = "staff_account_approvals")
@Getter
public class StaffAccountApproval {

    @Id
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    /** The administrator who minted the account. Half of the two-key record; never null. */
    @Column(name = "created_by", nullable = false, updatable = false)
    private UUID createdBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /** The second administrator. Null until the account is approved, which is what blocks login. */
    @Column(name = "approved_by")
    private UUID approvedBy;

    @Column(name = "approved_at")
    private Instant approvedAt;

    protected StaffAccountApproval() {
        // JPA
    }

    /** A new, unapproved record for {@code userId}, minted by {@code createdBy}. */
    public StaffAccountApproval(UUID userId, UUID createdBy) {
        this.userId = userId;
        this.createdBy = createdBy;
    }

    /** Has the second key turned? The one question the login gate asks. */
    public boolean isApproved() {
        return approvedAt != null;
    }

    /**
     * Turn the second key.
     *
     * <p>Refuses the maker with an {@link IllegalArgumentException} rather than an
     * {@code ApiException}: the service ahead of this has already produced the 403 an operator
     * should see, so reaching here with the creator's id means a <em>caller</em> is wrong, not a
     * user. Both fields are set together because the CHECK in V67 requires it, and because an
     * approval with a decider and no timestamp is half a decision — and half a decision read by the
     * login gate as a whole one is the vulnerability this table exists to close.
     *
     * @param approver the administrator turning the key; must not be {@link #createdBy}
     */
    public void approve(UUID approver) {
        if (approver == null || approver.equals(createdBy)) {
            throw new IllegalArgumentException(
                    "the checker may not be the maker: " + userId);
        }
        this.approvedBy = approver;
        this.approvedAt = Instant.now();
    }
}
