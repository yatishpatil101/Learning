package com.punenest.api.leads.contact;

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
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * Contract + behaviour proof for the contacts + contact-gate slice, driven through the real filter
 * chain against the live Flyway'd Postgres.
 *
 * <p>Organised around the invariants rather than the endpoints, because the invariants are what a
 * regression would break: badge-not-gate (ADR-019), reveal-only-on-owner-or-approved, strict
 * owner-scoping, and request idempotency.
 */
class ContactGateEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    ContactRequestRepository contactRequests;
    @Autowired
    @org.springframework.beans.factory.annotation.Qualifier("requestMappingHandlerMapping")
    RequestMappingHandlerMapping handlerMapping;

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private User verifiedOnlyOwner(String mobile) {
        User u = user(mobile, "owner");
        u.setVerifiedContactOnly(true);
        return users.saveAndFlush(u);
    }

    private User badgedBuyer(String mobile) {
        User u = user(mobile, "buyer");
        u.setAadhaarVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, String title) {
        Property p = new Property(owner, title, "rent", "apartment",
                25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        return properties.saveAndFlush(p);
    }

    private void ask(User buyer, Property p) throws Exception {
        mvc.perform(post(Routes.Contacts.REQUEST).header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"propertyId\":\"" + p.getId() + "\"}"));
    }

    /** The id of the single request in an owner's inbox — the {@code reqId} path token. */
    private String requestId(User owner) throws Exception {
        String json = mvc.perform(get(Routes.MeContactRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andReturn().getResponse().getContentAsString();
        return json.replaceAll("^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    // ---------------- GET /contacts/status ----------------

    @Test
    void myContactRequests_isEmptyForAnOwnerWithNoListings_ratherThanEveryonesInbox() throws Exception {
        User busyOwner = user("9820000090", "owner");
        User idleOwner = user("9820000091", "owner");
        ask(user("9820000092", "buyer"), listing(busyOwner, "Busy owner flat"));

        mvc.perform(get(Routes.MeContactRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(idleOwner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0));
    }

    @Test
    void requestContact_rejectsAnOversizedMessage() throws Exception {
        User owner = user("9820000093", "owner");
        User buyer = user("9820000094", "buyer");
        Property p = listing(owner, "Size-capped flat");

        mvc.perform(post(Routes.Contacts.REQUEST)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"message\":\""
                                + "A".repeat(1001) + "\"}"))
                .andExpect(status().isUnprocessableEntity());
        assertThat(contactRequests.findByRequesterIdAndPropertyId(buyer.getId(), p.getId()))
                .isEmpty();
    }

    @Test
    void contactStatus_isOwnerForOwnListing_andNoneForAStranger() throws Exception {
        User owner = user("9820000001", "owner");
        User buyer = user("9820000002", "buyer");
        Property p = listing(owner, "Owner view");

        mvc.perform(get(Routes.Contacts.STATUS).param("propertyId", p.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(ContactStatuses.OWNER))
                .andExpect(jsonPath("$.verificationRequired").value(false));

        mvc.perform(get(Routes.Contacts.STATUS).param("propertyId", p.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(ContactStatuses.NONE));
    }

    @Test
    void contactStatus_reflectsPendingThenApproved() throws Exception {
        User owner = user("9820000003", "owner");
        User buyer = user("9820000004", "buyer");
        Property p = listing(owner, "Status walk");
        ask(buyer, p);

        mvc.perform(get(Routes.Contacts.STATUS).param("propertyId", p.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(jsonPath("$.status").value(ContactStatuses.PENDING));

        mvc.perform(patch(Routes.MeContactRequests.BASE + "/" + requestId(owner))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Contacts.STATUS).param("propertyId", p.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(jsonPath("$.status").value(ContactStatuses.APPROVED));
    }

    /**
     * Approving a request notifies the buyer — the positive outcome they were waiting on, and until
     * tech-debt D92 one nothing announced. The notification points at the listing where the number
     * is now visible, and nobody is told about their own decision.
     */
    @Test
    void approvingAContactRequest_notifiesTheBuyer_andNotTheOwner() throws Exception {
        User owner = user("9820000200", "owner");
        User buyer = user("9820000201", "buyer");
        Property p = listing(owner, "Notify on approve");
        ask(buyer, p);

        mvc.perform(patch(Routes.MeContactRequests.BASE + "/" + requestId(owner))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isOk());

        List<Map<String, Object>> notes = notificationsFor(buyer);
        assertThat(notes).hasSize(1);
        assertThat(notes.getFirst().get("type")).isEqualTo("contact.approved");
        assertThat(notes.getFirst().get("link")).isEqualTo("/property/" + p.getId());
        assertThat(notificationsFor(owner)).isEmpty();
    }

    /**
     * A decline is a terminal "no", not news to push at the buyer — so it stays silent by design.
     * Recorded as a test so the silence is a decision the suite defends, not an omission.
     */
    @Test
    void decliningAContactRequest_notifiesNobody() throws Exception {
        User owner = user("9820000202", "owner");
        User buyer = user("9820000203", "buyer");
        Property p = listing(owner, "Silent decline");
        ask(buyer, p);

        mvc.perform(patch(Routes.MeContactRequests.BASE + "/" + requestId(owner))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"declined\"}"))
                .andExpect(status().isOk());

        assertThat(notificationsFor(buyer)).isEmpty();
    }

    /** Read straight from the table: the notification is a side effect, not part of any response. */
    private List<Map<String, Object>> notificationsFor(User user) {
        return jdbc.queryForList(
                "select type, title, body, link from notifications where user_id = ?", user.getId());
    }

    /** Mock-shape parity: exactly the four keys {@code frontend/src/lib/contact.js} reads. */
    @Test
    void contactStatus_shapeMatchesTheFrontendMock() throws Exception {
        User owner = user("9820000005", "owner");
        Property p = listing(owner, "Shape");

        mvc.perform(get(Routes.Contacts.STATUS).param("propertyId", p.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.length()").value(4))
                .andExpect(jsonPath("$.status").exists())
                .andExpect(jsonPath("$.verifiedContactOnly").exists())
                .andExpect(jsonPath("$.verificationRequired").exists())
                .andExpect(jsonPath("$.ownerHidesNumber").exists());
    }

    // ---------------- POST /contacts/request ----------------

    @Test
    void requestContact_createsOnePendingRow_andIsIdempotent() throws Exception {
        User owner = user("9820000006", "owner");
        User buyer = user("9820000007", "buyer");
        Property p = listing(owner, "Idempotent");
        String body = "{\"propertyId\":\"" + p.getId() + "\",\"message\":\"Interested\"}";

        mvc.perform(post(Routes.Contacts.REQUEST).header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(ContactStatuses.PENDING));
        mvc.perform(post(Routes.Contacts.REQUEST).header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(ContactStatuses.PENDING));

        assertThat(contactRequests.findByPropertyIdInOrderByCreatedAtDesc(List.of(p.getId()),
                Pageable.unpaged())).hasSize(1);
    }

    @Test
    void requestContact_onOwnListing_returnsOwner_andWritesNoRow() throws Exception {
        User owner = user("9820000008", "owner");
        Property p = listing(owner, "Self request");

        mvc.perform(post(Routes.Contacts.REQUEST).header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(ContactStatuses.OWNER));

        assertThat(contactRequests.findByPropertyIdInOrderByCreatedAtDesc(List.of(p.getId()),
                Pageable.unpaged())).isEmpty();
    }

    /**
     * The badge-not-gate proof (ADR-019). An unverified caller must succeed against an ordinary owner;
     * the badge bites only when the owner has explicitly opted in. If this test ever needs a badge to
     * pass, the trust model has silently become a wall.
     */
    @Test
    void requestContact_succeedsForUnverifiedCaller_whenOwnerHasNotOptedIn() throws Exception {
        User owner = user("9820000009", "owner");
        User unverified = user("9820000010", "buyer");
        Property p = listing(owner, "Badge not gate");

        assertThat(unverified.isAadhaarVerified()).isFalse();
        mvc.perform(post(Routes.Contacts.REQUEST)
                        .header(HttpHeaders.AUTHORIZATION, bearer(unverified))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(ContactStatuses.PENDING))
                .andExpect(jsonPath("$.verificationRequired").value(false));
    }

    @Test
    void requestContact_403VerificationRequired_onlyWhenOwnerOptedInAndCallerHasNoBadge()
            throws Exception {
        User owner = verifiedOnlyOwner("9820000011");
        User unverified = user("9820000012", "buyer");
        User badged = badgedBuyer("9820000013");
        Property p = listing(owner, "Verified only");
        String body = "{\"propertyId\":\"" + p.getId() + "\"}";

        mvc.perform(post(Routes.Contacts.REQUEST)
                        .header(HttpHeaders.AUTHORIZATION, bearer(unverified))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("verification_required"));

        // Same owner, same listing: a badged caller sails through, proving the 403 is the owner's
        // opt-in and not a blanket verification requirement.
        mvc.perform(post(Routes.Contacts.REQUEST).header(HttpHeaders.AUTHORIZATION, bearer(badged))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(ContactStatuses.PENDING))
                .andExpect(jsonPath("$.verifiedContactOnly").value(true))
                .andExpect(jsonPath("$.verificationRequired").value(false));
    }

    @Test
    void contactRoutesRequireAuthentication() throws Exception {
        mvc.perform(get(Routes.Contacts.STATUS).param("propertyId", "x"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post(Routes.Contacts.REQUEST).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"x\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get(Routes.MeContactRequests.BASE)).andExpect(status().isUnauthorized());
    }

    // ---------------- /me/contact-requests ----------------

    @Test
    void myContactRequests_areOwnerScoped_maskTheRequester_andHideContactUntilApproved()
            throws Exception {
        User owner = user("9820000014", "owner");
        User otherOwner = user("9820000015", "owner");
        User buyer = user("9820000016", "buyer");
        Property mine = listing(owner, "Mine");
        Property theirs = listing(otherOwner, "Theirs");
        ask(buyer, mine);
        ask(buyer, theirs);

        mvc.perform(get(Routes.MeContactRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].propertyId").value(mine.getId().toString()))
                .andExpect(jsonPath("$.content[0].status").value(ContactRequestStatuses.PENDING))
                .andExpect(jsonPath("$.content[0].requester.mobile").value("98XXXXX016"))
                .andExpect(jsonPath("$.content[0].requester.role").value("buyer"))
                .andExpect(jsonPath("$.content[0].contact").doesNotExist());
    }

    @Test
    void respondContactRequest_404ForAForeignRequest() throws Exception {
        User owner = user("9820000017", "owner");
        User intruder = user("9820000018", "owner");
        User buyer = user("9820000019", "buyer");
        Property p = listing(owner, "Foreign");
        ask(buyer, p);
        String reqId = requestId(owner);

        mvc.perform(patch(Routes.MeContactRequests.BASE + "/" + reqId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(intruder))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void respondContactRequest_rejectsASecondDecision() throws Exception {
        User owner = user("9820000020", "owner");
        User buyer = user("9820000021", "buyer");
        Property p = listing(owner, "Terminal");
        ask(buyer, p);
        String reqId = requestId(owner);

        mvc.perform(patch(Routes.MeContactRequests.BASE + "/" + reqId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"declined\"}"))
                .andExpect(status().isOk());
        mvc.perform(patch(Routes.MeContactRequests.BASE + "/" + reqId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isConflict());
    }

    @Test
    void respondContactRequest_rejectsAStatusOutsideTheVocabulary() throws Exception {
        User owner = user("9820000022", "owner");
        mvc.perform(patch(Routes.MeContactRequests.BASE + "/" + UUID.randomUUID())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"pending\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    // ---------------- the payoff: masked, and stays masked (D5 global policy) ----------------

    @Test
    void ownerMobileStaysMaskedEvenAfterApproval_onPropertyDetail() throws Exception {
        User owner = user("9829876543", "owner");
        User buyer = user("9820000023", "buyer");
        Property p = listing(owner, "Reveal");
        String detail = "/properties/" + p.getId();

        // Anonymous, and signed-in-but-unrequested: masked.
        mvc.perform(get(detail)).andExpect(jsonPath("$.owner.mobile").value("98XXXXX543"));
        mvc.perform(get(detail).header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(jsonPath("$.owner.mobile").value("98XXXXX543"));

        // Pending is not approval.
        ask(buyer, p);
        mvc.perform(get(detail).header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(jsonPath("$.owner.mobile").value("98XXXXX543"));

        // The owner always sees their own number.
        mvc.perform(get(detail).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.owner.mobile").value("9829876543"));

        mvc.perform(patch(Routes.MeContactRequests.BASE + "/" + requestId(owner))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isOk());

        // D5 (global policy): approval unlocks the in-app conversation, not the digits — the owner's
        // number stays masked to the approved buyer and to everyone else.
        mvc.perform(get(detail).header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(jsonPath("$.owner.mobile").value("98XXXXX543"));
        mvc.perform(get(detail)).andExpect(jsonPath("$.owner.mobile").value("98XXXXX543"));

        // ...and symmetrically the buyer's number stays masked to the owner: the inbox never emits a
        // raw contact number, so the revealed `contact` object is absent and only the masked
        // `requester` remains.
        mvc.perform(get(Routes.MeContactRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.content[0].contact").doesNotExist())
                .andExpect(jsonPath("$.content[0].requester.mobile").value("98XXXXX023"));
    }

    @Test
    void declineKeepsTheOwnerMobileMasked() throws Exception {
        User owner = user("9829876544", "owner");
        User buyer = user("9820000024", "buyer");
        Property p = listing(owner, "Declined");
        ask(buyer, p);
        mvc.perform(patch(Routes.MeContactRequests.BASE + "/" + requestId(owner))
                .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"declined\"}"));

        mvc.perform(get("/properties/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(jsonPath("$.owner.mobile").value("98XXXXX544"));
    }

    // ---------------- api-standards.md §2.1 route-constant agreement ----------------

    /**
     * Guards the invariant {@code Routes} exists for: the constants the security chain binds must be
     * the constants the controllers actually serve. A typo in either file compiles, passes every happy
     * path, and quietly leaves a route unguarded — this is the only thing that catches it.
     */
    @Test
    void everySliceRouteConstantIsServedByAController() {
        Set<String> mapped = handlerMapping.getHandlerMethods().keySet().stream()
                .filter(info -> info.getPathPatternsCondition() != null)
                .flatMap(info -> info.getPathPatternsCondition().getPatternValues().stream())
                .collect(Collectors.toSet());

        assertThat(mapped).contains(
                Routes.Contacts.STATUS,
                Routes.Contacts.REQUEST,
                Routes.MeContactRequests.BASE,
                Routes.MeContactRequests.BY_ID,
                Routes.Verification.AADHAAR,
                Routes.Webhooks.CASHFREE_DIGILOCKER);
    }
}
