package com.draazy.api.billing.plan;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.common.settings.PlatformSettings;
import com.draazy.api.support.AbstractApiTest;
import java.util.Map;
import java.util.function.LongSupplier;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Every priced plan costs the same in both tables that name a price for it.
 *
 * <p><strong>The bug this exists for.</strong> {@code plans} is the catalogue — the row
 * {@code CheckoutService} charges — and {@code settings.fees} is the back-office schedule the
 * client falls back to before the catalogue resolves. Both answer "what does Owner Plus cost", and
 * on the seeded data they disagreed: 2499 / 4999 / 299 in the catalogue against 999 / 2499 / 199 in
 * the schedule. Two consequences, neither of which any existing test could see.
 *
 * <p>First, the {@code /plans} FAQ priced itself off the schedule and answered <em>Owner Pro</em>
 * with <em>Owner Plus</em>'s real price — a wrong number that looked right, because it was a real
 * price of a real plan, quoted directly beneath a card showing a third figure. An off-by-one-row
 * seed reads as plausible copy in a way an obvious typo does not.
 *
 * <p>Second, the fallback is still live: a paywall that renders before the catalogue lands quotes
 * the schedule, so while the two disagreed any slow or failed catalogue read put a price on screen
 * that the customer would not be billed. That is the shape of the defect
 * {@code Checkout.jsx} already carries a comment about — "Pay ₹999" and be billed ₹2,499.
 *
 * <p><strong>Why a test and not a foreign key.</strong> The two are deliberately separate: an
 * operator edits the schedule through the admin console, while the catalogue carries entitlements
 * (listing limits, features) an operator must not be able to reshape from a fees panel. Merging
 * them would make adding a plan a settings edit. So the invariant is agreement, not identity, and
 * agreement is a thing to assert.
 *
 * <p><strong>What this does not cover.</strong> Two blind spots, both worth knowing before trusting
 * a green run. It compares the two <em>seeded</em> blocks, so it cannot see {@code PUT
 * /admin/settings} reprice a plan at runtime — that path deep-merges the fees block with no plans
 * write and no cross-check, and recreates the original defect in production while this stays green.
 * And if the {@code fees} key were deleted outright, {@link PlatformSettings}'s compiled-in
 * defaults happen to equal the seed, so the fallback would satisfy this rather than fail it.
 */
class PlanPriceMatchesFeeScheduleTest extends AbstractApiTest {

    @Autowired PlanRepository plans;

    @Autowired PlatformSettings settings;

    /**
     * Keyed by the catalogue's {@code name} rather than its UUID: the id proves only that a row
     * exists, while the name is what an operator matches the fees panel against by eye, and a
     * renamed plan whose price stopped being checked is exactly the drift this guards.
     *
     * <p>Seeker Plus is here for the same reason the owner plans are: it drifted too, 299 in the
     * catalogue against the schedule's 199, and it is quoted through the same fallback in both
     * {@code Plans.jsx} and {@code Checkout.jsx} \u2014 so a seeker could be shown \u20b9199 and billed \u20b9299.
     * A plan is exempt from this map only when the schedule names no key for it, which is true of
     * Owner Free alone.
     */
    @Test
    void planPricesAgreeWithTheFeeSchedule() {
        Map<String, LongSupplier> expected = Map.of(
                "Owner Plus", settings::ownerPlanYearly,
                "Owner Pro", settings::ownerProYearly,
                "Seeker Plus", settings::seekerPlusTopup);

        for (Map.Entry<String, LongSupplier> e : expected.entrySet()) {
            assertThat(plans.findAll())
                    .filteredOn(p -> e.getKey().equals(p.getName()))
                    .as(
                            "exactly one seeded plan is named %s — the name is the key an operator"
                                    + " matches the fees panel against, so a duplicate makes this"
                                    + " assert whichever row happened to come back first",
                            e.getKey())
                    .singleElement()
                    .extracting(Plan::getPrice)
                    .as(
                            "%s is charged at the catalogue price, so a fee schedule that disagrees is a"
                                    + " live mis-quote on every surface that renders the fallback",
                            e.getKey())
                    .isEqualTo(e.getValue().getAsLong());
        }
    }

    /**
     * The free tier is free in the catalogue.
     *
     * <p>Not covered above because the schedule names no key for it: were it ever given a price,
     * every "your first listing is free" promise on the site would become a lie collected at
     * checkout, and nothing else asserts the zero.
     */
    @Test
    void theFreeOwnerPlanCostsNothing() {
        assertThat(plans.findAll())
                .filteredOn(p -> "Owner Free".equals(p.getName()))
                .singleElement()
                .extracting(Plan::getPrice)
                .isEqualTo(0L);
    }
}
