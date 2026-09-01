package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.common.error.ConflictException;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import com.draazy.api.support.Races;
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
 * A double press on one post is refused, not answered with a 500.
 *
 * <p><strong>A different race from the one {@link FlatmateInterestRaceTest} covers.</strong> That
 * one is about the hourly <em>budget</em> — many targets, one counter — and D73 closed it with an
 * advisory lock. This one is about a single target being asked twice, which the lock orders but does
 * not by itself decide: the loser waits, and what it finds when it wakes up is the whole question.
 * The existence check now runs <em>after</em> {@code holdUntilCommit} (D175), so the loser takes a
 * fresh snapshot, sees the winner's row and is refused with the same 409 a leisurely second press
 * gets — the sequential half of that claim lives in {@code FlatmateSeekerEndpointsTest} and
 * {@code FlatmateSupplyEndpointsTest}. Behind it {@code uq_flatmate_requests_target_requester} is
 * still the thing that cannot be raced past, and until its violation was caught that refusal escaped
 * as a raw {@code DataIntegrityViolationException} — the requester told the server had broken, for
 * pressing a button twice on a flaky connection. This test holds both halves down: whichever of the
 * two refuses the loser, the answer has to be the same one.
 *
 * <p><strong>Not on {@code AbstractApiTest}, and not by oversight.</strong> That base class is
 * {@code @Transactional} and rolls back, so its writes are never visible to another connection and a
 * commit-time race cannot be observed from it — see {@link Races} for the full argument, and D90 for
 * the defect that survived the whole suite because of it. Everything here commits, so
 * {@link #cleanUp()} is what keeps the rest of the suite's exact-count assertions honest.
 */
@SpringBootTest
@DisplayName("Two interests in the same post, sent together")
class FlatmateDuplicateInterestRaceTest {

    /**
     * How many racers. Two, and the ceiling is the connection pool rather than the scenario.
     *
     * <p>The test datasource is capped at four connections deliberately (see
     * {@code src/test/resources/application.properties}) and the winning thread needs <em>two</em>
     * at once: its own transaction, plus the {@code REQUIRES_NEW} one that writes the interest's
     * audit row. The loser, parked on the advisory lock, holds a third. A third racer would take the
     * peak to the whole pool and the failure would arrive as a connection timeout rather than as the
     * defect under test.
     */
    private static final int RACERS = 2;

    @Autowired FlatmateSeekerService seekers;
    @Autowired FlatmateSupplyService supply;
    @Autowired FlatmateSeekerPostRepository posts;
    @Autowired FlatmateRoomRepository rooms;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;

    private User requester;
    private User host;
    private UUID postId;
    private UUID roomId;

    @BeforeEach
    void setUp() {
        requester = saveUser("9876000380", "Duplicate Racer");
        host = saveUser("9876000381", "Duplicate Host");
        FlatmateSeekerPost post = new FlatmateSeekerPost(host.getId(), host.getName(), 15_000L);
        // findVisible only returns publicly-visible posts, and a new one starts pending.
        post.setModStatus(FlatmateVocabulary.MOD_LIVE);
        postId = posts.saveAndFlush(post).getId();
        FlatmateRoom room = new FlatmateRoom(host.getId(), "Private room", "Baner", 12_000L);
        room.setModStatus(FlatmateVocabulary.MOD_LIVE);
        roomId = rooms.saveAndFlush(room).getId();
    }

    @AfterEach
    void cleanUp() {
        if (requester != null) {
            jdbc.update("delete from flatmate_requests where requester_id = ?", requester.getId());
        }
        if (host != null) {
            jdbc.update("delete from flatmate_requests where host_id = ?", host.getId());
            jdbc.update("delete from notifications where user_id = ?", host.getId());
        }
        // The interest audit row commits in its own REQUIRES_NEW transaction, so it outlives
        // everything else here and has to be removed by hand.
        if (postId != null) {
            jdbc.update("delete from audit_log where entity_id = ?", postId.toString());
            jdbc.update("delete from flatmate_seeker_posts where id = ?", postId);
        }
        if (roomId != null) {
            jdbc.update("delete from audit_log where entity_id = ?", roomId.toString());
            jdbc.update("delete from flatmate_rooms where id = ?", roomId);
        }
        for (User user : new User[] { requester, host }) {
            if (user != null) {
                jdbc.update("delete from users where id = ?", user.getId());
            }
        }
        requester = null;
        host = null;
        postId = null;
        roomId = null;
    }

    private User saveUser(String mobile, String name) {
        User user = new User(mobile, Roles.Wire.BUYER);
        user.setName(name);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private long countInterests(String kind, UUID targetId) {
        Long n = jdbc.queryForObject(
                "select count(*) from flatmate_requests"
                        + " where kind = ? and target_id = ? and requester_id = ?",
                Long.class, kind, targetId, requester.getId());
        return n == null ? 0 : n;
    }

    /**
     * The claim, made once so both tests can state it in a line.
     *
     * <p>All three parts are needed. Nothing may come back that is not either success or the
     * business refusal — a {@code DataIntegrityViolationException} here is the 500 this class exists
     * to stop. Exactly one racer must be refused, because the host's inbox has room for exactly one
     * of them. And exactly one row may survive, because a guard that answers the right number of
     * callers while writing the wrong number of rows has still failed.
     */
    private void assertOneWinnerAndOneRefusal(List<Throwable> outcomes, String kind, UUID target) {
        for (Throwable outcome : outcomes) {
            if (outcome != null && !(outcome instanceof ConflictException)) {
                throw new AssertionError(
                        "a racer failed with something other than the business refusal", outcome);
            }
        }
        assertThat(outcomes.stream().filter(ConflictException.class::isInstance).count())
                .as("exactly one racer must lose the press")
                .isEqualTo(RACERS - 1);
        assertThat(outcomes.stream()
                .filter(ConflictException.class::isInstance)
                .map(Throwable::getMessage))
                .as("the refusal has to carry the code the contract declares, in the position the "
                        + "client's end-anchored parser reads it from (D182)")
                .allMatch(message -> message.endsWith("(already_interested)"));
        assertThat(countInterests(kind, target))
                .as("the index exists so that one press and two presses leave the same inbox")
                .isEqualTo(1);
    }

    /**
     * One account, one post, two presses released together.
     */
    @Test
    @DisplayName("a seeker post: the loser is refused with a 409 rather than a 500")
    void concurrentInterestsInOnePostLeaveOneRow() {
        AuthPrincipal caller = new AuthPrincipal(
                requester.getId(), Roles.Wire.BUYER, null, true, false);

        List<Throwable> outcomes = Races.run(RACERS, index ->
                seekers.express(caller, postId, "solo", "Hello from racer " + index));

        assertOneWinnerAndOneRefusal(outcomes, "flatmate", postId);
    }

    /**
     * The same press through the other door.
     *
     * <p>{@code FlatmateSupplyService.record} writes the same table against the same index, and
     * carries its own copy of the catch because it is a different method on a different service.
     * Covered separately for exactly that reason: "the code is identical" is a claim about today.
     */
    @Test
    @DisplayName("a room: the loser is refused with a 409 rather than a 500")
    void concurrentInterestsInOneRoomLeaveOneRow() {
        AuthPrincipal caller = new AuthPrincipal(
                requester.getId(), Roles.Wire.BUYER, null, true, false);

        List<Throwable> outcomes = Races.run(RACERS, index ->
                supply.roomInterest(caller, roomId, "solo", "Hello from racer " + index));

        assertOneWinnerAndOneRefusal(outcomes, "room", roomId);
    }
}
