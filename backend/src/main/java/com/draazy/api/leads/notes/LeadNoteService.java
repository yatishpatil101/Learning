package com.draazy.api.leads.notes;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.persistence.ConstraintViolations;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.LongAdder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The owner's private lead desk: a note and a follow-up date against any row in their Requests inbox.
 *
 * <p><strong>No mapper, no cross-context lookups, no gate.</strong> Every other service in
 * {@code leads} joins a listing and a user to project a row; this one does not, because the
 * annotation is the owner's own words about a lead they can already see. The gate that matters is
 * the one already applied: {@code ownerId} comes from the JWT and leads every query, so there is no
 * reachable path to another owner's note — not a 403, simply nothing to address.
 */
@Service
public class LeadNoteService {

    private static final Logger log = LoggerFactory.getLogger(LeadNoteService.class);

    /** Exactly as V119 declares it — {@link ConstraintViolations} matches on the name. */
    private static final String UQ_OWNER_LEAD = "uq_lead_notes_owner_lead";

    /**
     * How many leads one owner may annotate.
     *
     * <p><strong>This ceiling is what keeps {@link LeadNoteRepository#findByOwnerId} safe to leave
     * unpaged.</strong> That method's premise is that the collection is bounded by the owner's own
     * typing — true of a person, false of a script. A loop minting a fresh key each time inserts a
     * new row every time, and the read that then has to materialise them all is a {@code GET}, which
     * {@code WriteRateLimitFilter} does not count. So the writes are throttled and the read is not:
     * spend a night growing the table, then replay the cheap request whenever you want the instance
     * to run out of heap. Capping the rows removes the ammunition rather than rationing the trigger.
     *
     * <p>Two thousand is far above any real desk — an owner with two thousand distinct leads they
     * have personally written notes against is not a user this product has — and far below the size
     * where the unpaged read is expensive. Only the <em>insert</em> branch consults it, so an owner
     * who somehow reaches the ceiling can still edit and clear everything they already wrote; the
     * cap can never strand them with a desk they cannot tidy.
     */
    static final int MAX_NOTES_PER_OWNER = 2_000;

    /**
     * How far out of the present a follow-up may sit, in either direction.
     *
     * <p>Not a product opinion about diary length — it is the storage talking. {@link Instant}
     * accepts years up to ±1,000,000,000; {@code timestamptz} runs from 4713 BC to 294276 AD.
     * Without a bound, a body carrying {@code "+1000000000-12-31T23:59:59Z"} reaches the driver and
     * fails there, so any token holder can turn a validation problem into a 500. <strong>The bound
     * is symmetric because the hole is</strong>: {@code "-1000000000-01-01T00:00:00Z"} is the same
     * defect arriving from the other side, and a guard that only looked forward would leave it open
     * while reading as though it had closed it.
     *
     * <p>A past follow-up date is perfectly legitimate — it is an overdue one, which is exactly what
     * the panel's chip is for — so this must not be confused with {@code @FutureOrPresent}. A
     * century in each direction is comfortably inside what Postgres can hold and comfortably outside
     * anything anyone will schedule or backdate.
     *
     * <p>Expressed in days because {@link ChronoUnit#YEARS} is not a unit {@link Instant} supports —
     * years are not a fixed length, and an {@code Instant} has no calendar to resolve them against.
     */
    private static final long MAX_FOLLOW_UP_DAYS = 36_500;

    private final LeadNoteRepository notes;
    private final TransactionTemplate transactions;
    private final LongAdder racesRetried = new LongAdder();

    public LeadNoteService(LeadNoteRepository notes, PlatformTransactionManager transactionManager) {
        this.notes = notes;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    /**
     * How many times the retry below has actually run.
     *
     * <p>Exists because the race test cannot otherwise tell a retry from an accidental
     * serialisation — if the winner commits before the loser's probe, the loser takes the update
     * branch and the observable result is identical to a successful retry. A test that cannot tell
     * those apart silently stops testing this method the first time the timing shifts.
     */
    long racesRetried() {
        return racesRetried.sum();
    }

    /** Every annotation the owner has written, for the inbox to index by key. */
    @Transactional(readOnly = true)
    public List<LeadNoteResponse> myNotes(UUID ownerId) {
        return notes.findByOwnerId(ownerId).stream().map(LeadNoteResponse::of).toList();
    }

    /**
     * Write one annotation, or clear it.
     *
     * <p><strong>The loser of an upsert race is retried, not refused</strong> — the same shape as
     * {@code ConversationOpeningService#start} (D54), and for a sharper reason. There, two people
     * had to message each other at once; here it takes one person, because the panel saves the note
     * and the follow-up date from separate controls. A double-tapped Save, or a blur-autosave on
     * each field, sends two writes on the same key milliseconds apart: both probes miss, both
     * insert, and {@code uq_lead_notes_owner_lead} rejects the second. Left alone that surfaces as a
     * 409 "conflicts with existing data" — a message about contention, for an annotation nobody else
     * can touch, with the owner's typed note lost behind it.
     *
     * <p>The retry cannot be a catch block inside a transaction. The violation is raised at flush,
     * which poisons the persistence context and marks the transaction rollback-only, so a re-read
     * there would fail again at commit and turn the 409 into a 500. The first attempt has to
     * <em>end</em> before the winner's committed row is visible, which is why this method is not
     * {@code @Transactional} and each attempt runs in its own {@link TransactionTemplate}. The
     * {@code isActualTransactionActive} guard keeps that reasoning true if a transactional caller is
     * ever added: the template would join their transaction rather than open one, and the retry
     * would re-enter the very context that cannot be reused — so it rethrows, and the caller gets
     * the honest 409 instead of a 500 nobody would trace back here.
     *
     * @return the stored annotation, or {@link Optional#empty()} when the write cleared it
     */
    public Optional<LeadNoteResponse> save(
            UUID ownerId, String leadKey, String note, Instant followUpAt) {
        if (followUpAt != null
                && (followUpAt.isAfter(Instant.now().plus(MAX_FOLLOW_UP_DAYS, ChronoUnit.DAYS))
                        || followUpAt.isBefore(
                                Instant.now().minus(MAX_FOLLOW_UP_DAYS, ChronoUnit.DAYS)))) {
            throw new BadRequestException(
                    "followUpAt is too far from today to be a date anyone meant to pick.");
        }
        try {
            return transactions.execute(tx -> upsert(ownerId, leadKey, note, followUpAt));
        } catch (DataIntegrityViolationException raced) {
            if (!ConstraintViolations.isOn(raced, UQ_OWNER_LEAD)
                    || TransactionSynchronizationManager.isActualTransactionActive()) {
                throw raced;
            }
            log.info("Concurrent lead-note writes raced on one key for owner {}; retrying as an"
                    + " update against the row the winner inserted", ownerId);
            racesRetried.increment();
            return transactions.execute(tx -> upsert(ownerId, leadKey, note, followUpAt));
        }
    }

    /**
     * <strong>An empty annotation is a delete, not a blank row.</strong> The localStorage version
     * pruned for tidiness; here it is load-bearing twice over. The V119 CHECK rejects a row with
     * neither field, so storing one would be a 500 rather than a no-op; and the inbox answers "does
     * this lead have a note" by existence, so a blank row would light a follow-up chip that points at
     * nothing.
     *
     * <p>Blank strings are folded to {@code null} on the way in. A {@code note} of {@code ""} and a
     * {@code note} of {@code null} mean the same thing to every reader, and letting both into the
     * column would mean the CHECK — and the delete rule above — disagreed with the UI about which
     * annotations are empty.
     *
     * <p>{@code saveAndFlush} rather than {@code save}, because on the update branch the row is
     * already managed: {@code save} merges without flushing, and {@code @UpdateTimestamp} fires at
     * flush. The response would carry the timestamp of the <em>previous</em> edit — which is the one
     * field here whose entire job is to say when this edit happened.
     */
    private Optional<LeadNoteResponse> upsert(
            UUID ownerId, String leadKey, String note, Instant followUpAt) {
        String trimmed = (note == null || note.isBlank()) ? null : note.trim();

        Optional<LeadNote> existing = notes.findByOwnerIdAndLeadKey(ownerId, leadKey);
        if (trimmed == null && followUpAt == null) {
            existing.ifPresent(notes::delete);
            return Optional.empty();
        }

        if (existing.isEmpty() && notes.countByOwnerId(ownerId) >= MAX_NOTES_PER_OWNER) {
            throw new BadRequestException(
                    "You have notes against " + MAX_NOTES_PER_OWNER + " leads already. Clear one you"
                            + " no longer need before adding another.");
        }

        LeadNote row = existing.orElseGet(() -> new LeadNote(ownerId, leadKey));
        row.replace(trimmed, followUpAt);
        return Optional.of(LeadNoteResponse.of(notes.saveAndFlush(row)));
    }
}
