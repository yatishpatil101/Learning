package com.punenest.api.finance.rent;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.finance.tenancy.Tenancy;
import com.punenest.api.finance.tenancy.TenancyRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.JwtService;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.PageRequest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * Contract + behaviour proof for the rent money rail (slice 6).
 *
 * <p>The load-bearing tests here are the ones that guard money. A rent payment is the only place in
 * this application where a bug costs a real person real rupees, so three properties get proved
 * rather than assumed:
 *
 * <ol>
 *   <li><strong>The server decides the amount.</strong> The client may refuse a charge via
 *       {@code expectedAmount}, but it can never set one — spec fixes S12/S13.</li>
 *   <li><strong>A payment is created pending.</strong> Nothing on this controller can write
 *       {@code paid}; only the signature-verified webhook can (see {@link PaymentWebhookTest}).</li>
 *   <li><strong>A retry does not charge twice.</strong> {@code Idempotency-Key} replays the original
 *       payment, and the same month cannot be paid twice even without the header.</li>
 * </ol>
 *
 * <p>Scoping is proved with 404 rather than 403 throughout: a stranger's tenancy id and a malformed
 * one must be indistinguishable, or the endpoint becomes an oracle for which tenancies exist.
 */
class RentEndpointsTest extends AbstractApiTest {

    /** Rent on the fixture tenancy; the fee arithmetic below is derived from it. */
    private static final long RENT = 28_000L;

    /** 2% of {@link #RENT}, matching the frontend mock's {@code calcRentFee}. */
    private static final long FEE = 560L;

    /** 18% GST on the fee — 100.8 rounded HALF_UP, as an invoice rounds. */
    private static final long GST = 101L;

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired TenancyRepository tenancies;
    @Autowired RentPaymentRepository payments;
    @Autowired RentFeeCalculator feeCalculator;
    @Autowired @Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping handlerMapping;

    // ---- fixtures ----

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Rent User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /** A let flat, closed to a tenant — which is what opens the tenancy the rent rail bills on. */
    private Tenancy tenancyFor(User owner, User tenant) throws Exception {
        Property p = new Property(owner, "Let flat", "rent", "apartment", RENT, "Baner", "Pune");
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

    private String payBody(UUID tenancyId) {
        return "{\"tenancyId\":\"" + tenancyId + "\"}";
    }

    /**
     * The tenant's payments as a plain list. The repository read is paged for the wire, but these
     * assertions are about <em>whether a row was written at all</em>, so a fixed generous page keeps
     * them reading as the state checks they are. It is far larger than any fixture, so a genuine
     * duplicate cannot hide behind the page boundary.
     */
    private List<RentPayment> paymentsOf(UUID tenantId) {
        return payments.findByTenantId(tenantId, PageRequest.of(0, 100)).getContent();
    }

    // ---- 1: the server owns the amount (S12 + S13) ----

    @Test
    void payRent_derivesAmountFeeAndGstFromTheTenancy_notFromTheClient() throws Exception {
        User owner = user("9833300001", "owner");
        User tenant = user("9833300002", "buyer");
        Tenancy t = tenancyFor(owner, tenant);

        mvc.perform(post(Routes.Rent.PAYMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payBody(t.getId())))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amount").value(RENT))
                .andExpect(jsonPath("$.platformFee").value(FEE))
                .andExpect(jsonPath("$.gst").value(GST))
                // The 201 says an order exists, not that money moved.
                .andExpect(jsonPath("$.status").value(RentPaymentStatuses.DUE))
                .andExpect(jsonPath("$.paidDate").doesNotExist())
                .andExpect(jsonPath("$.reference").isNotEmpty());
    }

    @Test
    void feeArithmetic_matchesTheFrontendMockToTheRupee() {
        // Parity with lib/store/rent.js calcRentFee: fee on the rent, GST on the fee, HALF_UP.
        RentFeeCalculator.Breakdown b = feeCalculator.compute(RENT);
        assertThat(b.amount()).isEqualTo(RENT);
        assertThat(b.platformFee()).isEqualTo(FEE);
        assertThat(b.gst()).isEqualTo(GST);
        assertThat(b.total()).isEqualTo(RENT + FEE + GST);
    }

    @Test
    void payRent_refusesAStaleExpectedAmount() throws Exception {
        User owner = user("9833300003", "owner");
        User tenant = user("9833300004", "buyer");
        Tenancy t = tenancyFor(owner, tenant);

        // The tenant is confirming a figure that no longer matches the tenancy: optimistic
        // concurrency, so 409 - the same shape as a stale ETag.
        mvc.perform(post(Routes.Rent.PAYMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenancyId\":\"" + t.getId() + "\",\"expectedAmount\":25000}"))
                .andExpect(status().isConflict());

        assertThat(paymentsOf(tenant.getId())).isEmpty();
    }

    @Test
    void payRent_acceptsAMatchingExpectedAmount() throws Exception {
        User owner = user("9833300005", "owner");
        User tenant = user("9833300006", "buyer");
        Tenancy t = tenancyFor(owner, tenant);

        mvc.perform(post(Routes.Rent.PAYMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenancyId\":\"" + t.getId() + "\",\"expectedAmount\":" + RENT + "}"))
                .andExpect(status().isCreated());
    }

    // ---- 2: paying twice ----

    @Test
    void payRent_replaysTheOriginalPaymentForARepeatedIdempotencyKey() throws Exception {
        User owner = user("9833300007", "owner");
        User tenant = user("9833300008", "buyer");
        Tenancy t = tenancyFor(owner, tenant);

        String first = mvc.perform(post(Routes.Rent.PAYMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .header("Idempotency-Key", "tap-tap-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payBody(t.getId())))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        // The same key must return the same payment - not a second charge, and not a 409 about the
        // month already being in progress, which is what a naive ordering of the checks would give.
        mvc.perform(post(Routes.Rent.PAYMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .header("Idempotency-Key", "tap-tap-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payBody(t.getId())))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(jsonId(first)));

        assertThat(paymentsOf(tenant.getId())).hasSize(1);
    }

    @Test
    void payRent_refusesASecondPaymentForTheSameMonth() throws Exception {
        User owner = user("9833300009", "owner");
        User tenant = user("9833300010", "buyer");
        Tenancy t = tenancyFor(owner, tenant);

        mvc.perform(post(Routes.Rent.PAYMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payBody(t.getId())))
                .andExpect(status().isCreated());

        // No idempotency key this time: the month itself is the guard, backed by a partial unique
        // index in V14 rather than only this service check (the V9 lesson).
        mvc.perform(post(Routes.Rent.PAYMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payBody(t.getId())))
                .andExpect(status().isConflict());

        assertThat(paymentsOf(tenant.getId())).hasSize(1);
    }

    @Test
    void payRent_doesNotReplayAnotherTenantsIdempotencyKey() throws Exception {
        User ownerA = user("9833300036", "owner");
        User tenantA = user("9833300037", "buyer");
        Tenancy a = tenancyFor(ownerA, tenantA);

        User ownerB = user("9833300038", "owner");
        User tenantB = user("9833300039", "buyer");
        Tenancy b = tenancyFor(ownerB, tenantB);

        String shared = "guessable-key";

        mvc.perform(post(Routes.Rent.PAYMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenantA))
                        .header("Idempotency-Key", shared)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payBody(a.getId())))
                .andExpect(status().isCreated());

        // Tenant B presents tenant A's key. An unscoped replay would hand B a copy of A's payment
        // - amount, fees and gateway reference - from an endpoint that never checked whose it was.
        // B must simply get their own new payment on their own tenancy.
        String bBody = mvc.perform(post(Routes.Rent.PAYMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenantB))
                        .header("Idempotency-Key", shared)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payBody(b.getId())))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.tenancyId").value(b.getId().toString()))
                .andReturn().getResponse().getContentAsString();

        assertThat(bBody).doesNotContain(a.getId().toString());
        assertThat(paymentsOf(tenantA.getId())).hasSize(1);
        assertThat(paymentsOf(tenantB.getId())).hasSize(1);
    }

    // ---- 3: scoping ----

    @Test
    void payRent_answers404ForSomebodyElsesTenancy() throws Exception {
        User owner = user("9833300011", "owner");
        User tenant = user("9833300012", "buyer");
        User stranger = user("9833300013", "buyer");
        Tenancy t = tenancyFor(owner, tenant);

        mvc.perform(post(Routes.Rent.PAYMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payBody(t.getId())))
                .andExpect(status().isNotFound());
    }

    @Test
    void payRent_answers404ForTheOwnerToo_becauseTheOwnerIsNotTheTenant() throws Exception {
        User owner = user("9833300014", "owner");
        User tenant = user("9833300015", "buyer");
        Tenancy t = tenancyFor(owner, tenant);

        // The owner is a participant in the tenancy but is not the party who owes rent. Letting
        // them pay would let a landlord fabricate a payment record against their tenant.
        mvc.perform(post(Routes.Rent.PAYMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payBody(t.getId())))
                .andExpect(status().isNotFound());
    }

    @Test
    void payRent_answers404ForAMalformedTenancyId_notAParseError() throws Exception {
        User tenant = user("9833300016", "buyer");

        // Same answer as a stranger's id on purpose: a 400 here would tell a prober that their
        // well-formed guesses are being looked up and only the shape was wrong.
        mvc.perform(post(Routes.Rent.PAYMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenancyId\":\"not-a-uuid\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void rentPaymentsAndLedger_showTheTwoSidesAndNothingToAStranger() throws Exception {
        User owner = user("9833300017", "owner");
        User tenant = user("9833300018", "buyer");
        User stranger = user("9833300019", "buyer");
        Tenancy t = tenancyFor(owner, tenant);

        mvc.perform(post(Routes.Rent.PAYMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payBody(t.getId())))
                .andExpect(status().isCreated());

        mvc.perform(get(Routes.Rent.PAYMENTS).header(HttpHeaders.AUTHORIZATION, bearer(tenant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1));

        mvc.perform(get(Routes.Rent.LEDGER).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].amount").value(RENT));

        // A tenant's ledger and an owner's payments are both empty - the two reads are not aliases.
        mvc.perform(get(Routes.Rent.LEDGER).header(HttpHeaders.AUTHORIZATION, bearer(tenant)))
                .andExpect(jsonPath("$.content.length()").value(0));
        mvc.perform(get(Routes.Rent.PAYMENTS).header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(jsonPath("$.content.length()").value(0));
        mvc.perform(get(Routes.Rent.LEDGER).header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(jsonPath("$.content.length()").value(0));
    }

    /**
     * Both rent reads are paged (api-standards.md §5.1): they sit under {@code /me/} and so look
     * personal, but a rent ledger accrues a row a month for as long as the tenancy runs, and an
     * owner's ledger spans every tenancy on every listing they have ever let. Growth is the test,
     * not scope.
     *
     * <p>Two tenancies, not two payments on one — V14's partial unique index correctly refuses a
     * second live payment for the same month, which is exactly the guard a second call would trip.
     *
     * <p>The hostile {@code sort} is deliberate: neither operation declares one, so the controller
     * must drop it. Passing it through would reach the query as an unknown property and surface as
     * a 500 rather than being ignored.
     */
    @Test
    void rentPaymentsAndLedger_arePagedAndClampPageSize() throws Exception {
        User owner = user("9833300031", "owner");
        User tenant = user("9833300032", "buyer");
        Tenancy a = tenancyFor(owner, tenant);
        Tenancy b = tenancyFor(owner, tenant);

        for (Tenancy t : new Tenancy[] {a, b}) {
            mvc.perform(post(Routes.Rent.PAYMENTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(payBody(t.getId())))
                    .andExpect(status().isCreated());
        }

        mvc.perform(get(Routes.Rent.PAYMENTS + "?page=0&size=1")
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.totalPages").value(2));

        mvc.perform(get(Routes.Rent.LEDGER + "?size=100000&sort=nosuchfield,desc")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(100))
                .andExpect(jsonPath("$.content.length()").value(2));
    }

    @Test
    void rentEndpoints_requireAuthentication() throws Exception {
        mvc.perform(get(Routes.Rent.PAYMENTS)).andExpect(status().isUnauthorized());
        mvc.perform(get(Routes.Rent.LEDGER)).andExpect(status().isUnauthorized());
        mvc.perform(get(Routes.Rent.MANDATE)).andExpect(status().isUnauthorized());
        mvc.perform(get(Routes.Rent.PAYOUT_ACCOUNT)).andExpect(status().isUnauthorized());
    }

    // ---- 4: the autopay mandate ----

    @Test
    void mandate_isEmptyBeforeItIsSet_thenCreatesActive() throws Exception {
        User owner = user("9833300020", "owner");
        User tenant = user("9833300021", "buyer");
        Tenancy t = tenancyFor(owner, tenant);

        // D5: an unset singleton reads as an empty shape, not a 404 - the client renders the same
        // blank form either way, and a 404 would make it branch on an error to draw a form.
        mvc.perform(get(Routes.Rent.MANDATE).header(HttpHeaders.AUTHORIZATION, bearer(tenant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").doesNotExist())
                .andExpect(jsonPath("$.status").doesNotExist());

        mvc.perform(put(Routes.Rent.MANDATE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenancyId\":\"" + t.getId()
                                + "\",\"maxAmount\":30000,\"dayOfMonth\":5}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(MandateStatuses.ACTIVE))
                .andExpect(jsonPath("$.maxAmount").value(30000))
                .andExpect(jsonPath("$.dayOfMonth").value(5))
                .andExpect(jsonPath("$.provider").value("cashfree"));

        mvc.perform(get(Routes.Rent.MANDATE).header(HttpHeaders.AUTHORIZATION, bearer(tenant)))
                .andExpect(jsonPath("$.status").value(MandateStatuses.ACTIVE));
    }

    @Test
    void mandate_pausesAndResumes_butRevokingIsOneWay() throws Exception {
        User owner = user("9833300022", "owner");
        User tenant = user("9833300023", "buyer");
        Tenancy t = tenancyFor(owner, tenant);
        String id = "{\"tenancyId\":\"" + t.getId() + "\"";

        mvc.perform(put(Routes.Rent.MANDATE).header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(id + ",\"maxAmount\":30000,\"dayOfMonth\":5}"))
                .andExpect(status().isOk());

        mvc.perform(put(Routes.Rent.MANDATE).header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(id + ",\"status\":\"" + MandateStatuses.PAUSED + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(MandateStatuses.PAUSED));

        // A paused mandate must stay visible, or the tenant has no way to reach it again.
        mvc.perform(get(Routes.Rent.MANDATE).header(HttpHeaders.AUTHORIZATION, bearer(tenant)))
                .andExpect(jsonPath("$.status").value(MandateStatuses.PAUSED));

        // Resuming consents to nothing new - the ceiling and the day are unchanged - so it is
        // allowed. Pause would otherwise be a one-way door disguised as a toggle.
        mvc.perform(put(Routes.Rent.MANDATE).header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(id + ",\"status\":\"" + MandateStatuses.ACTIVE + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(MandateStatuses.ACTIVE))
                .andExpect(jsonPath("$.maxAmount").value(30000));

        mvc.perform(put(Routes.Rent.MANDATE).header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(id + ",\"status\":\"" + MandateStatuses.REVOKED + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(MandateStatuses.REVOKED));

        // Revoking withdrew the instruction. Reviving it would be charging a bank account on
        // consent the tenant took back, so the revoked mandate is gone from every read and write.
        mvc.perform(put(Routes.Rent.MANDATE).header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(id + ",\"status\":\"" + MandateStatuses.ACTIVE + "\"}"))
                .andExpect(status().isNotFound());

        mvc.perform(get(Routes.Rent.MANDATE).header(HttpHeaders.AUTHORIZATION, bearer(tenant)))
                .andExpect(jsonPath("$.status").doesNotExist());
    }

    @Test
    void mandate_canBeSetUpAgainAfterRevoking() throws Exception {
        User owner = user("9833300032", "owner");
        User tenant = user("9833300033", "buyer");
        Tenancy t = tenancyFor(owner, tenant);
        String id = "{\"tenancyId\":\"" + t.getId() + "\"";

        mvc.perform(put(Routes.Rent.MANDATE).header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(id + ",\"maxAmount\":30000,\"dayOfMonth\":5}"))
                .andExpect(status().isOk());
        mvc.perform(put(Routes.Rent.MANDATE).header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(id + ",\"status\":\"" + MandateStatuses.REVOKED + "\"}"))
                .andExpect(status().isOk());

        // The revoked row stays for the record, and the partial unique index excludes it, so a
        // fresh mandate can be created. A tenant who cancels autopay is not locked out of it.
        mvc.perform(put(Routes.Rent.MANDATE).header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(id + ",\"maxAmount\":32000,\"dayOfMonth\":7}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(MandateStatuses.ACTIVE))
                .andExpect(jsonPath("$.maxAmount").value(32000));
    }

    @Test
    void mandate_rejectsAnUnknownStatusValue() throws Exception {
        User owner = user("9833300034", "owner");
        User tenant = user("9833300035", "buyer");
        Tenancy t = tenancyFor(owner, tenant);
        String id = "{\"tenancyId\":\"" + t.getId() + "\"";

        mvc.perform(put(Routes.Rent.MANDATE).header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(id + ",\"maxAmount\":30000,\"dayOfMonth\":5}"))
                .andExpect(status().isOk());

        // An unknown vocabulary value is the caller's bug (400), not a state conflict (409).
        mvc.perform(put(Routes.Rent.MANDATE).header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(id + ",\"status\":\"cancelled\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void mandate_cannotBeSetOnSomebodyElsesTenancy() throws Exception {
        User owner = user("9833300024", "owner");
        User tenant = user("9833300025", "buyer");
        User stranger = user("9833300026", "buyer");
        Tenancy t = tenancyFor(owner, tenant);

        mvc.perform(put(Routes.Rent.MANDATE).header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenancyId\":\"" + t.getId()
                                + "\",\"maxAmount\":30000,\"dayOfMonth\":5}"))
                .andExpect(status().isNotFound());
    }

    // ---- 5: the payout account ----

    @Test
    void payoutAccount_masksTheAccountNumberAndNeverEchoesItBack() throws Exception {
        User owner = user("9833300027", "owner");

        mvc.perform(get(Routes.Rent.PAYOUT_ACCOUNT).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verified").value(false))
                .andExpect(jsonPath("$.accountHolder").doesNotExist());

        String saved = mvc.perform(put(Routes.Rent.PAYOUT_ACCOUNT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountHolder\":\"A Sharma\",\"accountNumber\":\"123456787890\","
                                + "\"ifsc\":\"HDFC0001234\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.maskedAccount").value("XXXXXXXX7890"))
                .andExpect(jsonPath("$.ifsc").value("HDFC0001234"))
                .andExpect(jsonPath("$.verified").value(false))
                .andReturn().getResponse().getContentAsString();

        // The full number must not survive anywhere in the response.
        assertThat(saved).doesNotContain("123456787890");
    }

    @Test
    void payoutAccount_replacesRatherThanMerges() throws Exception {
        User owner = user("9833300028", "owner");

        mvc.perform(put(Routes.Rent.PAYOUT_ACCOUNT).header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountHolder\":\"A Sharma\",\"accountNumber\":\"123456787890\","
                                + "\"ifsc\":\"HDFC0001234\"}"))
                .andExpect(status().isOk());

        // Switching to UPI must not leave the old IFSC behind: a destination assembled from two
        // different submissions is a payout to nowhere.
        mvc.perform(put(Routes.Rent.PAYOUT_ACCOUNT).header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountHolder\":\"A Sharma\",\"upiId\":\"asharma@okhdfcbank\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.upiId").value("asharma@okhdfcbank"))
                .andExpect(jsonPath("$.ifsc").doesNotExist())
                .andExpect(jsonPath("$.maskedAccount").doesNotExist());
    }

    @Test
    void payoutAccount_rejectsAnEmptyDestinationAndABadIfsc() throws Exception {
        User owner = user("9833300029", "owner");

        mvc.perform(put(Routes.Rent.PAYOUT_ACCOUNT).header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountHolder\":\"A Sharma\"}"))
                .andExpect(status().isBadRequest());

        // Bean validation on the IFSC pattern - 422, per api-standards §3.
        mvc.perform(put(Routes.Rent.PAYOUT_ACCOUNT).header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountHolder\":\"A Sharma\",\"accountNumber\":\"123456787890\","
                                + "\"ifsc\":\"nonsense\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void payoutAccount_refusesBothABankAccountAndAUpiIdAtOnce() throws Exception {
        User owner = user("9833300040", "owner");

        // Two destinations and no rule for choosing means the money lands wherever the code
        // happens to look first, and the owner cannot tell which they configured.
        mvc.perform(put(Routes.Rent.PAYOUT_ACCOUNT).header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountHolder\":\"A Sharma\",\"accountNumber\":\"123456787890\","
                                + "\"ifsc\":\"HDFC0001234\",\"upiId\":\"asharma@okhdfcbank\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void payoutAccount_isPerOwner_andOneOwnerNeverSeesAnother() throws Exception {
        User first = user("9833300030", "owner");
        User second = user("9833300031", "owner");

        mvc.perform(put(Routes.Rent.PAYOUT_ACCOUNT).header(HttpHeaders.AUTHORIZATION, bearer(first))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountHolder\":\"First Owner\",\"upiId\":\"first@okaxis\"}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Rent.PAYOUT_ACCOUNT).header(HttpHeaders.AUTHORIZATION, bearer(second)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.upiId").doesNotExist())
                .andExpect(jsonPath("$.accountHolder").doesNotExist());
    }

    // ---- 6: the routes are the ones security is bound to ----

    @Test
    void everyRentRouteIsDeclaredAsARouteConstant() {
        Set<String> mapped = handlerMapping.getHandlerMethods().keySet().stream()
                .filter(info -> info.getPathPatternsCondition() != null)
                .flatMap(info -> info.getPathPatternsCondition().getPatternValues().stream())
                .collect(Collectors.toSet());

        // A route typed as a literal in a controller is a route SecurityConfig does not know about.
        assertThat(mapped)
                .contains(Routes.Rent.PAYMENTS, Routes.Rent.LEDGER, Routes.Rent.MANDATE,
                        Routes.Rent.PAYOUT_ACCOUNT, Routes.Webhooks.CASHFREE_PAYMENT);
    }

    private static String jsonId(String body) {
        int i = body.indexOf("\"id\":\"") + 6;
        return body.substring(i, body.indexOf('"', i));
    }
}
