package com.punenest.api.leads.conversation;

import static org.assertj.core.api.Assertions.assertThat;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.leads.contact.ContactRequest;
import com.punenest.api.leads.contact.ContactRequestRepository;
import com.punenest.api.leads.contact.ContactRequestStatuses;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import com.punenest.api.support.Races;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.IntFunction;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Two first messages sent at the same moment leave one thread and no errors (D54).
 *
 * <p><strong>What was wrong.</strong> {@code POST /messages} is find-or-create: it probes for an
 * existing thread and inserts one if there is none. Under concurrency both callers probe, both find
 * nothing, both insert, and only one commits — the V22 partial unique indexes see to that. The loser
 * used to get the violation back as a 409. Truthful, but a lie about the contract: find-or-create
 * had already promised that caller a thread, one now exists, and "conflict" is not something the
 * client can act on except by sending the identical request again. This test holds the fix down: the
 * loser is handed the winner's thread, which is exactly what a client one millisecond slower would
 * have got.
 *
 * <p><strong>Why the fix could not be a catch block, and why that shapes this test.</strong> The
 * retry runs in a <em>second</em> transaction, because a constraint violation dooms the first one —
 * its persistence context is undefined and it is already marked rollback-only, so a re-read there
 * would either see nothing or fail again at commit. Which means the winner's row has to be
 * <em>committed</em> before the loser can find it. Nothing about that is observable from a harness
 * that rolls back.
 *
 * <p><strong>So: not on {@code AbstractApiTest}, and not by oversight.</strong> That base class is
 * {@code @Transactional} and rolls every test back, so its writes are never visible on another
 * connection and a commit-time race cannot be staged from it at all — see {@link Races} for the full
 * argument and D90 for the defect that survived the whole suite because of it. Everything here
 * commits for real, so {@link #cleanUp()} is what keeps the rest of the suite's exact-count
 * assertions honest.
 */
@SpringBootTest
@DisplayName("Two first messages in one thread, sent together")
class ConversationStartRaceTest {

    /**
     * How many racers. Two, and the ceiling is the connection pool rather than the scenario.
     *
     * <p>The test datasource is capped at four connections deliberately (see
     * {@code src/test/resources/application.properties}) and the winning thread needs <em>two</em>
     * at once: its own transaction, plus the {@code REQUIRES_NEW} one that writes the
     * {@code conversation.started} audit row. The loser holds a third while it waits on the losing
     * insert. A third racer would take the peak to the whole pool and the failure would arrive as a
     * connection timeout rather than as the defect under test — and two is all the scenario needs,
     * since one committed row is enough to make every other caller a loser.
     */
    private static final int RACERS = 2;

    /**
     * How many times to re-run a race that serialised instead of colliding.
     *
     * <p>Only reached when an attempt produced no collision at all; a collision returns
     * immediately. Eight is far past the point where a permanently-serialising path is the
     * likelier explanation than eight consecutive unlucky schedules.
     */
    private static final int RACE_ATTEMPTS = 8;

    @Autowired ConversationOpeningService conversations;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired ContactRequestRepository contactRequests;
    @Autowired JdbcTemplate jdbc;

    private User buyer;
    private User owner;
    private UUID propertyId;

    @BeforeEach
    void setUp() {
        buyer = saveUser("9876000390", "Race Buyer");
        owner = saveUser("9876000391", "Race Owner");
        Property listing = properties.saveAndFlush(new Property(
                owner, "Race listing", "rent", "flat", 25_000L, "Baner", "Pune"));
        propertyId = listing.getId();
        // The relationship guard is not what is under test, but it is not stubbed either: an
        // approved request is the real door, and going through it keeps this test honest about
        // which code path the racers take.
        ContactRequest approved = new ContactRequest(propertyId, buyer.getId(), "interested");
        approved.setStatus(ContactRequestStatuses.APPROVED);
        contactRequests.saveAndFlush(approved);
    }

    @AfterEach
    void cleanUp() {
        if (buyer != null && owner != null) {
            jdbc.update("delete from messages where conversation_id in"
                    + " (select id from conversations where user_a_id in (?, ?)"
                    + " or user_b_id in (?, ?))",
                    buyer.getId(), owner.getId(), buyer.getId(), owner.getId());
            jdbc.update("delete from conversations where user_a_id in (?, ?)"
                    + " or user_b_id in (?, ?)",
                    buyer.getId(), owner.getId(), buyer.getId(), owner.getId());
            jdbc.update("delete from notifications where user_id in (?, ?)",
                    buyer.getId(), owner.getId());
        }
        if (propertyId != null) {
            jdbc.update("delete from contact_requests where property_id = ?", propertyId);
            jdbc.update("delete from properties where id = ?", propertyId);
        }
        // The started-thread audit row commits in its own REQUIRES_NEW transaction, so it outlives
        // the rollback of the losing attempt and has to be removed by hand.
        if (buyer != null && owner != null) {
            jdbc.update("delete from audit_log where actor in (?, ?)",
                    buyer.getId().toString(), owner.getId().toString());
        }
        for (User user : new User[] { buyer, owner }) {
            if (user != null) {
                jdbc.update("delete from users where id = ?", user.getId());
            }
        }
        buyer = null;
        owner = null;
        propertyId = null;
    }

    private User saveUser(String mobile, String name) {
        User user = new User(mobile, Roles.Wire.BUYER);
        user.setName(name);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private long countThreads() {
        Long n = jdbc.queryForObject(
                "select count(*) from conversations"
                        + " where (user_a_id = ? and user_b_id = ?)"
                        + " or (user_a_id = ? and user_b_id = ?)",
                Long.class, buyer.getId(), owner.getId(), owner.getId(), buyer.getId());
        return n == null ? 0 : n;
    }

    /** Messages in whatever thread the pair ended up with. */
    private long countMessages() {
        Long n = jdbc.queryForObject(
                "select count(*) from messages where conversation_id in"
                        + " (select id from conversations"
                        + " where (user_a_id = ? and user_b_id = ?)"
                        + " or (user_a_id = ? and user_b_id = ?))",
                Long.class, buyer.getId(), owner.getId(), owner.getId(), buyer.getId());
        return n == null ? 0 : n;
    }

    /**
     * The claim, in three parts, all of which are needed.
     *
     * <p>Nobody may come back with an error — not the {@code DataIntegrityViolationException} this
     * started as, and not the {@code ConflictException} it was downgraded to, because a thread the
     * caller asked for now exists and withholding it is the API failing on a request it had already
     * ruled legal. Exactly one racer may report {@code created}, since only one row was inserted and
     * a client that trusts the 201/200 distinction has to be told the truth. And exactly one row may
     * survive: a service that answers the right number of callers while writing the wrong number of
     * rows has still forked the conversation, which is the failure V22 exists to prevent.
     *
     * <p>The message count is the fourth part, and it is what proves the retry is a re-run rather
     * than a consolation read: the losing attempt rolls back <em>whole</em>, taking its message with
     * the thread it failed to create, so the words the loser typed only survive because the second
     * transaction sent them again. Two callers, two messages, one thread.
     */
    private void assertOneThreadAndNoErrors(List<Throwable> outcomes, List<Boolean> created) {
        for (Throwable outcome : outcomes) {
            if (outcome != null) {
                throw new AssertionError(
                        "the loser of the find-or-create race must be handed the existing thread, "
                                + "not an error", outcome);
            }
        }
        assertThat(created.stream().filter(Boolean::booleanValue).count())
                .as("only one caller created anything, so only one may be told 201")
                .isEqualTo(1);
        assertThat(created)
                .as("the loser is told 200 — the thread it asked for, which already existed")
                .hasSize(RACERS);
        assertThat(countThreads())
                .as("the indexes exist so that one first message and two leave the same inbox")
                .isEqualTo(1);
        assertThat(countMessages())
                .as("the loser's message was re-sent by the retry, not swallowed by the collision")
                .isEqualTo(RACERS);
    }

    /**
     * Run a race until the D54 retry actually fires, and fail if it never does.
     *
     * <p><strong>Why this is a loop and not a single run.</strong> Every assertion in
     * {@link #assertOneThreadAndNoErrors} is satisfied just as well by an accidental
     * <em>serialisation</em>: if the winner commits before the loser's probe, the loser takes the
     * existing-thread branch, and the observable result — no errors, one {@code created}, one
     * thread, two messages — is byte-identical to a successful retry. A single run therefore cannot
     * distinguish "the fix works" from "the fix was never reached", which means the day the timing
     * shifts this test would keep passing while testing nothing. The barrier in {@code Races}
     * aligns entry into {@code start}, but the user lookup, the listing lookup, the relationship
     * check and the connection acquisition after it are all unsynchronised, so serialisation is a
     * realistic outcome rather than a theoretical one.
     *
     * <p>{@link ConversationOpeningService#racesRetried()} makes the retry observable, and re-running until
     * it is observed converts a flaky assertion into a deterministic one: a collision is likely per
     * attempt, so across {@link #RACE_ATTEMPTS} attempts never seeing one means the path is
     * unreachable, not unlucky. The invariants are asserted on <em>every</em> attempt, so a serialised
     * round still has to be correct — it just does not count as proof.
     */
    private void raceUntilRetried(IntFunction<Boolean> racer) {
        long before = conversations.racesRetried();
        for (int attempt = 1; attempt <= RACE_ATTEMPTS; attempt++) {
            List<Boolean> created = new CopyOnWriteArrayList<>();
            List<Throwable> outcomes = Races.run(RACERS, index -> created.add(racer.apply(index)));
            assertOneThreadAndNoErrors(outcomes, created);
            if (conversations.racesRetried() > before) {
                return;
            }
            clearThreads();
        }
        throw new AssertionError("the find-or-create race never collided in " + RACE_ATTEMPTS
                + " attempts, so the D54 retry was never exercised — every attempt serialised, "
                + "which means this test no longer proves the fix works");
    }

    /** Remove the threads a serialised attempt left behind, so the next attempt starts empty. */
    private void clearThreads() {
        jdbc.update("delete from messages where conversation_id in"
                + " (select id from conversations where user_a_id in (?, ?)"
                + " or user_b_id in (?, ?))",
                buyer.getId(), owner.getId(), buyer.getId(), owner.getId());
        jdbc.update("delete from conversations where user_a_id in (?, ?)"
                + " or user_b_id in (?, ?)",
                buyer.getId(), owner.getId(), buyer.getId(), owner.getId());
        jdbc.update("delete from notifications where user_id in (?, ?)",
                buyer.getId(), owner.getId());
    }

    /**
     * One account, one counterparty, two first messages released together.
     *
     * <p>The double tap on a flaky connection, which is how this arrives in production far more
     * often than two genuinely different clients do.
     */
    @Test
    @DisplayName("a general thread: the loser is handed the winner's thread, not a 409")
    void concurrentFirstMessagesLeaveOneThread() {
        AuthPrincipal caller = new AuthPrincipal(
                buyer.getId(), Roles.Wire.BUYER, null, true, false);
        ConversationCreate body = new ConversationCreate(
                owner.getMobile(), null, "Is this still available?");

        raceUntilRetried(index -> conversations.start(caller, body).created());
    }

    /**
     * The same collision through the other door.
     *
     * <p>Each party names the other by mobile and neither knows a thread is being opened from the
     * far side; V22 canonicalises the pair, so both inserts target the identical index entry. Worth
     * its own test because the two callers are different rows, different principals and different
     * halves of the guard — "it is the same code" is a claim about today.
     */
    @Test
    @DisplayName("both parties messaging each other at once still leaves one thread")
    void oppositeDirectionsLeaveOneThread() {
        AuthPrincipal fromBuyer = new AuthPrincipal(
                buyer.getId(), Roles.Wire.BUYER, null, true, false);
        AuthPrincipal fromOwner = new AuthPrincipal(
                owner.getId(), Roles.Wire.BUYER, null, true, false);
        ConversationCreate buyerSays = new ConversationCreate(
                owner.getMobile(), null, "Is this still available?");
        ConversationCreate ownerSays = new ConversationCreate(
                buyer.getMobile(), null, "Are you still looking?");

        raceUntilRetried(index -> {
            ConversationOpeningService.Started started = index == 0
                    ? conversations.start(fromBuyer, buyerSays)
                    : conversations.start(fromOwner, ownerSays);
            return started.created();
        });
    }
}
