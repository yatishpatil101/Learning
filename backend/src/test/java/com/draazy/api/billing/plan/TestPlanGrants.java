package com.draazy.api.billing.plan;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Grants a live plan to a test user from outside {@code billing.plan}.
 *
 * <p><strong>Why this exists.</strong> {@link Subscription}'s constructor is package-private, so
 * tests in other packages cannot seed one — which was fine while nothing outside billing cared what
 * plan a user held. The listing quota changed that: {@code POST /me/listings} now refuses a
 * free-tier owner their second listing, so any test that needs one owner to hold two listings needs
 * a way to raise their ceiling. Widening the constructor to let them would open the same door in
 * production, where the only legitimate way to acquire a subscription is to pay for one.
 *
 * <p>Deliberately not a general "give this user anything" fixture: it grants one of the seeded
 * priced plans, active and unexpired, exactly as a completed checkout would. A test that wants a
 * different shape should go through the checkout it is presumably testing.
 */
@Component
public class TestPlanGrants {

    /** Owner Plus — priced, {@code listing_limit = 2}, and {@code unlimited_contacts} since V91. */
    public static final UUID OWNER_PLUS = UUID.fromString("b1000000-0000-4000-8000-000000000002");

    @Autowired SubscriptionRepository subscriptions;

    /** Put {@code userId} on {@code planId}, active for the next thirty days. */
    public void grant(UUID userId, UUID planId) {
        subscriptions.saveAndFlush(new Subscription(userId, planId, SubscriptionStatuses.ACTIVE,
                Instant.now(), Instant.now().plus(30, ChronoUnit.DAYS), null, null));
    }
}
