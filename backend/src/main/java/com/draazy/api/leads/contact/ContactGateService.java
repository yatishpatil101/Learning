package com.draazy.api.leads.contact;

import com.draazy.api.common.trust.ContactGate;
import com.draazy.api.common.trust.ContactVisibility;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * The contacts feature's implementation of the shared-kernel {@link ContactGate} port — the seam that
 * lets {@code catalog} mask or reveal an owner mobile without importing this package
 * ({@code package-structure.md} §5; see the slice-3 cross-context decision).
 *
 * <p>Deliberately tiny and dependency-free: it is called on every authenticated property-detail
 * render, and it must be readable end-to-end in one screen because it is the last line of defence on
 * the reveal.
 *
 * <p><strong>Invariant (D5 global policy):</strong> the raw owner mobile is revealed only to the
 * owner viewing their own listing. Every other viewer — anonymous, {@code pending}, {@code approved},
 * {@code declined}, {@code none} — is masked. Approval unlocks the in-app conversation, not the
 * digits, so no gate status reveals a number to a buyer. {@code users.hide_number} (V31) is retained
 * as a no-op preference under this policy: masking is now unconditional for non-owners.
 *
 * <p><strong>Why the decision lives here and not in the mapper.</strong>
 * {@code PropertyMapper.toOwner} also holds the owner entity and could compare ids in one line, which
 * is exactly why it must not: there would then be two places that decide a reveal, and the second one
 * is a mapper — where a future change looks like formatting work rather than a trust decision. One
 * decision point is the whole point of this class.
 */
@Service
public class ContactGateService implements ContactGate {

    /**
     * {@inheritDoc}
     *
     * <p>No database access: under the global policy the answer is a pure id comparison, decided for
     * every render without a query. The owner's own number is never masked from the owner — masking a
     * person's own profile would just look like a bug — and every other viewer is masked.
     */
    @Override
    public ContactVisibility visibilityFor(UUID viewerId, UUID propertyId, UUID ownerId) {
        if (viewerId == null || ownerId == null) {
            return ContactVisibility.MASKED;
        }
        return viewerId.equals(ownerId) ? ContactVisibility.REVEALED : ContactVisibility.MASKED;
    }
}
