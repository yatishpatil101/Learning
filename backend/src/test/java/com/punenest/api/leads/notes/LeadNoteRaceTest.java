package com.punenest.api.leads.notes;

import static org.assertj.core.api.Assertions.assertThat;

import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.Races;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Two saves of the same annotation, sent together, leave one row and no error.
 *
 * <p><strong>Why this race needs no concurrent users.</strong> The find-or-create race in
 * {@code ConversationStartRaceTest} takes two people messaging each other at the same moment; this
 * one takes one person tapping Save twice, or a panel that autosaves the note and the follow-up date
 * from separate controls. Both writes probe {@code findByOwnerIdAndLeadKey}, both miss, both insert,
 * and {@code uq_lead_notes_owner_lead} rejects the second. Left unhandled the owner is told their
 * private note "conflicts with existing data" — a message about contention, for a row nobody else
 * can reach — and the text they typed is gone.
 *
 * <p><strong>Not on {@code AbstractApiTest}, for the same reason as the conversation race.</strong>
 * That base class is {@code @Transactional} and rolls every test back, so its writes are invisible
 * on another connection and a commit-time collision cannot be staged from it at all. Everything here
 * commits for real, which is what {@link #cleanUp()} exists to undo.
 */
@SpringBootTest
@DisplayName("Two saves of one lead note, sent together")
class LeadNoteRaceTest {

    /** Two is all it takes: one committed row makes every other caller a loser. */
    private static final int RACERS = 2;

    /**
     * How many times to re-run a race that serialised instead of colliding.
     *
     * <p>Only reached when an attempt produced no collision; a collision returns immediately. Eight
     * consecutive serialisations is far likelier to mean the path is unreachable than unlucky.
     */
    private static final int RACE_ATTEMPTS = 8;

    private static final String LEAD_KEY = "number:11111111-2222-4333-8444-555555555555";

    /** Fixed, so {@link #setUp()} can clear a row leaked by a run that never reached teardown. */
    private static final String RACE_OWNER_MOBILE = "9876000420";

    @Autowired LeadNoteService leadNotes;
    @Autowired LeadNoteRepository notes;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;

    private User owner;

    /**
     * The mobile is fixed, and this class is the one in the package that commits for real — so a
     * previous run killed between {@link #setUp()} and {@link #cleanUp()} leaves the row behind, and
     * {@code users.mobile} is {@code NOT NULL UNIQUE} (V2). Clearing first turns that from "every
     * subsequent run fails in setup, then throws a second time in teardown" into a no-op.
     */
    @BeforeEach
    void setUp() {
        jdbc.update("delete from lead_notes where owner_id in"
                + " (select id from users where mobile = ?)", RACE_OWNER_MOBILE);
        jdbc.update("delete from users where mobile = ?", RACE_OWNER_MOBILE);
        User row = new User(RACE_OWNER_MOBILE, "owner");
        row.setName("Race Owner");
        row.setMobileVerified(true);
        owner = users.saveAndFlush(row);
    }

    /**
     * Null-guarded, mirroring {@code ConversationStartRaceTest#cleanUp}. If {@link #setUp()} throws,
     * {@code owner} is null and an unguarded delete would NPE here — replacing the real cause with a
     * stack trace that points at the teardown.
     */
    @AfterEach
    void cleanUp() {
        if (owner != null) {
            jdbc.update("delete from lead_notes where owner_id = ?", owner.getId());
            jdbc.update("delete from users where id = ?", owner.getId());
            owner = null;
        }
    }

    /**
     * <strong>The assertion that carries this is the row count, not the absence of errors.</strong>
     * A service that swallowed the violation and returned nothing would satisfy "no exceptions" and
     * leave the owner's note unwritten; a service without the unique index would satisfy it and
     * leave two. One row, holding one of the two texts, is the only correct outcome — which of the
     * two won is genuinely undetermined and is not asserted.
     */
    private void assertOneNoteAndNoErrors(List<Throwable> outcomes) {
        for (Throwable outcome : outcomes) {
            if (outcome != null) {
                throw new AssertionError(
                        "the loser of the upsert race must have its note written, not be told the"
                                + " row it is trying to create conflicts with itself", outcome);
            }
        }
        List<LeadNote> stored = notes.findByOwnerId(owner.getId());
        assertThat(stored)
                .as("the unique index exists so that two saves of one annotation leave one row")
                .hasSize(1);
        assertThat(stored.get(0).getNote())
                .as("and the surviving row holds one of the two texts, not a blank the retry lost")
                .isIn("Called, no answer", "Called, wants Sunday");
    }

    /**
     * Race until the retry actually fires, and fail if it never does.
     *
     * <p><strong>Why a loop rather than one run.</strong> Every assertion above is satisfied just as
     * well by an accidental <em>serialisation</em>: if the winner commits before the loser probes,
     * the loser takes the update branch and the observable result — no error, one row, one of the
     * two texts — is identical to a successful retry. A single run therefore cannot distinguish "the
     * retry works" from "the retry was never reached", so the day the timing shifts it would keep
     * passing while proving nothing. {@link LeadNoteService#racesRetried()} is what makes the
     * difference observable.
     *
     * <p>The invariants are asserted on every attempt, so a serialised round still has to be
     * correct — it just does not count as proof.
     */
    @Test
    @DisplayName("the loser's note is written, not refused as a conflict")
    void concurrentSavesOfOneNoteLeaveOneRow() {
        long before = leadNotes.racesRetried();
        for (int attempt = 1; attempt <= RACE_ATTEMPTS; attempt++) {
            UUID ownerId = owner.getId();
            List<Throwable> outcomes = Races.run(RACERS, index -> leadNotes.save(
                    ownerId, LEAD_KEY,
                    index == 0 ? "Called, no answer" : "Called, wants Sunday",
                    null));
            assertOneNoteAndNoErrors(outcomes);
            if (leadNotes.racesRetried() > before) {
                return;
            }
            jdbc.update("delete from lead_notes where owner_id = ?", owner.getId());
        }
        throw new AssertionError("two concurrent saves never collided in " + RACE_ATTEMPTS
                + " attempts, so the retry was never exercised — every attempt serialised, which"
                + " means this test no longer proves the fix works");
    }
}
