package com.punenest.api.deals.visit;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.JwtService;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * Contract + behaviour proof for the visits sub-slice (A4), driven through the real filter chain
 * against the live Flyway'd Postgres under {@code ddl-auto=validate}.
 *
 * <p>Covers every test in the §11 bar: schedule via both endpoints, role-split transitions
 * (anti-fake-review guard), caller-scoped lists (S3 privacy fix), mobile masking, duplicate
 * prevention, illegal transition, past-slot acceptance, and route-constant agreement.
 */
class VisitEndpointsTest extends AbstractApiTest {

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired VisitRepository visitRepo;
    @Autowired
    @org.springframework.beans.factory.annotation.Qualifier("requestMappingHandlerMapping")
    RequestMappingHandlerMapping handlerMapping;

    // ---- helpers ----

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Test User");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, String title) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        return properties.saveAndFlush(p);
    }

    private String futureSlot() {
        return Instant.now().plus(2, ChronoUnit.DAYS).toString();
    }

    private String pastSlot() {
        return Instant.now().minus(2, ChronoUnit.DAYS).toString();
    }

    private String scheduleVisit(User visitor, Property p) throws Exception {
        MvcResult result = mvc.perform(post(Routes.Visits.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"slot\":\"" + futureSlot() + "\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        return result.getResponse().getContentAsString()
                .replaceAll("^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    // ---- §11 test 1: POST /visits → 201, row stored 'scheduled', correct shape ----

    @Test
    void scheduleVisit_creates201WithCorrectShape() throws Exception {
        User owner = user("9820200001", "owner");
        User visitor = user("9820200002", "buyer");
        Property p = listing(owner, "Schedule test");

        mvc.perform(post(Routes.Visits.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"slot\":\"" + futureSlot()
                                + "\",\"mode\":\"video\",\"note\":\"Morning preferred\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.propertyId").value(p.getId().toString()))
                .andExpect(jsonPath("$.status").value(VisitStatuses.SCHEDULED))
                .andExpect(jsonPath("$.mode").value("video"))
                .andExpect(jsonPath("$.visitor.role").value("buyer"))
                .andExpect(jsonPath("$.visitor.id").value(visitor.getId().toString()));
    }

    // ---- §11 test 2: POST /visit-requests creates identical visit (proves shared service method) ----

    @Test
    void requestVisit_createsIdenticalStoredShape() throws Exception {
        User owner = user("9820200003", "owner");
        User visitor = user("9820200004", "buyer");
        Property p = listing(owner, "RequestVisit test");
        String slot = futureSlot();

        MvcResult r1 = mvc.perform(post(Routes.Visits.REQUEST_BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"slot\":\"" + slot + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value(VisitStatuses.SCHEDULED))
                .andExpect(jsonPath("$.visitor.id").value(visitor.getId().toString()))
                .andReturn();

        // Verify the row was stored with the same shape as a POST /visits would produce.
        String visitId = r1.getResponse().getContentAsString()
                .replaceAll("^.*?\"id\":\"([^\"]+)\".*$", "$1");
        Visit stored = visitRepo.findById(UUID.fromString(visitId)).orElseThrow();
        assertThat(stored.getVisitorId()).isEqualTo(visitor.getId());
        assertThat(stored.getPropertyId()).isEqualTo(p.getId());
        assertThat(stored.getStatus()).isEqualTo(VisitStatuses.SCHEDULED);
    }

    // ---- §11 test 3: ★ Visitor attempting 'completed' → 403, status unchanged ----
    // This is the anti-fake-review guard. A visitor marking their own visit completed would
    // forge the hasCompletedVisit signal that gates the "Visited" review badge (item f).

    @Test
    void visitorCannotSetCompleted_antiFakeReviewGuard() throws Exception {
        User owner = user("9820200005", "owner");
        User visitor = user("9820200006", "buyer");
        Property p = listing(owner, "Anti-fake-review test");
        String visitId = scheduleVisit(visitor, p);

        // Owner confirms first (so completed is a valid next state for the machine).
        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"confirmed\"}"))
                .andExpect(status().isOk());

        // Visitor attempts to complete → 403.
        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"completed\"}"))
                .andExpect(status().isForbidden());

        // Status unchanged.
        assertThat(visitRepo.findById(UUID.fromString(visitId)).orElseThrow().getStatus())
                .isEqualTo(VisitStatuses.CONFIRMED);
    }

    // ---- §11 test 4: Visitor setting 'cancelled' → 200, status cancelled ----

    @Test
    void visitorCancels_succeeds() throws Exception {
        User owner = user("9820200007", "owner");
        User visitor = user("9820200008", "buyer");
        Property p = listing(owner, "Visitor cancel test");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"cancelled\"}"))
                .andExpect(status().isOk());

        assertThat(visitRepo.findById(UUID.fromString(visitId)).orElseThrow().getStatus())
                .isEqualTo(VisitStatuses.CANCELLED);
    }

    // ---- §11 test 5: Owner setting confirmed / completed / no-show → 200 each ----

    @Test
    void ownerConfirms_succeeds() throws Exception {
        User owner = user("9820200009", "owner");
        User visitor = user("9820200010", "buyer");
        Property p = listing(owner, "Owner confirm test");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"confirmed\"}"))
                .andExpect(status().isOk());

        assertThat(visitRepo.findById(UUID.fromString(visitId)).orElseThrow().getStatus())
                .isEqualTo(VisitStatuses.CONFIRMED);
    }

    @Test
    void ownerCompletes_succeeds() throws Exception {
        User owner = user("9820200011", "owner");
        User visitor = user("9820200012", "buyer");
        Property p = listing(owner, "Owner complete test");
        String visitId = scheduleVisit(visitor, p);

        // Must confirm first.
        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"confirmed\"}"))
                .andExpect(status().isOk());

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"completed\"}"))
                .andExpect(status().isOk());

        assertThat(visitRepo.findById(UUID.fromString(visitId)).orElseThrow().getStatus())
                .isEqualTo(VisitStatuses.COMPLETED);
    }

    @Test
    void ownerNoShow_succeeds() throws Exception {
        User owner = user("9820200013", "owner");
        User visitor = user("9820200014", "buyer");
        Property p = listing(owner, "Owner no-show test");
        String visitId = scheduleVisit(visitor, p);

        // Must confirm first.
        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"confirmed\"}"))
                .andExpect(status().isOk());

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"no-show\"}"))
                .andExpect(status().isOk());

        assertThat(visitRepo.findById(UUID.fromString(visitId)).orElseThrow().getStatus())
                .isEqualTo(VisitStatuses.NO_SHOW);
    }

    // ---- §11 test 6: Non-participant → 404, not 403 ----

    @Test
    void nonParticipant_returns404() throws Exception {
        User owner = user("9820200015", "owner");
        User visitor = user("9820200016", "buyer");
        User stranger = user("9820200017", "buyer");
        Property p = listing(owner, "Non-participant test");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"cancelled\"}"))
                .andExpect(status().isNotFound());
    }

    // ---- §11 test 7: GET /visits returns ONLY the caller's own booked visits ----

    @Test
    void listVisits_returnsOnlyCallerOwn() throws Exception {
        User owner = user("9820200018", "owner");
        User visitor1 = user("9820200019", "buyer");
        User visitor2 = user("9820200020", "buyer");
        Property p = listing(owner, "Visitor filter test");
        scheduleVisit(visitor1, p);
        scheduleVisit(visitor2, p);

        mvc.perform(get(Routes.Visits.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].visitor.id").value(visitor1.getId().toString()));
    }

    // ---- §11 test 8: GET /me/visit-requests returns ONLY visits on the caller's listings ----
    // This is the S3 privacy fix. Before the spec fix, GET /visits leaked every visit on the platform.

    @Test
    void myVisitRequests_returnsOnlyCallersListings_S3PrivacyFix() throws Exception {
        User owner1 = user("9820200021", "owner");
        User owner2 = user("9820200022", "owner");
        User visitor = user("9820200023", "buyer");
        Property p1 = listing(owner1, "Owner1 flat");
        Property p2 = listing(owner2, "Owner2 flat");
        scheduleVisit(visitor, p1);
        scheduleVisit(visitor, p2);

        mvc.perform(get(Routes.Visits.ME_REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].propertyId").value(p1.getId().toString()));
    }

    // ---- §11 test 9: Mobile masking — the owner earns the visitor's number by confirming ----

    /**
     * The harvest guard. A visit nobody has agreed to yet must not hand out a phone number, or
     * "book a visit" becomes a way to read any stranger's mobile off their own listing.
     *
     * <p>Paired with {@link #visitorMobile_isRevealedToOwnerOnceConfirmed()}: the two differ in
     * exactly one thing, the visit's status, on the same owner's own surface. That is what makes
     * each of them non-vacuous — the row asserted masked here is a row that would otherwise pass.
     */
    @Test
    void visitorMobile_isMaskedToOwnerWhileMerelyScheduled() throws Exception {
        User owner = user("9820200024", "owner");
        User visitor = user("9829876543", "buyer");
        Property p = listing(owner, "Mask test");
        scheduleVisit(visitor, p);

        mvc.perform(get(Routes.Visits.ME_REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].status").value(VisitStatuses.SCHEDULED))
                .andExpect(jsonPath("$.content[0].visitor.mobile").value("98XXXXX543"));
    }

    /**
     * Confirming is the act that makes a visit real — someone is coming to the owner's home at a
     * stated hour — so it is the act that earns the number to call when they are late.
     *
     * <p>Asserts the masked value BEFORE as well as the raw value after: without the before-half a
     * server that revealed the mobile to everyone from the moment of booking would satisfy this
     * test completely.
     */
    @Test
    void visitorMobile_isRevealedToOwnerOnceConfirmed() throws Exception {
        User owner = user("9820200124", "owner");
        User visitor = user("9829876544", "buyer");
        Property p = listing(owner, "Reveal test");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(get(Routes.Visits.ME_REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].visitor.mobile").value("98XXXXX544"));

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"confirmed\"}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Visits.ME_REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].status").value(VisitStatuses.CONFIRMED))
                .andExpect(jsonPath("$.content[0].visitor.mobile").value("9829876544"));
    }

    /**
     * Rescheduling resets the status to {@code scheduled} (D87), which re-masks the number. This
     * falls out of the rule rather than being special-cased, and it is the correct reading: the
     * agreement is to a slot, not to a person, so a slot nobody has agreed to yet is back behind
     * the gate.
     */
    @Test
    void reschedulingReMasksTheVisitorMobile() throws Exception {
        User owner = user("9820200125", "owner");
        User visitor = user("9829876545", "buyer");
        Property p = listing(owner, "Reschedule mask test");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"confirmed\"}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Visits.ME_REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].visitor.mobile").value("9829876545"));

        mvc.perform(patch(Routes.Visits.SLOT.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slot\":\"" + futureSlot() + "\"}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Visits.ME_REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].status").value(VisitStatuses.SCHEDULED))
                .andExpect(jsonPath("$.content[0].visitor.mobile").value("98XXXXX545"));
    }

    /**
     * Cancelling from {@code scheduled} leaves the number masked. This is the path the gate exists
     * for: a booking that was never agreed to must not leak a mobile on its way out either.
     */
    @Test
    void cancellingAScheduledVisitLeavesTheMobileMasked() throws Exception {
        User owner = user("9820200126", "owner");
        User visitor = user("9829876546", "buyer");
        Property p = listing(owner, "Cancel mask test");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"cancelled\"}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Visits.ME_REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].status").value(VisitStatuses.CANCELLED))
                .andExpect(jsonPath("$.content[0].visitor.mobile").value("98XXXXX546"));
    }

    /**
     * The other half of the rule, and the one that has always held: a party sees their own number
     * in full regardless of status. Asserted at {@code scheduled} — the status at which the owner
     * is masked — so the two halves cannot both be satisfied by a single blanket answer.
     */
    @Test
    void visitorAlwaysSeesTheirOwnMobileInFull() throws Exception {
        User owner = user("9820200127", "owner");
        User visitor = user("9829876547", "buyer");
        Property p = listing(owner, "Self reveal test");
        scheduleVisit(visitor, p);

        mvc.perform(get(Routes.Visits.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].status").value(VisitStatuses.SCHEDULED))
                .andExpect(jsonPath("$.content[0].visitor.mobile").value("9829876547"));
    }

    // ---- §11 test 10: Duplicate live visit → 409 ----

    @Test
    void duplicateLiveVisit_returns409() throws Exception {
        User owner = user("9820200025", "owner");
        User visitor = user("9820200026", "buyer");
        Property p = listing(owner, "Duplicate test");
        scheduleVisit(visitor, p);

        mvc.perform(post(Routes.Visits.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"slot\":\"" + futureSlot() + "\"}"))
                .andExpect(status().isConflict());
    }

    // ---- §11 test 11: Cancelled visit does NOT block rebooking (partial index excludes terminal) ----

    @Test
    void cancelledVisit_doesNotBlockRebooking() throws Exception {
        User owner = user("9820200027", "owner");
        User visitor = user("9820200028", "buyer");
        Property p = listing(owner, "Rebook test");
        String visitId = scheduleVisit(visitor, p);

        // Cancel.
        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"cancelled\"}"))
                .andExpect(status().isOk());

        // Rebook.
        mvc.perform(post(Routes.Visits.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"slot\":\"" + futureSlot() + "\"}"))
                .andExpect(status().isCreated());
    }

    // ---- §11 test 12: Illegal transition → 409, not 500 ----

    @Test
    void illegalTransition_confirmCancelledVisit_returns409() throws Exception {
        User owner = user("9820200029", "owner");
        User visitor = user("9820200030", "buyer");
        Property p = listing(owner, "Illegal transition test");
        String visitId = scheduleVisit(visitor, p);

        // Cancel first.
        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"cancelled\"}"))
                .andExpect(status().isOk());

        // Try to confirm a cancelled visit.
        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"confirmed\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("conflict"));
    }

    // ---- §11 test 13: Past-slot decision — past slots are accepted at create time ----
    // Rationale: an owner may legitimately record a visit that already happened (a walk-in
    // they want on record for the "Visited" badge flow). Enforcing future-only would force
    // owners to lie about the slot, which is worse.

    @Test
    void pastSlot_acceptedAtCreateTime() throws Exception {
        User owner = user("9820200031", "owner");
        User visitor = user("9820200032", "buyer");
        Property p = listing(owner, "Past slot test");

        mvc.perform(post(Routes.Visits.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"slot\":\"" + pastSlot() + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value(VisitStatuses.SCHEDULED));
    }

    // ---- §11 test 14: Route-constant ↔ SecurityConfig matcher agreement ----

    @Test
    void everyVisitRouteConstantIsServedByAController() {
        Set<String> mapped = handlerMapping.getHandlerMethods().keySet().stream()
                .filter(info -> info.getPathPatternsCondition() != null)
                .flatMap(info -> info.getPathPatternsCondition().getPatternValues().stream())
                .collect(Collectors.toSet());

        assertThat(mapped).contains(
                Routes.Visits.BASE,
                Routes.Visits.ME_REQUESTS,
                Routes.Visits.REQUEST_BASE,
                Routes.Visits.STATUS,
                Routes.Visits.SLOT);
    }

    // ---- D87: reschedule moves the slot in place and returns the visit to `scheduled` ----

    private String rescheduledSlot() {
        return Instant.now().plus(5, ChronoUnit.DAYS).toString();
    }

    @Test
    void reschedule_byVisitor_movesSlotAndResetsToScheduled() throws Exception {
        User owner = user("9820200040", "owner");
        User visitor = user("9820200041", "buyer");
        Property p = listing(owner, "Reschedule visitor test");
        String visitId = scheduleVisit(visitor, p);

        // Owner confirms so we can prove reschedule pulls a confirmed visit back to scheduled.
        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"confirmed\"}"))
                .andExpect(status().isOk());

        String newSlot = rescheduledSlot();
        mvc.perform(patch(Routes.Visits.SLOT.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slot\":\"" + newSlot + "\"}"))
                .andExpect(status().isOk());

        Visit stored = visitRepo.findById(UUID.fromString(visitId)).orElseThrow();
        assertThat(stored.getStatus()).isEqualTo(VisitStatuses.SCHEDULED);
        assertThat(stored.getSlot()).isEqualTo(Instant.parse(newSlot));
    }

    @Test
    void reschedule_byOwner_succeeds() throws Exception {
        User owner = user("9820200042", "owner");
        User visitor = user("9820200043", "buyer");
        Property p = listing(owner, "Reschedule owner test");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(patch(Routes.Visits.SLOT.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slot\":\"" + rescheduledSlot() + "\"}"))
                .andExpect(status().isOk());

        assertThat(visitRepo.findById(UUID.fromString(visitId)).orElseThrow().getStatus())
                .isEqualTo(VisitStatuses.SCHEDULED);
    }

    @Test
    void reschedule_nonParticipant_returns404() throws Exception {
        User owner = user("9820200044", "owner");
        User visitor = user("9820200045", "buyer");
        User stranger = user("9820200046", "buyer");
        Property p = listing(owner, "Reschedule stranger test");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(patch(Routes.Visits.SLOT.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slot\":\"" + rescheduledSlot() + "\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void reschedule_terminalVisit_returns409() throws Exception {
        User owner = user("9820200047", "owner");
        User visitor = user("9820200048", "buyer");
        Property p = listing(owner, "Reschedule terminal test");
        String visitId = scheduleVisit(visitor, p);

        // Cancel → terminal.
        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"cancelled\"}"))
                .andExpect(status().isOk());

        // Rescheduling a cancelled visit must not resurrect it.
        mvc.perform(patch(Routes.Visits.SLOT.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slot\":\"" + rescheduledSlot() + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("conflict"));

        assertThat(visitRepo.findById(UUID.fromString(visitId)).orElseThrow().getStatus())
                .isEqualTo(VisitStatuses.CANCELLED);
    }

    @Test
    void reschedule_malformedId_returns404() throws Exception {
        User visitor = user("9820200049", "buyer");

        mvc.perform(patch(Routes.Visits.SLOT.replace("{id}", "not-a-uuid"))
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slot\":\"" + rescheduledSlot() + "\"}"))
                .andExpect(status().isNotFound());
    }

    // ---- Notifications on visit transitions (tech-debt D92) ----
    //
    // Read through JdbcTemplate rather than a repository: the point of these tests is that a row
    // exists for the right person, and the notifications table belongs to another bounded context
    // (engagement) which deals has no business importing a repository from.

    private java.util.List<java.util.Map<String, Object>> notificationsFor(User u) {
        return jdbc.queryForList(
                "select type, title, body, link from notifications where user_id = ?", u.getId());
    }

    @Test
    void ownerConfirms_notifiesVisitorOnly() throws Exception {
        User owner = user("9820200050", "owner");
        User visitor = user("9820200051", "buyer");
        Property p = listing(owner, "Confirm notify test");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"confirmed\"}"))
                .andExpect(status().isOk());

        assertThat(notificationsFor(visitor)).singleElement().satisfies(row -> {
            assertThat(row.get("type")).isEqualTo("visit.confirmed");
            assertThat(row.get("link")).isEqualTo("/dashboard#visits");
            assertThat((String) row.get("body")).contains("Confirm notify test");
        });

        // The owner made the decision — telling them about it is noise, not news.
        assertThat(notificationsFor(owner)).isEmpty();
    }

    @Test
    void visitorCancels_notifiesNobody() throws Exception {
        User owner = user("9820200052", "owner");
        User visitor = user("9820200053", "buyer");
        Property p = listing(owner, "Cancel silence test");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"cancelled\"}"))
                .andExpect(status().isOk());

        assertThat(notificationsFor(owner)).isEmpty();
        assertThat(notificationsFor(visitor)).isEmpty();
    }

    @Test
    void rescheduleByVisitor_notifiesOwner() throws Exception {
        User owner = user("9820200054", "owner");
        User visitor = user("9820200055", "buyer");
        Property p = listing(owner, "Reschedule notify owner");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(patch(Routes.Visits.SLOT.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slot\":\"" + rescheduledSlot() + "\"}"))
                .andExpect(status().isOk());

        assertThat(notificationsFor(owner)).singleElement().satisfies(row -> {
            assertThat(row.get("type")).isEqualTo("visit.rescheduled");
            assertThat(row.get("link")).isEqualTo("/dashboard#visits");
            assertThat((String) row.get("body")).contains("The visitor");
        });
        assertThat(notificationsFor(visitor)).isEmpty();
    }

    @Test
    void rescheduleByOwner_notifiesVisitor() throws Exception {
        User owner = user("9820200056", "owner");
        User visitor = user("9820200057", "buyer");
        Property p = listing(owner, "Reschedule notify visitor");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(patch(Routes.Visits.SLOT.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slot\":\"" + rescheduledSlot() + "\"}"))
                .andExpect(status().isOk());

        // Same event, mirrored recipient. Notifying by role rather than by who called would have
        // sent this to the person who just moved the slot.
        assertThat(notificationsFor(visitor)).singleElement().satisfies(row -> {
            assertThat(row.get("type")).isEqualTo("visit.rescheduled");
            assertThat((String) row.get("body")).contains("The owner");
        });
        assertThat(notificationsFor(owner)).isEmpty();
    }
}
