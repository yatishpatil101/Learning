package com.punenest.api.finance.rent;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.finance.tenancy.Tenancy;
import com.punenest.api.finance.tenancy.TenancyRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.util.AopTestUtils;

/**
 * The rent month is the Indian one, not the host's — tech debt D179.
 *
 * <p><strong>The bug this pins.</strong> {@code RentService.open} anchors a payment on the first of
 * the current month, and used to read a bare {@code LocalDate.now().withDayOfMonth(1)}. That
 * resolves against {@code TimeZone.getDefault()}, so on a UTC host the JVM is still on
 * <em>yesterday's</em> date for the first 5.5 hours of every Indian day. Between 00:00 and 05:29 IST
 * on the 1st of a month — midnight to dawn on the single day a tenant is most likely to pay, and the
 * day standing instructions fire — the service would answer the <em>previous</em> month.
 *
 * <p>That is not a cosmetic date on a receipt. {@code due_date} is the identity of the month being
 * settled, and V14's {@code uq_rent_payments_live_per_due_date} enforces one live payment per
 * tenancy per month against it. So the failure is two-sided and both sides are wrong in the tenant's
 * disfavour: the month that has just fallen due is left unpaid, and the tenant is told it is
 * "already paid or in progress" because the row the service collides with is last month's, which
 * they really did pay. {@link #payingAtIstMidnight_doesNotCollideWithThePreviousMonthsPaidRow()}
 * reproduces exactly that.
 *
 * <p><strong>Why the pinned clock is deliberately UTC-zoned.</strong> Following
 * {@code FinanceIstBoundaryTest}: {@link Clock#fixed} carries a zone of its own, and pinning it to
 * {@code Asia/Kolkata} would prove only that this test knows about IST. Pinning it to
 * {@link ZoneOffset#UTC} reproduces the exact host configuration that causes the bug, so the IST
 * answer asserted below is one the <em>service</em> chose.
 */
class RentIstBoundaryTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired TenancyRepository tenancies;
    @Autowired RentPaymentRepository payments;
    @Autowired RentService rentService;

    private static final long RENT = 28_000L;

    /** 04:30 IST on 1 January 2026 — still 31 December 2025 to a UTC host. */
    private static final Instant IST_NEW_MONTH_DAWN = Instant.parse("2025-12-31T23:00:00Z");

    /** The rent month the service must derive. */
    private static final LocalDate JANUARY = LocalDate.of(2026, 1, 1);

    /** The rent month a UTC host would derive — the one the tenant has already paid. */
    private static final LocalDate DECEMBER = LocalDate.of(2025, 12, 1);

    /**
     * Restore the system clock. The service is an application-scoped singleton, so a pinned clock
     * left behind would follow every later test in this JVM into 2026.
     */
    @AfterEach
    void unpinClock() {
        target().useClock(null);
    }

    /**
     * The bean behind the {@code @Transactional} proxy. Writing the field through the proxy would
     * set it on the CGLIB subclass and leave the target — the object whose methods actually run —
     * on the system clock, so the test would pass for the wrong reason.
     */
    private RentService target() {
        return AopTestUtils.getTargetObject(rentService);
    }

    private void pinToIstNewMonthDawn() {
        target().useClock(Clock.fixed(IST_NEW_MONTH_DAWN, ZoneOffset.UTC));
    }

    // ---- fixture ----

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Boundary " + role + " " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /**
     * A let flat, closed to a tenant — which is what opens the tenancy the rent rail bills on.
     * Built before the clock is pinned in every test below: closing a deal stamps the tenancy's
     * start date, so seeding under a pinned clock would make the fixture depend on the thing under
     * test.
     */
    private Tenancy tenancyFor(User owner, User tenant) throws Exception {
        Property p = new Property(owner, "Boundary let flat", "rent", "apartment",
                RENT, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("950"));
        properties.saveAndFlush(p);

        mvc.perform(post("/me/deals/" + p.getId() + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":" + RENT + ",\"counterpartyMobile\":\""
                                + tenant.getMobile() + "\"}"))
                .andExpect(status().isOk());

        return tenancies.findActiveByPropertyId(p.getId()).orElseThrow();
    }

    private org.springframework.test.web.servlet.ResultActions payRent(User tenant, Tenancy t)
            throws Exception {
        return mvc.perform(post(Routes.Rent.PAYMENTS)
                .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"tenancyId\":\"" + t.getId() + "\"}"));
    }

    // ---- 1: the rent month rolls over with India, not with the host ----

    /**
     * At 04:30 IST on 1 January the month being settled is January, not December.
     *
     * <p>{@code dueDate} is asserted on the wire because it is the month the tenant sees on their
     * receipt and the key the ledger is reconciled by. A UTC host reads 31 December 2025 and
     * {@code withDayOfMonth(1)} turns that into 1 December 2025 — a whole month out, from a date
     * that is only one day out.
     */
    @Test
    void payRent_anchorsOnTheIndianMonth_notTheHostsPreviousOne() throws Exception {
        User owner = user("9833400001", "owner");
        User tenant = user("9833400002", "buyer");
        Tenancy t = tenancyFor(owner, tenant);

        pinToIstNewMonthDawn();

        payRent(tenant, t)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.dueDate").value(JANUARY.toString()));
    }

    // ---- 2: the harm that month is the tenant being refused ----

    /**
     * December's paid row must not block January's payment.
     *
     * <p>This is the failure the tenant actually meets. With December already settled, a UTC host
     * recomputes December as "this month", {@code existsLiveForDueDate} finds that row, and the
     * tenant is answered 409 "Rent for this month is already paid or in progress" for a month they
     * have not paid — while January quietly stays open. Asserting 201 <em>and</em> the January due
     * date together is what separates "the guard let it through" from "the guard was asked about the
     * right month".
     */
    @Test
    void payingAtIstMidnight_doesNotCollideWithThePreviousMonthsPaidRow() throws Exception {
        User owner = user("9833400003", "owner");
        User tenant = user("9833400004", "buyer");
        Tenancy t = tenancyFor(owner, tenant);

        // December's rent, already live on the ledger. Written directly rather than through the
        // endpoint because the endpoint derives the month from the clock — the whole point at issue.
        payments.saveAndFlush(new RentPayment(t.getId(), RENT, 560L, 101L, DECEMBER,
                PaymentMethods.UPI, null));

        pinToIstNewMonthDawn();

        payRent(tenant, t)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.dueDate").value(JANUARY.toString()));
    }
}
