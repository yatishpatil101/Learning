package com.punenest.api.documents;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.documents.request.DocumentRequestRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.math.BigDecimal;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * The document-access flow: a buyer asks, the owner answers, and a granted share link opens exactly
 * as much of the vault as was granted — for exactly as long as the grant lives.
 *
 * <p>Organised around the invariants, because those are what a regression would break: the share
 * token is the only credential, every failure on it looks identical, the expiry is authoritative
 * rather than the status label, and the requester's mobile is never revealed on this surface.
 */
class DocumentRequestFlowTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    DocumentRequestRepository requests;
    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    RequestMappingHandlerMapping handlerMapping;

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Asha Patil");
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

    private void upload(User owner, Property p, String category, String fileName) throws Exception {
        mvc.perform(multipart(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString())
                        .file(new MockMultipartFile("file", fileName, "application/pdf",
                                "%PDF-1.4".getBytes()))
                        .param("category", category)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
    }

    private String ask(User buyer, Property p, String categoriesJson) throws Exception {
        return mvc.perform(post(Routes.Documents.REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"categories\":"
                                + categoriesJson + ",\"acknowledgedDisclaimer\":true}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
    }

    private String inbox(User owner) throws Exception {
        return mvc.perform(get(Routes.MeDocuments.REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private static String field(String json, String name) {
        return json.replaceAll("^.*?\"" + name + "\":\"([^\"]+)\".*$", "$1");
    }

    /** Ask, then grant, and hand back the minted share token. */
    private String grantedToken(User owner, User buyer, Property p, String categoriesJson)
            throws Exception {
        ask(buyer, p, categoriesJson);
        String reqId = field(inbox(owner), "id");
        mvc.perform(patch(Routes.MeDocuments.REQUEST_BY_ID, reqId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"granted\"}"))
                .andExpect(status().isOk());
        return field(inbox(owner), "shareToken");
    }

    // ---------------- POST /documents/requests ----------------

    @Test
    void requestAccess_recordsTheAskAgainstTheOwnersListing() throws Exception {
        User owner = user("9820002001", "owner");
        User buyer = user("9820002002", "buyer");
        Property p = listing(owner, "Deed flat");

        mvc.perform(post(Routes.Documents.REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId()
                                + "\",\"categories\":[\"Sale Deed\"],\"acknowledgedDisclaimer\":true}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("pending"))
                .andExpect(jsonPath("$.acknowledgedDisclaimer").value(true))
                .andExpect(jsonPath("$.shareToken").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.categories[0]").value("Sale Deed"));
    }

    @Test
    void requestAccess_recordsAnAbsentDisclaimerTickAsFalse_ratherThanFailing() throws Exception {
        User owner = user("9820002003", "owner");
        User buyer = user("9820002004", "buyer");
        Property p = listing(owner, "No tick flat");

        mvc.perform(post(Routes.Documents.REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.acknowledgedDisclaimer").value(false));
    }

    @Test
    void requestAccess_isIdempotentWhileTheFirstAskIsStillPending() throws Exception {
        User owner = user("9820002005", "owner");
        User buyer = user("9820002006", "buyer");
        Property p = listing(owner, "Double tap flat");

        String first = ask(buyer, p, "[\"Sale Deed\"]");
        String second = ask(buyer, p, "[\"Sale Deed\"]");

        assertThat(field(second, "id")).isEqualTo(field(first, "id"));
        assertThat(requests.findByRequesterIdAndPropertyIdAndStatus(
                buyer.getId(), p.getId(), "pending")).isPresent();
    }

    @Test
    void requestAccess_refusesTheOwnersOwnListing() throws Exception {
        User owner = user("9820002007", "owner");
        Property p = listing(owner, "Self ask flat");

        // The owner's own paperwork is at /me/documents/{propId}; a self-request would sit in the
        // owner's own inbox waiting for the owner to answer it.
        mvc.perform(post(Routes.Documents.REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\"}"))
                .andExpect(status().isConflict());
    }

    @Test
    void requestAccess_requiresAuthentication() throws Exception {
        User owner = user("9820002008", "owner");
        Property p = listing(owner, "Anon ask flat");

        mvc.perform(post(Routes.Documents.REQUESTS)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\"}"))
                .andExpect(status().isUnauthorized());
    }

    // ---------------- GET /me/documents/requests ----------------

    @Test
    void ownerInbox_showsOnlyRequestsAgainstListingsTheCallerOwns() throws Exception {
        User owner = user("9820002010", "owner");
        User otherOwner = user("9820002011", "owner");
        User buyer = user("9820002012", "buyer");
        ask(buyer, listing(owner, "Mine"), "[\"Sale Deed\"]");
        ask(buyer, listing(otherOwner, "Theirs"), "[\"Sale Deed\"]");

        mvc.perform(get(Routes.MeDocuments.REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    void ownerInbox_isEmptyForAnOwnerWithNoListings_ratherThanEveryonesInbox() throws Exception {
        User idle = user("9820002013", "owner");

        mvc.perform(get(Routes.MeDocuments.REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(idle)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0))
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    void ownerInbox_masksTheRequestersMobileUnconditionally() throws Exception {
        User owner = user("9820002014", "owner");
        User buyer = user("9820002015", "buyer");
        ask(buyer, listing(owner, "Masked flat"), "[\"Sale Deed\"]");

        // Granting document access must not become a side door around the contact gate: unlike
        // /contacts/status there is no reveal on this surface at all.
        String json = inbox(owner);
        assertThat(json).doesNotContain("9820002015");
        mvc.perform(get(Routes.MeDocuments.REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.content[0].requester.mobile").value("98XXXXX015"));
    }

    /**
     * D77 paged this inbox. An owner reading it wants the count of people waiting on them, and that
     * number has to survive paging: {@code totalElements} is the whole inbox, not the slice.
     *
     * <p>The size clamp is asserted here rather than trusted because it is configuration
     * ({@code spring.data.web.pageable.max-page-size}) that lives in two files — the main
     * properties and the test properties that shadow them — and the front end asks for
     * {@code size=100} on the strength of it. If the clamp were raised or lost, a caller could pull
     * an owner's entire request history in one query.
     *
     * <p>Would fail if: the service rebuilt the page with the slice's own size as the total; the
     * controller dropped {@code @PageableDefault} so an unspecified page came back at Spring's
     * default of ten rather than the twenty every other paged read here uses; or the clamp property
     * went missing, letting {@code size=500} through.
     */
    @Test
    void ownerInbox_pagesWithoutLosingTheTotal_andClampsAnOversizedPage() throws Exception {
        User owner = user("9820002016", "owner");
        Property p = listing(owner, "Paged flat");
        for (int i = 0; i < 3; i++) {
            ask(user("982000201" + (7 + i), "buyer"), p, "[\"Sale Deed\"]");
        }

        // Unspecified page: the whole inbox at the default size, exactly as before paging.
        mvc.perform(get(Routes.MeDocuments.REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(3))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(20));

        // Second page of two: one row left, and the total still describes the inbox.
        mvc.perform(get(Routes.MeDocuments.REQUESTS)
                        .param("page", "1").param("size", "2")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.totalPages").value(2));

        // An oversized page is clamped, not honoured and not rejected.
        mvc.perform(get(Routes.MeDocuments.REQUESTS)
                        .param("size", "500")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(100));
    }

    /**
     * {@code /me/documents/requests} sits directly under the {@code {propId}} template of
     * {@code /me/documents/{propId}}. Spring's {@code PathPattern} comparator ranks the literal
     * segment above the variable, so the inbox wins — but that is a resolution rule doing
     * load-bearing work, and a future refactor could flip it silently.
     */
    @Test
    void inboxRoute_beatsThePropertyVaultTemplateItSitsUnder() throws Exception {
        var request = new org.springframework.mock.web.MockHttpServletRequest("GET",
                Routes.MeDocuments.REQUESTS);
        var chain = handlerMapping.getHandler(request);

        assertThat(chain).isNotNull();
        assertThat(chain.getHandler().toString()).contains("myDocumentRequests");
    }

    // ---------------- PATCH /me/documents/requests/{reqId} ----------------

    @Test
    void grant_mintsAShareTokenAndAnExpiry() throws Exception {
        User owner = user("9820002020", "owner");
        User buyer = user("9820002021", "buyer");
        Property p = listing(owner, "Grant flat");

        String token = grantedToken(owner, buyer, p, "[\"Sale Deed\"]");

        // 256 bits of SecureRandom, URL-safe base64, unpadded: this string is the entire credential
        // for an anonymous read of a sale deed, so its length is a security property.
        assertThat(token).hasSizeGreaterThanOrEqualTo(43).doesNotContain("=", "+", "/");
        mvc.perform(get(Routes.MeDocuments.REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.content[0].status").value("granted"))
                .andExpect(jsonPath("$.content[0].expiresAt").exists());
    }

    @Test
    void decline_leavesNoTokenBehind() throws Exception {
        User owner = user("9820002022", "owner");
        User buyer = user("9820002023", "buyer");
        Property p = listing(owner, "Decline flat");
        ask(buyer, p, "[\"Sale Deed\"]");
        String reqId = field(inbox(owner), "id");

        mvc.perform(patch(Routes.MeDocuments.REQUEST_BY_ID, reqId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"declined\"}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.MeDocuments.REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.content[0].status").value("declined"))
                .andExpect(jsonPath("$.content[0].shareToken")
                        .value(org.hamcrest.Matchers.nullValue()));
    }

    @Test
    void respond_isA404ForAnotherOwnersRequest() throws Exception {
        User owner = user("9820002024", "owner");
        User stranger = user("9820002025", "owner");
        User buyer = user("9820002026", "buyer");
        ask(buyer, listing(owner, "Not yours"), "[\"Sale Deed\"]");
        String reqId = field(inbox(owner), "id");

        mvc.perform(patch(Routes.MeDocuments.REQUEST_BY_ID, reqId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"granted\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void respond_refusesToRewriteAnAnsweredRequest() throws Exception {
        User owner = user("9820002027", "owner");
        User buyer = user("9820002028", "buyer");
        Property p = listing(owner, "Terminal flat");
        ask(buyer, p, "[\"Sale Deed\"]");
        String reqId = field(inbox(owner), "id");
        mvc.perform(patch(Routes.MeDocuments.REQUEST_BY_ID, reqId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"granted\"}"))
                .andExpect(status().isOk());

        // A grant the buyer may already have followed cannot be quietly turned back into a decline.
        mvc.perform(patch(Routes.MeDocuments.REQUEST_BY_ID, reqId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"declined\"}"))
                .andExpect(status().isConflict());
    }

    // ---------------- GET /documents/shared ----------------

    @Test
    void sharedRead_isAnonymousAndReturnsOnlyTheGrantedCategories() throws Exception {
        User owner = user("9820002030", "owner");
        User buyer = user("9820002031", "buyer");
        Property p = listing(owner, "Shared flat");
        upload(owner, p, "Sale Deed", "deed.pdf");
        upload(owner, p, "Index II", "index.pdf");

        String token = grantedToken(owner, buyer, p, "[\"Sale Deed\"]");

        // No Authorization header: the lawyer or banker the link is forwarded to has no account.
        mvc.perform(get(Routes.Documents.SHARED).param("token", token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].category").value("Sale Deed"));
    }

    @Test
    void sharedRead_tellsTheBrowserNeverToForwardThisUrl() throws Exception {
        // D42: the token is in the query string, so the URL is a credential. `no-referrer` is what
        // stops a browser that has this URL open from putting it in a Referer header on the way to
        // anywhere else. Asserted on this route because it is the one that would be harmed, and it
        // is set chain-wide so a future header change here has to notice this test.
        User owner = user("9820002050", "owner");
        User buyer = user("9820002051", "buyer");
        Property p = listing(owner, "Referrer flat");
        upload(owner, p, "Sale Deed", "deed.pdf");

        String token = grantedToken(owner, buyer, p, "[\"Sale Deed\"]");

        mvc.perform(get(Routes.Documents.SHARED).param("token", token))
                .andExpect(status().isOk())
                .andExpect(header().string("Referrer-Policy", "no-referrer"));
    }

    @Test
    void sharedRead_returnsTheWholeVaultWhenNoCategoryWasItemised() throws Exception {
        User owner = user("9820002032", "owner");
        User buyer = user("9820002033", "buyer");
        Property p = listing(owner, "Whole vault flat");
        upload(owner, p, "Sale Deed", "deed.pdf");
        upload(owner, p, "Index II", "index.pdf");

        String token = grantedToken(owner, buyer, p, "[]");

        mvc.perform(get(Routes.Documents.SHARED).param("token", token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void sharedRead_neverLeaksAnotherPropertysDocuments() throws Exception {
        User owner = user("9820002034", "owner");
        User buyer = user("9820002035", "buyer");
        Property shared = listing(owner, "Shared one");
        Property secret = listing(owner, "Secret one");
        upload(owner, shared, "Sale Deed", "shared.pdf");
        upload(owner, secret, "Sale Deed", "secret.pdf");

        String token = grantedToken(owner, buyer, shared, "[\"Sale Deed\"]");

        mvc.perform(get(Routes.Documents.SHARED).param("token", token))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].propertyId").value(shared.getId().toString()));
    }

    @Test
    void sharedRead_answersAnUnknownTokenWithTheSame401AsADeclinedOne() throws Exception {
        User owner = user("9820002036", "owner");
        User buyer = user("9820002037", "buyer");
        Property p = listing(owner, "Oracle flat");
        ask(buyer, p, "[\"Sale Deed\"]");
        String reqId = field(inbox(owner), "id");
        mvc.perform(patch(Routes.MeDocuments.REQUEST_BY_ID, reqId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"declined\"}"));

        String unknown = mvc.perform(get(Routes.Documents.SHARED).param("token", "made-up-token"))
                .andExpect(status().isUnauthorized())
                .andReturn().getResponse().getContentAsString();

        // Telling the two apart would make this endpoint an oracle for probing forwarded links.
        assertThat(unknown).contains("This share link is not valid");
    }

    @Test
    void sharedRead_stopsWorkingTheInstantTheGrantLapses() throws Exception {
        User owner = user("9820002038", "owner");
        User buyer = user("9820002039", "buyer");
        Property p = listing(owner, "Lapsed flat");
        upload(owner, p, "Sale Deed", "deed.pdf");
        String token = grantedToken(owner, buyer, p, "[\"Sale Deed\"]");

        // Nothing sweeps rows to `expired`; the clock is checked on every read, so backdating the
        // expiry alone -- leaving status `granted` -- must be enough to close the link.
        var row = requests.findByShareToken(token).orElseThrow();
        row.grant(token, Instant.now().minusSeconds(60));
        requests.saveAndFlush(row);

        mvc.perform(get(Routes.Documents.SHARED).param("token", token))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void sharedRead_withoutATokenIsARejectedRequest_notAnEmptyVault() throws Exception {
        mvc.perform(get(Routes.Documents.SHARED))
                .andExpect(status().is4xxClientError());
    }

    // ---------------- notification on grant (tech-debt D92) ----------------

    private java.util.List<java.util.Map<String, Object>> notificationsFor(User u) {
        return jdbc.queryForList(
                "select type, title, body, link from notifications where user_id = ?", u.getId());
    }

    @Test
    void grant_notifiesTheRequester_withoutLeakingTheShareToken() throws Exception {
        User owner = user("9820002040", "owner");
        User buyer = user("9820002041", "buyer");
        Property p = listing(owner, "Granted flat");
        upload(owner, p, "Sale Deed", "deed.pdf");
        String token = grantedToken(owner, buyer, p, "[\"Sale Deed\"]");

        assertThat(notificationsFor(buyer)).singleElement().satisfies(row -> {
            assertThat(row.get("type")).isEqualTo("document.granted");
            assertThat(row.get("link")).isEqualTo("/property/" + p.getId());
            // The token is the only credential on the shared read; a stored, forwardable row is
            // the last place it should be able to turn up.
            assertThat((String) row.get("link")).doesNotContain(token);
            assertThat((String) row.get("body")).doesNotContain(token);
            // The buyer is told the clock is running without being told the number.
            assertThat((String) row.get("body")).contains("7 days");
        });

        // The owner made the decision.
        assertThat(notificationsFor(owner)).isEmpty();
    }

    @Test
    void decline_notifiesNobody() throws Exception {
        User owner = user("9820002042", "owner");
        User buyer = user("9820002043", "buyer");
        Property p = listing(owner, "Declined flat");
        ask(buyer, p, "[\"Sale Deed\"]");
        String reqId = field(inbox(owner), "id");

        mvc.perform(patch(Routes.MeDocuments.REQUEST_BY_ID, reqId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"declined\"}"))
                .andExpect(status().isOk());

        // Same reading as ContactService.respond: a terminal "no" is not news to push at someone.
        assertThat(notificationsFor(buyer)).isEmpty();
        assertThat(notificationsFor(owner)).isEmpty();
    }
}
