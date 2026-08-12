package com.punenest.api.common.access;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * The two-key records behind back-office accounts (V67, tech debt D200).
 *
 * <p>Kernel-owned for the reason set out on {@link StaffAccountApproval}: {@code identity.auth} has
 * to ask "may this account authenticate at all" and {@code moderation} has to write the answer, and
 * the layering in {@code docs/system/package-structure.md} §2 forbids the first from importing the
 * second.
 */
public interface StaffAccountApprovalRepository extends JpaRepository<StaffAccountApproval, UUID> {

    /**
     * The login gate, in one primary-key lookup.
     *
     * <p>Phrased as "is there a row that has not been approved" rather than "is there an approved
     * row" deliberately: the overwhelmingly common answer is that there is <em>no row</em>, which
     * means the account is not subject to maker-checker at all, and only this phrasing gives that
     * case the value {@code false}. Asking the other question would have made every account created
     * before V67 unable to sign in.
     */
    boolean existsByUserIdAndApprovedAtIsNull(UUID userId);

    /** Everything still waiting for a second key, oldest first — the approval queue. */
    List<StaffAccountApproval> findByApprovedAtIsNullOrderByCreatedAtAsc();
}
