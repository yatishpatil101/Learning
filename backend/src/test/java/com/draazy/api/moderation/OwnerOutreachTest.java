package com.draazy.api.moderation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("D216 — chasing a listing's owner")
class OwnerOutreachTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    @Value("${draazy.app.base-url}")
    String baseUrl;

    @AfterEach
    void clearAudit() {

        // AuditService commits in its own transaction, so its rows outlive this test's rollback.
        jdbc.update("delete from audit_log where action = 'property.outreach'");
        jdbc.update("delete from outbound_message where body like '%Outreach flat%'");
    }

    private User user(String mobile, String role, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, boolean onBehalf, String staffId) {
        Property p = new Property(owner, "Outreach flat", "rent", "apartment", 27000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("790"));
        p.setStatus(PropertyStatus.APPROVED);
        if (onBehalf) {
            p.markPostedOnBehalf(staffId);
        }
        return properties.saveAndFlush(p);
    }

    private void saleFlat(User owner, String slug, long price) {
        Property sale = new Property(owner, "Outreach sale", "buy", "apartment", price, "Kothrud", "Pune");
        sale.setArea(new BigDecimal("1000"));
        sale.setPriceUnit("total");
        sale.setLocalitySlug(slug);
        sale.setStatus(PropertyStatus.APPROVED);
        properties.saveAndFlush(sale);
    }

    private String chase(User staff, Property p, String templateId, int expected) throws Exception {
        return mvc.perform(post("/properties/" + p.getId() + "/outreach")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"templateId\":\"" + templateId + "\"}"))
                .andExpect(status().is(expected))
                .andReturn()
                .getResponse()
                .getContentAsString();
    }

    // Caller supplies a template id only.
    @Test
    @DisplayName("the message is rendered server-side from the listing, its owner and the sender")
    void rendersFromTheDatabase() throws Exception {
        User owner = user("9853000001", "owner", "Ramesh Kale");
        User staff = user("9853000002", "staff", "Priya Desk");
        Property p = listing(owner, true, staff.getId().toString());

        String body = JsonPath.read(chase(staff, p, "wa-gentle", 200), "$.body");

        assertThat(body).contains("Ramesh Kale").contains("Outreach flat").contains("Kothrud");
        assertThat(body).contains("Priya Desk");
        assertThat(body).doesNotContain("{owner_name}").doesNotContain("{staff_name}");
    }

    // Unresolved keys stay literal so staff see the template failure.
    @Test
    @DisplayName("an unresolved placeholder survives as literal text, where a human will see it")
    void unresolvedPlaceholdersAreVisible() throws Exception {
        User owner = user("9853000003", "owner", "Sunita Rao");
        User staff = user("9853000004", "staff", "Ajay Desk");
        Property p = listing(owner, true, staff.getId().toString());

        String body = JsonPath.read(chase(staff, p, "wa-pricing", 200), "$.body");

        assertThat(body).contains("{market_rate}");
        assertThat(body).contains("Sunita Rao");
    }

    @Test
    @DisplayName("a locality with fewer than three live sale listings leaves the key standing rather than guessing")
    void unratedLocalityLeavesTheKeyStanding() throws Exception {
        User owner = user("9853000009", "owner", "Nikhil Jadhav");
        User staff = user("9853000010", "staff", "Rhea Desk");
        Property p = listing(owner, true, staff.getId().toString());
        p.setLocalitySlug("akurdi");
        properties.saveAndFlush(p);
        saleFlat(owner, "akurdi", 10_000_000L);
        saleFlat(owner, "akurdi", 11_000_000L);

        String body = JsonPath.read(chase(staff, p, "wa-pricing", 200), "$.body");

        assertThat(body).contains("{market_rate}");
    }

    @Test
    @DisplayName("the rate is the average asking rate per sq ft of the locality's live sale flats")
    void publishedRateIsQuoted() throws Exception {
        User owner = user("9853000011", "owner", "Anjali More");
        User staff = user("9853000012", "staff", "Kabir Desk");
        Property p = listing(owner, true, staff.getId().toString());
        p.setLocalitySlug("kothrud");
        properties.saveAndFlush(p);
        saleFlat(owner, "kothrud", 10_000_000L);
        saleFlat(owner, "kothrud", 11_000_000L);
        saleFlat(owner, "kothrud", 12_000_000L);

        String body = JsonPath.read(chase(staff, p, "wa-pricing", 200), "$.body");

        assertThat(body).contains("11000").doesNotContain("{market_rate}");
    }

    @Test
    @DisplayName("the listing link points at the deployment that sent it, not at production")
    void theListingLinkIsBuiltFromTheConfiguredBaseUrl() throws Exception {
        User owner = user("9853000011", "owner", "Nikhil Bhosale");
        User staff = user("9853000012", "staff", "Ravi Desk");
        Property p = listing(owner, true, staff.getId().toString());

        for (String template : List.of("wa-live", "wa-stale", "wa-dormant")) {
            String body = JsonPath.read(chase(staff, p, template, 200), "$.body");

            assertThat(body)
                    .describedAs("%s should link to this deployment", template)
                    .contains(baseUrl + "/property/" + p.getId());
            assertThat(body)
                    .describedAs("%s should not name the production host", template)
                    .doesNotContain("draazy.com")
                    .doesNotContain("{listing_link}");
        }
    }

    @Test
    @DisplayName("the handoff link addresses the owner's own number and carries the message")
    void handoffLinkIsAddressedToTheOwner() throws Exception {
        User owner = user("9853000005", "owner", "Kiran Shah");
        User staff = user("9853000006", "staff", "Neha Desk");
        Property p = listing(owner, true, staff.getId().toString());

        String response = chase(staff, p, "wa-onboard", 200);
        String link = JsonPath.read(response, "$.handoffLink");
        String body = JsonPath.read(response, "$.body");

        assertThat(link).startsWith("https://wa.me/919853000005?text=");
        assertThat(URLDecoder.decode(link.substring(link.indexOf("text=") + 5), StandardCharsets.UTF_8))
                .isEqualTo(body);
    }

    // Asserted through the read endpoint because a ledger nobody can query is not a ledger.
    @Test
    @DisplayName("chasers accumulate in a log the next colleague can read, marked prepared")
    void chasersAreRecorded() throws Exception {
        User owner = user("9853000007", "owner", "Deepa Nair");
        User staff = user("9853000008", "staff", "Rohit Desk");
        Property p = listing(owner, true, staff.getId().toString());

        chase(staff, p, "wa-photos", 200);
        chase(staff, p, "wa-identity", 200);

        mvc.perform(get("/properties/" + p.getId() + "/outreach")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].templateId").value("wa-identity"))
                .andExpect(jsonPath("$[0].status").value("prepared"))
                .andExpect(jsonPath("$[1].templateId").value("wa-photos"));
    }

    // Count from outbound messages, not a stored column that can drift.
    @Test
    @DisplayName("reminderCount is counted from the ledger, not stored beside the listing")
    void reminderCountComesFromTheLedger() throws Exception {
        User owner = user("9853000009", "owner", "Vikas Patil");
        User staff = user("9853000010", "staff", "Sana Desk");
        Property p = listing(owner, true, staff.getId().toString());

        mvc.perform(get("/admin/properties").param("q", "Outreach flat")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.content[0].adminPipeline.reminderCount").value(0));

        chase(staff, p, "wa-gentle", 200);
        chase(staff, p, "wa-stale", 200);
        chase(staff, p, "wa-dormant", 200);

        mvc.perform(get("/admin/properties").param("q", "Outreach flat")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.content[0].adminPipeline.reminderCount").value(3));
    }

    @Test
    @DisplayName("an unknown template is refused")
    void unknownTemplatesAreRefused() throws Exception {
        User owner = user("9853000011", "owner", "Anil Gokhale");
        User staff = user("9853000012", "staff", "Meera Desk");
        Property p = listing(owner, true, staff.getId().toString());

        chase(staff, p, "wa-does-not-exist", 400);
    }

    // This messages a private phone in the platform's name,
    // so it needs the post-on-behalf grant.
    @Test
    @DisplayName("verification reason templates render through the outreach endpoint")
    void reasonTemplatesRender() throws Exception {
        User owner = user("9853000017", "owner", "Maya Kulkarni");
        User staff = user("9853000018", "staff", "Nora Desk");
        Property p = listing(owner, true, staff.getId().toString());

        for (String template : List.of(
                "reason_photos_not_real",
                "reason_duplicate",
                "reason_broker",
                "reason_wrong_details",
                "reason_locality_unclear",
                "reason_document_unreadable",
                "reason_name_mismatch")) {
            String body = JsonPath.read(chase(staff, p, template, 200), "$.body");

            assertThat(body)
                    .describedAs(template)
                    .contains("Maya Kulkarni")
                    .contains("Outreach flat")
                    .contains("Draazy Team");
            assertThat(body)
                    .describedAs(template)
                    .doesNotContain("{owner_name}")
                    .doesNotContain("{title}");
        }
    }

    @Test
    @DisplayName("a buyer cannot send outreach")
    void buyersCannotChase() throws Exception {
        User owner = user("9853000013", "owner", "Prakash Joshi");
        User staff = user("9853000014", "staff", "Tara Desk");
        User buyer = user("9853000015", "buyer", "Curious Buyer");
        Property p = listing(owner, true, staff.getId().toString());

        chase(buyer, p, "wa-gentle", 403);
    }

    /** The template library is served rather than bundled, so the console cannot drift from it. */
    @Test
    @DisplayName("the template library lists the active WhatsApp copy")
    void templatesAreServed() throws Exception {
        User staff = user("9853000016", "staff", "Library Desk");

        mvc.perform(get("/admin/message-templates")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == 'wa-identity')].name").value("Identity verification"))
                .andExpect(jsonPath("$[?(@.id == 'wa-identity')].body").value(
                        org.hamcrest.Matchers.hasItem(org.hamcrest.Matchers.containsString("{owner_name}"))));
    }
}
