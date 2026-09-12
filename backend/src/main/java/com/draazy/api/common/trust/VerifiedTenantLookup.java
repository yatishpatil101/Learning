package com.draazy.api.common.trust;

import java.util.Collection;
import java.util.Set;
import java.util.UUID;

/**
 * Which parties carry a verified tenant profile, for the surfaces that badge them.
 *
 * <p><strong>Why a port, again.</strong> Tenant profiles live in {@code finance} (layer 4), and the
 * contact inbox lives in {@code leads} (layer 2). The owner's inbox needs the badge, so without an
 * inversion {@code leads} would import {@code finance} — an upward reference that
 * {@code ArchitectureBoundaryTest} fails the build over, and it did on the first run after the badge
 * was wired. Declaring it here and implementing it in {@code finance.tenancy} points the arrow the
 * right way, as {@link ContactGate}, {@link PropertyExperience}, {@link RatingLookup} and
 * {@link Notifier} already do.
 *
 * <p><strong>Why the badge must be carried rather than looked up by the client.</strong> Every
 * mobile a requester's counterparty receives is masked until the contact is approved (D5), and the
 * mask is lossy: a client matching {@code 98XXXXX210} against a list of verified numbers can only
 * ever answer false. So the server has to state the answer, keyed on the user id, which the client
 * never has to guess at.
 *
 * <p><strong>Id-keyed and batched on purpose.</strong> The mobile-keyed sibling that this replaces
 * could be aimed at any number and so needed a relationship guard to stop it being an enumeration
 * oracle. This one cannot be aimed: the ids come from rows the caller already participates in, so
 * entitlement was settled upstream by whatever scoped those rows. Taking a collection rather than a
 * single id is what keeps a page of an inbox to one query instead of one per row.
 */
public interface VerifiedTenantLookup {

    /**
     * The subset of {@code userIds} that carries a verified tenant profile.
     *
     * <p>Returns the <em>positive</em> set rather than a map of id to boolean so that an absent id
     * and a false one cannot drift apart: there is one representation of "not verified", and a
     * caller that forgets to handle a missing key still renders the safe answer.
     *
     * @param userIds the parties to ask about; nulls and repeats are ignored
     * @return the subset that carries the badge — never null, empty when nothing was asked
     */
    Set<UUID> verifiedAmong(Collection<UUID> userIds);
}
