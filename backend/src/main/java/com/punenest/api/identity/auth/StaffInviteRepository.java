package com.punenest.api.identity.auth;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * The open-invite records behind back-office accounts (V71, tech debt D206).
 *
 * <p>Two queries and no more. {@link #existsByUserIdAndRedeemedAtIsNull(UUID)} is the login gate —
 * phrased as "is there an open row" precisely so that <em>absence</em> answers {@code false}, which
 * is what makes every pre-V71 account and every consumer account unaffected. The other is
 * {@code findById}, inherited: the invitee presents a selector and exactly one row is fetched, so
 * the secret comparison happens in Java where it can be constant-time.
 */
public interface StaffInviteRepository extends JpaRepository<StaffInvite, UUID> {

    /** Is this account still waiting for its holder to choose a password? */
    boolean existsByUserIdAndRedeemedAtIsNull(UUID userId);
}
