package com.draazy.api.services;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.support.AbstractApiTest;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.web.Routes;
import com.draazy.api.documents.vault.DocumentRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.provider.cashfree.WebhookSignature;
import com.draazy.api.services.request.CheckoutFixture;
import com.draazy.api.services.request.DocumentReviewFixture;
import com.draazy.api.services.request.ServiceRequestDocumentReviewRepository;
import com.draazy.api.services.request.ServiceRequestRepository;
import com.draazy.api.services.request.ServiceRequestService;
import com.draazy.api.services.request.ServiceRequestStatus;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

// Kept as a base class rather than a utility because every helper needs the autowired `MockMvc` and the repositories.
abstract class ServiceFixtures extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    ServiceRequestRepository requestRepo;
    @Autowired
    ServiceRequestService serviceRequests;
    @Autowired
    WebhookSignature webhookSignature;
    @Autowired
    DocumentRepository documentRepo;
    @Autowired
    ServiceRequestDocumentReviewRepository reviewRepo;
    @PersistenceContext
    EntityManager em;

    User customer(String mobile) {
        return user(mobile, Roles.Wire.BUYER, null, "Asha Patil");
    }

    User staff(String mobile, String team) {
        User staff = user(mobile, Roles.Wire.STAFF, team, "Rohit Desk");
        jdbc.update("""
                INSERT INTO back_office_permissions (user_id, permissions)
                VALUES (?::uuid, ?::jsonb)
                ON CONFLICT (user_id) DO UPDATE SET permissions = EXCLUDED.permissions
                """, staff.getId().toString(), "[\"support\",\"desk:" + team + "\"]");
        return staff;
    }

    User admin(String mobile) {
        return user(mobile, Roles.Wire.ADMIN, null, "Admin User");
    }

    User user(String mobile, String role, String team, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setTeam(team);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        if (Roles.Wire.STAFF.equals(role)) {
            jdbc.update("""
                    INSERT INTO back_office_permissions (user_id, permissions)
                    VALUES (?::uuid, ?::jsonb)
                    ON CONFLICT (user_id) DO UPDATE SET permissions = EXCLUDED.permissions
                    """, saved.getId().toString(), "[\"support\",\"desk:" + team + "\"]");
        }
        return saved;
    }

    Property listing(User owner) {
        Property p = new Property(owner, "2BHK in Kothrud", "rent", "apartment", 25000L,
                "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        return properties.saveAndFlush(p);
    }

    String raise(User caller, String type, Property property) throws Exception {
        String body = property == null
                ? "{\"type\":\"" + type + "\"}"
                : "{\"type\":\"" + type + "\",\"propertyId\":\"" + property.getId() + "\"}";
        String json = mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = field(json, "id");

        // These fixtures exercise the maker-checker that runs after payment, so open its checkout and settle it here
        // exactly as the live webhook would.
        requestRepo.findById(UUID.fromString(id))
                .filter(r -> r.getStatus() == ServiceRequestStatus.AWAITING_PAYMENT)
                .ifPresent(r -> serviceRequests.applyWebhookOutcome(paymentRef(id), true, 0));
        return id;
    }

    String raiseUnpaid(User caller, Property property) throws Exception {
        String body = "{\"type\":\"rent-agreement\",\"propertyId\":\"" + property.getId() + "\"}";
        String json = mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = field(json, "id");
        paymentRef(id);
        return id;
    }

    /** The Cashfree order id a request is gated on, opening its checkout if nobody has yet. */
    String paymentRef(String id) {
        return CheckoutFixture.open(serviceRequests, requestRepo, UUID.fromString(id));
    }

    void deliverSigned(String orderId, boolean paid) throws Exception {
        String body = "{\"type\":\"PAYMENT_SUCCESS_WEBHOOK\",\"data\":{"
                + "\"order\":{\"order_id\":\"" + orderId + "\"},"
                + "\"payment\":{\"payment_status\":\"" + (paid ? "SUCCESS" : "FAILED") + "\","
                + "\"payment_amount\":590.00,"
                + "\"payment_time\":\"2025-03-05T11:20:00+05:30\"}}}";
        String ts = String.valueOf(System.currentTimeMillis());
        mvc.perform(post(Routes.Webhooks.CASHFREE_PAYMENT)
                        .header("x-webhook-timestamp", ts)
                        .header("x-webhook-signature", webhookSignature.sign(ts, body))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    void setStatus(User caller, String id, String status, int expected) throws Exception {
        String body = "cancelled".equals(status)
            ? "{\"status\":\"cancelled\",\"note\":\"The desk cannot continue this request\"}"
            : "{\"status\":\"" + status + "\"}";
        mvc.perform(patch(Routes.ServiceRequests.STATUS, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                .content(body))
                .andExpect(status().is(expected));
    }

    static final String[] DRAFT_CHECKS = {"identity", "title", "poa", "address", "terms"};

    void shareDraft(User staff, String id, int expected) throws Exception {
        UUID requestId = UUID.fromString(id);
        if (reviewRepo.findByServiceRequestId(requestId).isEmpty()) {
            DocumentReviewFixture.verifyAll(requestRepo, documentRepo, reviewRepo, requestId);
        }
        mvc.perform(multipart(Routes.ServiceRequests.DRAFT, id)
                        .file(new MockMultipartFile("file", "draft.pdf", "application/pdf",
                                "%PDF-1.4 draft".getBytes()))
                        .param("note", "Please review clause 7")
                        .param("checks", DRAFT_CHECKS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().is(expected));
    }

    void decide(User caller, String id, String decision, int expected) throws Exception {
        mvc.perform(post(Routes.ServiceRequests.DRAFT_DECISION, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"" + decision + "\"}"))
                .andExpect(status().is(expected));
    }

    void openDraft(User caller, String id, int expected) throws Exception {
        mvc.perform(post(Routes.ServiceRequests.DRAFT_OPENED, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().is(expected));
    }

    void reject(User caller, String id, String note, int expected) throws Exception {
        mvc.perform(post(Routes.ServiceRequests.DRAFT_DECISION, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"reject\",\"note\":\"" + note + "\"}"))
                .andExpect(status().is(expected));
    }

    void finalDoc(User staff, String id, int expected) throws Exception {
        finalDoc(staff, id, registration(), expected);
    }

    static Map<String, String> registration() {
        long n = ThreadLocalRandom.current().nextLong(1_000_000_000_000_000L);
        LocalDate today = LocalDate.now(PlatformTime.IST);
        return new LinkedHashMap<>(Map.of("documentNo", "HVL11-" + n % 1_000_000 + "-" + today.getYear(),
                "sro", "Haveli 11", "registeredOn", today.toString(),
                "grn", "MH" + String.format("%016d", n % 10_000_000_000_000_000L) + "E",
                "stampDuty", "1100", "registrationFee", "1000"));
    }

    ResultActions finalDoc(User staff, String id, Map<String, String> fields, int expected)
            throws Exception {
        var call = multipart(Routes.ServiceRequests.FINAL_DOC, id)
                .file(new MockMultipartFile("file", "registered.pdf", "application/pdf",
                        "%PDF-1.4 final".getBytes()))
                .header(HttpHeaders.AUTHORIZATION, bearer(staff));
        fields.forEach(call::param);
        return mvc.perform(call).andExpect(status().is(expected));
    }

    String detail(User caller, String id) throws Exception {
        return mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    /** Assert the request's current status without caring about the rest of the document. */
    void expectStatus(User caller, String id, String status) throws Exception {
        mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(status));
    }

    static String field(String json, String name) {
        return json.replaceAll("(?s)^.*?\"" + name + "\":\"([^\"]+)\".*$", "$1");
    }
}
