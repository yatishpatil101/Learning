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
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.provider.cashfree.WebhookSignature;
import com.draazy.api.services.request.ServiceRequest;
import com.draazy.api.services.request.ServiceRequestRepository;
import com.draazy.api.services.request.ServiceRequestService;
import com.draazy.api.services.request.ServiceRequestStatus;
import java.math.BigDecimal;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Shared fixtures for the slice-11 tests: users on each side of the workflow, a listing, and the
 * multipart/JSON helpers the three suites all need.
 *
 * <p>Kept as a base class rather than a utility because every one of these needs the autowired
 * {@link MockMvc} and the repositories, and threading five collaborators through static helpers is
 * more machinery than inheritance costs here.
 *
 * <p>Extends {@link AbstractApiTest} (D34), which now owns the Spring annotations, {@code mvc},
 * {@code jwtService} and {@code bearer()} — this class held a 27th copy of that same helper. What
 * stays here is what is genuinely slice-11's: the team-scoped {@code staff()} builder and the
 * multipart request helpers, neither of which any other suite needs.
 */
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

    User customer(String mobile) {
        return user(mobile, Roles.Wire.BUYER, null, "Asha Patil");
    }

    User staff(String mobile, String team) {
        return user(mobile, Roles.Wire.STAFF, team, "Rohit Desk");
    }

    User admin(String mobile) {
        return user(mobile, Roles.Wire.ADMIN, null, "Admin User");
    }

    User user(String mobile, String role, String team, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setTeam(team);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
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

    /** Raise a request and return its id. */
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
        // A priced desk (rent agreement) is created awaiting-payment and is invisible to ops until
        // the payment settles. These fixtures exercise the maker-checker that runs after payment, so
        // settle it here exactly as the live webhook would. A free desk (legal opinion) is already at
        // `new` and the filter skips it. The dedicated paid-gate test drives the unsettled path.
        requestRepo.findById(UUID.fromString(id))
                .filter(r -> r.getStatus() == ServiceRequestStatus.AWAITING_PAYMENT)
                .map(ServiceRequest::getPaymentRef)
                .ifPresent(ref -> serviceRequests.applyWebhookOutcome(ref, true, 0));
        return id;
    }

    /** Raise a priced request (a rent agreement) but leave it unpaid, at awaiting-payment. */
    String raiseUnpaid(User caller, Property property) throws Exception {
        String body = "{\"type\":\"rent-agreement\",\"propertyId\":\"" + property.getId() + "\"}";
        String json = mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return field(json, "id");
    }

    /** The Cashfree order id a request is gated on, for driving the payment webhook. */
    String paymentRef(String id) {
        return requestRepo.findById(UUID.fromString(id))
                .map(ServiceRequest::getPaymentRef)
                .orElseThrow();
    }

    /** Deliver the nested Cashfree payment callback Cashfree actually sends, signed with the real HMAC. */
    void deliverSigned(String orderId, boolean paid) throws Exception {
        String body = "{\"type\":\"PAYMENT_SUCCESS_WEBHOOK\",\"data\":{"
                + "\"order\":{\"order_id\":\"" + orderId + "\"},"
                + "\"payment\":{\"payment_status\":\"" + (paid ? "SUCCESS" : "FAILED") + "\","
                + "\"payment_amount\":2359.00,"
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
        mvc.perform(patch(Routes.ServiceRequests.STATUS, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"" + status + "\"}"))
                .andExpect(status().is(expected));
    }

    void shareDraft(User staff, String id, int expected) throws Exception {
        mvc.perform(multipart(Routes.ServiceRequests.DRAFT, id)
                        .file(new MockMultipartFile("file", "draft.pdf", "application/pdf",
                                "%PDF-1.4 draft".getBytes()))
                        .param("note", "Please review clause 7")
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

    void finalDoc(User staff, String id, int expected) throws Exception {
        mvc.perform(multipart(Routes.ServiceRequests.FINAL_DOC, id)
                        .file(new MockMultipartFile("file", "registered.pdf", "application/pdf",
                                "%PDF-1.4 final".getBytes()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().is(expected));
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

    /** First occurrence of a string field. Same regex trick as the slice-10 suites. */
    static String field(String json, String name) {
        return json.replaceAll("(?s)^.*?\"" + name + "\":\"([^\"]+)\".*$", "$1");
    }
}
