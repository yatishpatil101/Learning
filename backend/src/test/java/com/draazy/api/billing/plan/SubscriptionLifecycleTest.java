package com.draazy.api.billing.plan;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/**
 * A paid plan stops working when the term ends — on the clock, not on the sweep (D57).
 *
 * <p><strong>What this is really guarding.</strong> The defect was that nothing ever aged a
 * subscription out, so a lapsed plan entitled its holder forever. The obvious fix — a scheduled job
 * — only shrinks that window to one tick, and a test that proved "the job expires rows" would pass
 * while an unpaid plan still worked for an hour. So the entitlement assertions here deliberately do
 * <em>not</em> run the sweep first: they prove the read path refuses a lapsed row on its own, and
 * the sweep is then proved separately to be honest bookkeeping on top.
 *
 * <p>Lives in {@code billing.plan} so it can build a {@link Subscription} through the
 * package-private constructor and set a term in the past directly. Going through the API and
 * backdating with SQL would test the same thing more slowly and less legibly.
 *
 * <p>The sweep's timer is off in the test run
 * ({@code draazy.billing.subscription-sweep.enabled=false}); {@link SubscriptionSweeper#expireLapsed}
 * is called here with an explicit instant instead, so nothing waits on a wall clock.
 */
@DisplayName("Subscription lifecycle — a term that ends, ends")
class SubscriptionLifecycleTest extends AbstractApiTest {

    /** Owner Plus, priced. Any plan id serves; nothing here reads the plan's own fields. */
    private static final String PAID_PLAN = "b1000000-0000-4000-8000-000000000002";

    private static final Instant NOW = Instant.parse("2026-06-01T00:00:00Z");
    private static final Instant LAST_MONTH = NOW.minus(30, ChronoUnit.DAYS);
    private static final Instant NEXT_MONTH = NOW.plus(30, ChronoUnit.DAYS);

    @Autowired UserRepository users;
    @Autowired SubscriptionRepository subscriptions;
    @Autowired SubscriptionSweeper sweeper;

    private User subscriber(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Plan Holder " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /** A subscription in whatever state the test needs, dated however it needs. */
    private Subscription subscription(User owner, String status, Instant startedAt, Instant renewsAt) {
        return subscriptions.saveAndFlush(new Subscription(owner.getId(),
                UUID.fromString(PAID_PLAN), status, startedAt, renewsAt, null, null));
    }

    // ---- 1: the sweep ends what has run out, and only what has run out ----

    @Test
    void theSweepExpiresATermThatHasRunOut() {
        User u = subscriber("9876540001");
        Subscription lapsed = subscription(u, SubscriptionStatuses.ACTIVE, LAST_MONTH, NOW.minus(1, ChronoUnit.DAYS));

        assertThat(sweeper.expireLapsed(NOW)).isEqualTo(1);
        assertThat(subscriptions.findById(lapsed.getId()).orElseThrow().getStatus())
                .isEqualTo(SubscriptionStatuses.EXPIRED);
    }

    @Test
    void aTermStillRunningIsLeftAlone() {
        User u = subscriber("9876540002");
        Subscription live = subscription(u, SubscriptionStatuses.ACTIVE, NOW, NEXT_MONTH);

        assertThat(sweeper.expireLapsed(NOW)).isZero();
        assertThat(subscriptions.findById(live.getId()).orElseThrow().getStatus())
                .isEqualTo(SubscriptionStatuses.ACTIVE);
    }

    @Test
    @DisplayName("a pending order is never expired — it has no term, because no money has arrived")
    void aPendingOrderIsNeverExpired() {
        User u = subscriber("9876540003");
        // renewsAt is null on a pending row by construction; expiring one would destroy an order
        // the buyer may still be paying for.
        Subscription pending = subscription(u, SubscriptionStatuses.PENDING, LAST_MONTH, null);

        assertThat(sweeper.expireLapsed(NOW)).isZero();
        assertThat(subscriptions.findById(pending.getId()).orElseThrow().getStatus())
                .isEqualTo(SubscriptionStatuses.PENDING);
    }

    @Test
    @DisplayName("a cancelled subscription keeps saying cancelled — why it ended is a fact worth keeping")
    void expiryNeverRewritesWhyASubscriptionEnded() {
        User u = subscriber("9876540004");
        Subscription cancelled = subscription(u, SubscriptionStatuses.CANCELLED, LAST_MONTH, NOW.minus(1, ChronoUnit.DAYS));

        assertThat(sweeper.expireLapsed(NOW)).isZero();
        assertThat(subscriptions.findById(cancelled.getId()).orElseThrow().getStatus())
                .isEqualTo(SubscriptionStatuses.CANCELLED);
    }

    @Test
    void sweepingTwiceExpiresNothingTheSecondTime() {
        User u = subscriber("9876540005");
        subscription(u, SubscriptionStatuses.ACTIVE, LAST_MONTH, NOW.minus(1, ChronoUnit.DAYS));

        assertThat(sweeper.expireLapsed(NOW)).isEqualTo(1);
        // Idempotent, which is what makes it safe to run on a timer and safe to run twice if two
        // instances ever overlap.
        assertThat(sweeper.expireLapsed(NOW)).isZero();
    }

    @Test
    @DisplayName("the renewal instant belongs to the next term, so a subscription is over the moment it arrives")
    void theBoundaryIsInclusive() {
        User u = subscriber("9876540006");
        subscription(u, SubscriptionStatuses.ACTIVE, LAST_MONTH, NOW);

        assertThat(sweeper.expireLapsed(NOW)).isEqualTo(1);
    }

    // ---- 2: entitlement is decided against the clock, not against the sweep ----

    @Test
    @DisplayName("a lapsed plan stops entitling immediately — without waiting for the sweep to run")
    void alapsedPlanStopsEntitlingBeforeTheSweepRuns() throws Exception {
        User u = subscriber("9876540007");
        // Deliberately still `active` in the database, and expireLapsed is NOT called. This is the
        // gap a scheduler alone would leave open.
        subscription(u, SubscriptionStatuses.ACTIVE, LAST_MONTH, Instant.now().minusSeconds(60));

        mvc.perform(get(Routes.Plans.SUBSCRIPTION).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").doesNotExist())
                .andExpect(jsonPath("$.status").doesNotExist());
    }

    @Test
    void aRunningPlanIsStillReported() throws Exception {
        User u = subscriber("9876540008");
        subscription(u, SubscriptionStatuses.ACTIVE, Instant.now(), Instant.now().plusSeconds(86_400));

        mvc.perform(get(Routes.Plans.SUBSCRIPTION).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(SubscriptionStatuses.ACTIVE));
    }

    @Test
    @DisplayName("a lapsed plan does not hide a pending order the holder is trying to pay for")
    void aPendingOrderSurfacesOnceTheOldPlanHasLapsed() throws Exception {
        User u = subscriber("9876540009");
        subscription(u, SubscriptionStatuses.ACTIVE, LAST_MONTH, Instant.now().minusSeconds(60));
        subscription(u, SubscriptionStatuses.PENDING, Instant.now(), null);

        // The lapsed row is filtered out, so the renewal the user has already started is what they
        // are shown — rather than an empty document that reads as "your checkout vanished".
        mvc.perform(get(Routes.Plans.SUBSCRIPTION).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(SubscriptionStatuses.PENDING));
    }
}
