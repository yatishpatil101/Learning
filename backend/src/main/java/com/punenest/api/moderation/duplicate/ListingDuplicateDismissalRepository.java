package com.punenest.api.moderation.duplicate;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

/**
 * Reads and writes settled duplicate clusters.
 *
 * <p>Two methods, and the split is deliberate. {@link #findByClusterSignatureIn} is the one the
 * cluster read uses: it takes every signature on the page in a single round trip, because the
 * alternative — asking "is this one settled" per cluster — is a query count that grows with the
 * size of the desk's backlog, which is precisely the situation where the desk is slowest already.
 */
public interface ListingDuplicateDismissalRepository
        extends JpaRepository<ListingDuplicateDismissal, UUID> {

    /** Every dismissal among the given signatures, in one round trip. */
    List<ListingDuplicateDismissal> findByClusterSignatureIn(Collection<String> signatures);

    /**
     * One dismissal by signature.
     *
     * <p>Used by the write path to make a repeat dismissal a no-op rather than a unique-constraint
     * violation. A double-clicked button and two operators reaching the same verdict are the same
     * event as far as this table is concerned.
     */
    Optional<ListingDuplicateDismissal> findByClusterSignature(String signature);
}
