package com.punenest.api.leads.notes;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.repository.Repository;

/**
 * {@link LeadNote} access, all of it owner-scoped.
 *
 * <p><strong>Deliberately {@link Repository} rather than {@code JpaRepository}.</strong> Extending
 * the latter would inherit {@code findById}, {@code findAll}, {@code deleteById} and
 * {@code getReferenceById} — every one of them unscoped and one keystroke away. The claim this
 * package's whole privacy argument rests on would then be true only of the call sites that happen
 * to exist today, and would break silently the first time somebody reached for the obvious method.
 * Declaring the five methods actually needed makes it true of the type instead: <strong>there is no
 * way to obtain a {@code LeadNote} from here without naming an owner.</strong> Spring Data resolves
 * {@code saveAndFlush} and {@code delete} against {@code SimpleJpaRepository} exactly as it would
 * have inherited them.
 *
 * <p>Anything that genuinely needs an unscoped read — a test asserting the table is empty, say —
 * should go to the table directly rather than widening this.
 */
public interface LeadNoteRepository extends Repository<LeadNote, UUID> {

    /**
     * Every note the owner has, in one read.
     *
     * <p><strong>Unpaged, and this is the rare case where that is right.</strong> The collection is
     * bounded by the owner's own typing — one row per lead they chose to annotate — and the inbox
     * needs all of them at once to show a follow-up chip on any row it renders, so a page would
     * silently blank the chips past the boundary. That is the opposite of the photo-request inbox,
     * which grows with demand rather than effort and is paged from the start (D78).
     *
     * <p><strong>"Bounded by the owner's own typing" is only true of a human</strong>, which is why
     * {@link #countByOwnerId(UUID)} exists and {@link LeadNoteService} refuses to insert past a
     * ceiling. A script does not type, and this endpoint is a {@code GET}, so
     * {@code WriteRateLimitFilter} — which counts only mutating verbs — cannot slow the read down.
     * Without the cap, one account could spend a night minting rows and then turn its own unpaged
     * inbox into a repeatable out-of-memory against the whole instance. The cap is what lets this
     * method stay unpaged; do not remove one without the other.
     */
    List<LeadNote> findByOwnerId(UUID ownerId);

    /** Guards the insert branch of an upsert — see {@link LeadNoteService#MAX_NOTES_PER_OWNER}. */
    long countByOwnerId(UUID ownerId);

    Optional<LeadNote> findByOwnerIdAndLeadKey(UUID ownerId, String leadKey);

    /**
     * Flush is not optional here. {@code @UpdateTimestamp} fires at flush, and the response echoes
     * {@code updatedAt} back to the panel — a plain {@code save} on the update branch would merge
     * without flushing and return the previous edit's timestamp. See {@code LeadNoteService#upsert}.
     */
    LeadNote saveAndFlush(LeadNote note);

    /** Only ever reached with a row {@link #findByOwnerIdAndLeadKey} already proved is the caller's. */
    void delete(LeadNote note);
}
