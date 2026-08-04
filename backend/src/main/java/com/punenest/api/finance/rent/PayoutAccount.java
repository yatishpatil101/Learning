package com.punenest.api.finance.rent;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * Where an owner's rent is settled to. Maps {@code payout_accounts} (V6, constrained by V14).
 *
 * <p><strong>The full account number is never stored and never returned.</strong> V6's header said
 * "only masked digits stored" and there is no column for the full value — that is the design, not
 * an oversight. The platform does not need the number after it has been registered with the payout
 * rail, and a bank account number sitting in a table is a liability with no corresponding use. The
 * write shape carries {@code accountNumber} as {@code writeOnly}; the read shape carries only
 * {@link #maskedAccount} (spec fix S11).
 *
 * <p><strong>{@code verified} is a penny-drop answer, not a claim.</strong> It records that the
 * payout rail successfully deposited and reclaimed a token amount. A client cannot set it — the
 * whole point of the flag is that it is evidence the account exists and belongs to who it says.
 * Until the live rail is wired (slice 7) nothing sets it true, which is the honest state.
 *
 * <p>One row per owner, enforced by V14's unique index. A second row would be a payout destination
 * nothing reads — which is worse than none, because it is where settlements silently do not go.
 */
@Entity
@Table(name = "payout_accounts")
@Getter
public class PayoutAccount extends AuditedEntity {

    @Column(name = "owner_id", nullable = false, updatable = false)
    private UUID ownerId;

    @Column(name = "account_holder")
    @Setter
    private String accountHolder;

    /** Masked tail only, e.g. {@code XXXXXX7890}. The full number is never persisted. */
    @Column(name = "masked_account")
    @Setter
    private String maskedAccount;

    @Column(name = "ifsc")
    @Setter
    private String ifsc;

    @Column(name = "upi_id")
    @Setter
    private String upiId;

    /** Set only by a successful penny-drop from the payout rail. Never client-supplied. */
    @Column(name = "verified", nullable = false)
    @Setter
    private boolean verified;

    protected PayoutAccount() {
        // JPA
    }

    public PayoutAccount(UUID ownerId) {
        this.ownerId = ownerId;
    }

}
