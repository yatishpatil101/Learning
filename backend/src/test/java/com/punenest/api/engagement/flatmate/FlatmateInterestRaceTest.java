package com.punenest.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;

import com.punenest.api.common.error.RateLimitedException;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import com.punenest.api.support.Races;
import java.util.ArrayList;
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
 * The flatmate interest cap holds under a burst — the call site D73 was actually raised against.
 *
 * <p>Ten interests an hour is not an arbitrary number: each one hands a stranger's name and mobile
 * to a different person and puts a notification on their phone. The cap is the only thing between
 * that channel and a script working through the feed, and it was counted with a {@code countBy…}
 * followed by an insert, with nothing between them.
 *
 * <p><strong>Not on {@code AbstractApiTest}, and not by oversight.</strong> That base class is
 * {@code @Transactional} and rolls back, so its writes are never visible to another connection and a
 * commit-time race cannot be observed from it — see {@link Races} for the full argument. Everything
 * this class writes therefore commits, and {@link #cleanUp()} is what keeps the rest of the suite's
 * exact-count assertions honest.
 *
 * <p>It lives in the flatmates package because {@link FlatmateSeekerPost} and
 * {@link FlatmateRequest} both have package-private constructors — building the fixture through the
 * public API instead would mean nine HTTP round trips and three more accounts.
 */
@SpringBootTest
@DisplayName("Flatmate interests under concurrency — the cap D73 was raised against")
class FlatmateInterestRaceTest {

    /** {@code FlatmateSeekerService.MAX_INTERESTS}, which is private and stays that way. */
    private static final int CAP = 10;

    /**
     * How many racers. One free slot and two callers, so exactly one must be refused.
     *
     * <p>Two rather than three because of the connection pool, and the arithmetic is worth writing
     * down. The test datasource is capped at four connections deliberately (see
     * {@code src/test/resources/application.properties}), and the winning thread needs <em>two</em>
     * of them at once: its own transaction, plus the {@code REQUIRES_NEW} one that writes the
     * interest's audit row. Add a racer blocked on the advisory lock and the peak is three. A third
     * racer would take it to four — the entire pool, with nothing left for anything else in the
     * context — and the test would fail as a connection timeout rather than as a rate-limit defect.
     * Two threads prove the same thing: with the race open, both read nine, both insert, and the
     * account sends eleven interests in an hour.
     */
    private static final int RACERS = 2;

    @Autowired FlatmateSeekerService seekers;
    @Autowired FlatmateSeekerPostRepository posts;
    @Autowired FlatmateRequestRepository requests;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;

    private User requester;
    private final List<User> hosts = new ArrayList<>();
    private final List<UUID> postIds = new ArrayList<>();

    @BeforeEach
    void setUp() {
        requester = saveUser("9876000373", "Racer");
        for (int i = 0; i < RACERS; i++) {
            User host = saveUser("987600037" + (4 + i), "Host " + i);
            hosts.add(host);
            postIds.add(livePostFor(host));
        }
        // One slot short of the ceiling, so the correct answer to two simultaneous callers is
        // "one of you". Targets are arbitrary ids — the counter is keyed on the requester alone and
        // target_id carries no foreign key, which is what makes a nine-row fixture cheap.
        for (int i = 0; i < CAP - 1; i++) {
            requests.saveAndFlush(new FlatmateRequest("flatmate", UUID.randomUUID(),
                    hosts.get(0).getId(), requester.getId(), "request", "solo", "earlier"));
        }
        assertThat(countForRequester()).isEqualTo(CAP - 1);
    }

    @AfterEach
    void cleanUp() {
        List<UUID> everyone = new ArrayList<>(hosts.stream().map(User::getId).toList());
        if (requester != null) {
            everyone.add(requester.getId());
            jdbc.update("delete from flatmate_requests where requester_id = ?", requester.getId());
        }
        for (UUID hostId : hosts.stream().map(User::getId).toList()) {
            jdbc.update("delete from flatmate_requests where host_id = ?", hostId);
            jdbc.update("delete from notifications where user_id = ?", hostId);
        }
        for (UUID postId : postIds) {
            // The interest audit row commits in its own REQUIRES_NEW transaction, so it outlives
            // everything else here and has to be removed by hand.
            jdbc.update("delete from audit_log where entity_id = ?", postId.toString());
            jdbc.update("delete from flatmate_seeker_posts where id = ?", postId);
        }
        for (UUID userId : everyone) {
            jdbc.update("delete from users where id = ?", userId);
        }
        hosts.clear();
        postIds.clear();
        requester = null;
    }

    private User saveUser(String mobile, String name) {
        User user = new User(mobile, Roles.Wire.BUYER);
        user.setName(name);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private UUID livePostFor(User host) {
        FlatmateSeekerPost post = new FlatmateSeekerPost(host.getId(), host.getName(), 15_000L);
        // findVisible only returns publicly-visible posts, and a new one starts pending.
        post.setModStatus(FlatmateVocabulary.MOD_LIVE);
        return posts.saveAndFlush(post).getId();
    }

    private long countForRequester() {
        Long n = jdbc.queryForObject("select count(*) from flatmate_requests where requester_id = ?",
                Long.class, requester.getId());
        return n == null ? 0 : n;
    }

    /**
     * Two interests to two different posts, sent together by one account with one slot left.
     *
     * <p>Different posts matter: the per-(post, requester) unique index would absorb two attempts
     * at the <em>same</em> post all by itself, which would prove nothing about the counter. Both
     * writes are legal individually and the only thing standing between them and the ceiling is the
     * count.
     *
     * <p>Before the fix both read nine, both found room, and eleven interests left the account.
     */
    @Test
    @DisplayName("two simultaneous interests fill the last slot once")
    void concurrentInterestsCannotOverfillTheHourlyCap() {
        AuthPrincipal caller = new AuthPrincipal(
                requester.getId(), Roles.Wire.BUYER, null, true, false);

        List<Throwable> outcomes = Races.run(RACERS, index ->
                seekers.express(caller, postIds.get(index), "solo", "Hello from racer " + index));

        for (Throwable outcome : outcomes) {
            if (outcome != null && !(outcome instanceof RateLimitedException)) {
                throw new AssertionError(
                        "a racer failed with something other than the business refusal", outcome);
            }
        }
        assertThat(outcomes.stream().filter(RateLimitedException.class::isInstance).count())
                .as("exactly one racer must be refused")
                .isEqualTo(RACERS - 1);
        assertThat(countForRequester())
                .as("every extra row here is one more stranger holding this person's number")
                .isEqualTo(CAP);
    }
}
