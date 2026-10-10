package com.draazy.api.deals.visit;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.JwtService;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

// Contract + behaviour proof for the visits sub-slice (A4), driven through the real filter chain against the live
// Flyway'd Postgres under {@code ddl-auto=validate}.
class VisitEndpointsTest extends AbstractApiTest {

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired VisitRepository visitRepo;

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

    // The anti-fake-review guard: a visitor can never mark their own visit completed.
    @Test
    void visitorCannotSetCompleted_antiFakeReviewGuard() throws Exception {
        User owner = user("9820200005", "owner");
        User visitor = user("9820200006", "buyer");
        Property p = listing(owner, "Anti-fake-review test");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"confirmed\"}"))
                .andExpect(status().isOk());

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"completed\"}"))
                .andExpect(status().isForbidden());

        assertThat(visitRepo.findById(UUID.fromString(visitId)).orElseThrow().getStatus())
                .isEqualTo(VisitStatuses.CONFIRMED);
    }

    @ParameterizedTest(name = "{0} {1}")
    @CsvSource(delimiter = ';', value = {
        "visitor;cancelled",
        "owner;confirmed",
        "owner;confirmed,completed",
        "owner;confirmed,no-show"})
    void statusTransition_succeeds(String actor, String steps) throws Exception {
        User owner = user("9820200007", "owner");
        User visitor = user("9820200008", "buyer");
        Property p = listing(owner, "Transition test " + steps);
        String visitId = scheduleVisit(visitor, p);
        User caller = "owner".equals(actor) ? owner : visitor;

        String last = null;
        for (String step : steps.split(",")) {
            mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"status\":\"" + step + "\"}"))
                    .andExpect(status().isOk());
            last = step;
        }

        assertThat(visitRepo.findById(UUID.fromString(visitId)).orElseThrow().getStatus()).isEqualTo(last);
    }

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

    @Test
    void listVisits_propertyIdNarrowsToThatListing() throws Exception {
        User owner = user("9820200098", "owner");
        User visitor = user("9820200099", "buyer");
        Property p1 = listing(owner, "Narrow one");
        Property p2 = listing(owner, "Narrow two");
        scheduleVisit(visitor, p1);
        scheduleVisit(visitor, p2);

        mvc.perform(get(Routes.Visits.BASE).param("propertyId", p2.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].propertyId").value(p2.getId().toString()));
    }

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

    // The harvest guard. A visit nobody has agreed to yet must not hand out a phone number, or "book a visit" becomes
    // a way to read any stranger's mobile off their own listing.
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

    // Asserts the masked value BEFORE as well as the raw value after: without the before-half a server that revealed
    // the mobile to everyone from the moment of booking would satisfy this test completely.
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

    // Cancelling from {@code scheduled} leaves the number masked: a booking that was never agreed to must not leak a
    // mobile on its way out either.
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

    // Asserted at `scheduled` — the status at which the owner is masked — so the two halves cannot both be satisfied
    // by a single blanket answer.
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

    @Test
    void cancelledVisit_doesNotBlockRebooking() throws Exception {
        User owner = user("9820200027", "owner");
        User visitor = user("9820200028", "buyer");
        Property p = listing(owner, "Rebook test");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"cancelled\"}"))
                .andExpect(status().isOk());

        mvc.perform(post(Routes.Visits.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"slot\":\"" + futureSlot() + "\"}"))
                .andExpect(status().isCreated());
    }

    @Test
    void illegalTransition_confirmCancelledVisit_returns409() throws Exception {
        User owner = user("9820200029", "owner");
        User visitor = user("9820200030", "buyer");
        Property p = listing(owner, "Illegal transition test");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"cancelled\"}"))
                .andExpect(status().isOk());

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"confirmed\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("conflict"));
    }

    // Enforcing future-only would force owners to lie about the slot, which is worse.
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

    private String rescheduledSlot() {
        return Instant.now().plus(5, ChronoUnit.DAYS).toString();
    }

    @Test
    void reschedule_byVisitor_movesSlotAndResetsToScheduled() throws Exception {
        User owner = user("9820200040", "owner");
        User visitor = user("9820200041", "buyer");
        Property p = listing(owner, "Reschedule visitor test");
        String visitId = scheduleVisit(visitor, p);

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

    // Rescheduling a cancelled visit must not resurrect it.
    @Test
    void reschedule_terminalVisit_returns409() throws Exception {
        User owner = user("9820200047", "owner");
        User visitor = user("9820200048", "buyer");
        Property p = listing(owner, "Reschedule terminal test");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"cancelled\"}"))
                .andExpect(status().isOk());

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

    private java.util.List<java.util.Map<String, Object>> notificationsFor(User u) {
        return jdbc.queryForList(
                "select type, title, body, link from notifications where user_id = ?", u.getId());
    }

    private java.util.List<java.util.Map<String, Object>> notificationsFor(User u, String type) {
        return jdbc.queryForList(
                "select type, title, body, link from notifications where user_id = ? and type = ?",
                u.getId(), type);
    }

    @Test
    void schedule_notifiesOwnerNotVisitor() throws Exception {
        User owner = user("9820200058", "owner");
        User visitor = user("9820200059", "buyer");
        Property p = listing(owner, "Request notify test");
        scheduleVisit(visitor, p);

        assertThat(notificationsFor(owner)).singleElement().satisfies(row -> {
            assertThat(row.get("type")).isEqualTo("visit.requested");
            assertThat(row.get("link")).isEqualTo("/dashboard#visits");
            assertThat((String) row.get("body")).contains("Request notify test")
                    .doesNotContain(visitor.getMobile());
        });
        assertThat(notificationsFor(visitor)).isEmpty();
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

        assertThat(notificationsFor(owner, "visit.confirmed")).isEmpty();
    }

    @Test
    void visitorCancels_notifiesOwner() throws Exception {
        User owner = user("9820200052", "owner");
        User visitor = user("9820200053", "buyer");
        Property p = listing(owner, "Cancel notify test");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"cancelled\"}"))
                .andExpect(status().isOk());

        assertThat(notificationsFor(owner, "visit.cancelled")).singleElement().satisfies(row ->
                assertThat((String) row.get("body")).contains("The visitor", "Cancel notify test"));
        assertThat(notificationsFor(visitor)).isEmpty();
    }

    @Test
    void ownerCancels_notifiesVisitor() throws Exception {
        User owner = user("9820200060", "owner");
        User visitor = user("9820200061", "buyer");
        Property p = listing(owner, "Owner cancel test");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(patch(Routes.Visits.STATUS.replace("{id}", visitId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"cancelled\"}"))
                .andExpect(status().isOk());

        assertThat(notificationsFor(visitor)).singleElement().satisfies(row -> {
            assertThat(row.get("type")).isEqualTo("visit.cancelled");
            assertThat((String) row.get("body")).contains("The owner");
        });
        assertThat(notificationsFor(owner, "visit.cancelled")).isEmpty();
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

        assertThat(notificationsFor(owner, "visit.rescheduled")).singleElement().satisfies(row -> {
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

        assertThat(notificationsFor(visitor)).singleElement().satisfies(row -> {
            assertThat(row.get("type")).isEqualTo("visit.rescheduled");
            assertThat((String) row.get("body")).contains("The owner");
        });
        assertThat(notificationsFor(owner, "visit.rescheduled")).isEmpty();
    }
}
