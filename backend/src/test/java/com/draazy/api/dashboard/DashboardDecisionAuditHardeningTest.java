package com.draazy.api.dashboard;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.deals.visit.VisitStatuses;
import com.draazy.api.engagement.flatmate.FlatmateRequestRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.leads.contact.ContactRequestStatuses;
import com.draazy.api.leads.photos.PhotoRequestRepository;
import com.draazy.api.leads.photos.PhotoRequestStatuses;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import com.jayway.jsonpath.JsonPath;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

class DashboardDecisionAuditHardeningTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired PhotoRequestRepository photoRequests;
    @Autowired FlatmateRequestRepository flatmateRequests;
    @Autowired EntityManager entityManager;

    private final List<String> actorIds = new ArrayList<>();

    @AfterEach
    void removeCommittedAuditRows() {
        actorIds.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
    }

    @Test
    void contactDecisionsAuditOnceAndSameDecisionRepeatsAreNoOps() throws Exception {
        User owner = user("9822400001", Roles.Wire.OWNER);
        User otherOwner = user("9822400002", Roles.Wire.OWNER);
        User buyer = user("9822400003", Roles.Wire.BUYER);
        Property p = listing(owner, "Contact audit flat");
        askContact(buyer, p);
        String reqId = contactRequestId(owner);

        mvc.perform(contactDecision(otherOwner, reqId, ContactRequestStatuses.APPROVED))
                .andExpect(status().isNotFound());
        mvc.perform(contactDecision(owner, reqId, ContactRequestStatuses.APPROVED))
                .andExpect(status().isOk());
        mvc.perform(contactDecision(owner, reqId, ContactRequestStatuses.APPROVED))
                .andExpect(status().isOk());
        mvc.perform(contactDecision(owner, reqId, ContactRequestStatuses.DECLINED))
                .andExpect(status().isConflict());

        assertThat(auditRows("contact.request.approved", reqId)).isEqualTo(1);
        assertThat(notificationRows(buyer, "contact.approved")).isEqualTo(1);
    }

    @Test
    void expiredContactRequestsAreDerivedAndCannotBeAnswered() throws Exception {
        User owner = user("9822400010", Roles.Wire.OWNER);
        User buyer = user("9822400011", Roles.Wire.BUYER);
        Property p = listing(owner, "Expired contact flat");
        askContact(buyer, p);
        String reqId = contactRequestId(owner);

        jdbc.update("update contact_requests set created_at = ? where id = ?::uuid",
                java.sql.Timestamp.from(Instant.now().minus(31, ChronoUnit.DAYS)), reqId);
        entityManager.clear();

        mvc.perform(get(Routes.MeContactRequests.BASE).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].status").value(ContactRequestStatuses.EXPIRED));
        mvc.perform(get(Routes.MeContactRequests.PENDING_COUNT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pending").value(0));
        String body = mvc.perform(contactDecision(owner, reqId, ContactRequestStatuses.APPROVED))
                .andExpect(status().isConflict())
                .andReturn().getResponse().getContentAsString();
        assertThat(body).contains("expired");
        assertThat(auditRows("contact.request.approved", reqId)).isZero();
    }

    @Test
    void documentDecisionsAuditOnceAndSameDecisionRepeatsAreNoOps() throws Exception {
        User owner = user("9822400020", Roles.Wire.OWNER);
        User otherOwner = user("9822400021", Roles.Wire.OWNER);
        User buyer = user("9822400022", Roles.Wire.BUYER);
        Property p = listing(owner, "Document audit flat");
        askDocument(buyer, p);
        String reqId = documentRequestId(owner);

        mvc.perform(documentDecision(otherOwner, reqId, "granted"))
                .andExpect(status().isNotFound());
        mvc.perform(documentDecision(owner, reqId, "granted"))
                .andExpect(status().isOk());
        mvc.perform(documentDecision(owner, reqId, "granted"))
                .andExpect(status().isOk());
        mvc.perform(documentDecision(owner, reqId, "declined"))
                .andExpect(status().isConflict());

        assertThat(auditRows("document.request.granted", reqId)).isEqualTo(1);
        assertThat(notificationRows(buyer, "document.granted")).isEqualTo(1);
    }

    @Test
    void photoDecisionsAuditOnceAndSameDecisionRepeatsAreNoOps() throws Exception {
        User owner = user("9822400030", Roles.Wire.OWNER);
        User otherOwner = user("9822400031", Roles.Wire.OWNER);
        User buyer = user("9822400032", Roles.Wire.BUYER);
        Property p = listing(owner, "Photo audit flat");
        askPhoto(buyer, p);
        String reqId = photoRequests.findByPropertyIdInOrderByCreatedAtDesc(
                List.of(p.getId()), PageRequest.of(0, 1)).getContent().getFirst().getId().toString();

        mvc.perform(photoDecision(otherOwner, reqId, PhotoRequestStatuses.RESOLVED))
                .andExpect(status().isNotFound());
        mvc.perform(photoDecision(owner, reqId, PhotoRequestStatuses.RESOLVED))
                .andExpect(status().isOk());
        mvc.perform(photoDecision(owner, reqId, PhotoRequestStatuses.RESOLVED))
                .andExpect(status().isOk());
        mvc.perform(photoDecision(owner, reqId, PhotoRequestStatuses.DECLINED))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(PhotoRequestStatuses.RESOLVED));

        assertThat(auditRows("photo.request.resolved", reqId)).isEqualTo(1);
        assertThat(notificationRows(buyer, "photo.added")).isEqualTo(1);
    }

    @Test
    void visitDecisionsAuditOnceAndSameStatusRepeatsAreNoOps() throws Exception {
        User owner = user("9822400040", Roles.Wire.OWNER);
        User visitor = user("9822400041", Roles.Wire.BUYER);
        User stranger = user("9822400042", Roles.Wire.BUYER);
        Property p = listing(owner, "Visit audit flat");
        String visitId = scheduleVisit(visitor, p);

        mvc.perform(visitDecision(stranger, visitId, VisitStatuses.CONFIRMED))
                .andExpect(status().isNotFound());
        mvc.perform(visitDecision(owner, visitId, VisitStatuses.CONFIRMED))
                .andExpect(status().isOk());
        mvc.perform(visitDecision(owner, visitId, VisitStatuses.CONFIRMED))
                .andExpect(status().isOk());
        mvc.perform(visitDecision(owner, visitId, VisitStatuses.SCHEDULED))
                .andExpect(status().isConflict());

        assertThat(auditRows("visit.status", visitId)).isEqualTo(1);
        assertThat(notificationRows(visitor, "visit.confirmed")).isEqualTo(1);
    }

    @Test
    void flatmateInterestDecisionsAuditOnceAndSameDecisionRepeatsAreNoOps() throws Exception {
        User host = user("9822400050", Roles.Wire.BUYER);
        User requester = user("9822400051", Roles.Wire.BUYER);
        User stranger = user("9822400052", Roles.Wire.BUYER);
        String postId = liveFlatmatePost(host);
        askFlatmateInterest(requester, postId);
        String requestId = flatmateRequests.findByHostIdOrderByRequestedAtDesc(
                        host.getId(), PageRequest.of(0, 1))
                .getContent().getFirst().getId().toString();

        mvc.perform(flatmateDecision(stranger, requestId, "accepted"))
                .andExpect(status().isNotFound());
        mvc.perform(flatmateDecision(host, requestId, "accepted"))
                .andExpect(status().isOk());
        mvc.perform(flatmateDecision(host, requestId, "accepted"))
                .andExpect(status().isOk());
        mvc.perform(flatmateDecision(host, requestId, "declined"))
                .andExpect(status().isConflict());

        assertThat(auditRows("flatmate.request.accepted", requestId)).isEqualTo(1);
        assertThat(notificationRows(requester, "flatmate.request.accepted")).isEqualTo(1);
    }

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Dashboard Audit");
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        actorIds.add(saved.getId().toString());
        return saved;
    }

    private Property listing(User owner, String title) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        p.setSlug("dashboard-audit-" + UUID.randomUUID());
        return properties.saveAndFlush(p);
    }

    private void askContact(User buyer, Property p) throws Exception {
        mvc.perform(post(Routes.Contacts.REQUEST)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\"}"))
                .andExpect(status().isOk());
    }

    private String contactRequestId(User owner) throws Exception {
        String body = mvc.perform(get(Routes.MeContactRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.content[0].id");
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder contactDecision(
            User owner, String reqId, String status) {
        return patch(Routes.MeContactRequests.BASE + "/" + reqId)
                .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"" + status + "\"}");
    }

    private void askDocument(User buyer, Property p) throws Exception {
        mvc.perform(post(Routes.Documents.REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId()
                                + "\",\"categories\":[\"Sale Deed\"],"
                                + "\"acknowledgedDisclaimer\":true}"))
                .andExpect(status().isCreated());
    }

    private String documentRequestId(User owner) throws Exception {
        String body = mvc.perform(get(Routes.MeDocuments.REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.content[0].id");
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder documentDecision(
            User owner, String reqId, String status) {
        return patch(Routes.MeDocuments.REQUEST_BY_ID, reqId)
                .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"" + status + "\"}");
    }

    private void askPhoto(User buyer, Property p) throws Exception {
        mvc.perform(post(Routes.PropertyPhotoRequests.BASE.replace("{id}", p.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk());
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder photoDecision(
            User owner, String reqId, String decision) {
        return patch(Routes.MePhotoRequests.BY_ID.replace("{reqId}", reqId))
                .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"" + decision + "\"}");
    }

    private String scheduleVisit(User visitor, Property p) throws Exception {
        String body = mvc.perform(post(Routes.Visits.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(visitor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"slot\":\""
                                + Instant.now().plus(2, ChronoUnit.DAYS) + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.id");
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder visitDecision(
            User caller, String visitId, String status) {
        return patch(Routes.Visits.STATUS.replace("{id}", visitId))
                .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"" + status + "\"}");
    }

    private String liveFlatmatePost(User host) throws Exception {
        String body = mvc.perform(post(Routes.Flatmates.POSTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Host","gender":"any","budget":18000,
                                 "localities":["Baner"],"note":"Quiet home."}
                                """))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String postId = JsonPath.read(body, "$.id");
        jdbc.update("update flatmate_seeker_posts set mod_status = 'approved' where id = ?::uuid",
                postId);
        return postId;
    }

    private void askFlatmateInterest(User requester, String postId) throws Exception {
        mvc.perform(post(Routes.Flatmates.POST_INTEREST, postId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(requester))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"share\":\"solo\",\"message\":\"Interested.\"}"))
                .andExpect(status().isCreated());
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder flatmateDecision(
            User host, String requestId, String decision) {
        return patch(Routes.Flatmates.MY_REQUEST_BY_ID, UUID.fromString(requestId))
                .header(HttpHeaders.AUTHORIZATION, bearer(host))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"" + decision + "\"}");
    }

    private int auditRows(String action, String entityId) {
        return jdbc.queryForObject(
                "select count(*) from audit_log where action = ? and entity_id = ?",
                Integer.class, action, entityId);
    }

    private int notificationRows(User user, String type) {
        return jdbc.queryForObject(
                "select count(*) from notifications where user_id = ? and type = ?",
                Integer.class, user.getId(), type);
    }
}
