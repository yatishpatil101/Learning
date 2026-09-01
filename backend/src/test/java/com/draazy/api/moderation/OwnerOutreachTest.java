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

/**
 * {@code /properties/{id}/outreach} — chasing the owner of a listing.
 *
 * <p><strong>What shipped without a server.</strong> The console's Follow-up tab called
 * {@code sendOwnerReminder}, which incremented a number in the browser's own copy of the data and
 * produced no message at all. Its WhatsApp panel called {@code sendWhatsappTemplate}, which did open
 * a real chat — but recorded nothing, so two staff members chasing the same owner on the same
 * morning had no way to discover each other.
 *
 * <p><strong>Why every row says {@code prepared}.</strong> The send is WhatsApp click-to-chat: the
 * server renders the text, the staff member's own WhatsApp opens with it typed out, and they press
 * send. That is a real mechanism — no Business Solution Provider, no vendor, no Meta template
 * approval — but one this server cannot witness. Writing {@code sent} would be the platform
 * asserting delivery in the very table meant to be the evidence for it.
 */
@DisplayName("D216 — chasing a listing's owner")
class OwnerOutreachTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    /** Read rather than hard-coded, so the test asserts the wiring and not a second copy of it. */
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

    /**
     * The owner's name, the listing's title and the staff member's name are substituted from the
     * database rather than from anything the caller sent.
     *
     * <p>The caller supplies a template id and nothing else, on purpose. A request that carried the
     * message body would let any staff account send arbitrary text to a member of the public in the
     * platform's name, which is a different and much larger power than picking from an approved
     * library.
     */
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

    /**
     * A placeholder with no value is left standing as literal text rather than blanked.
     *
     * <p>{@code wa-pricing} asks for {@code market_rate}, which the mock answered with the string
     * "9,500" for every locality in Pune. Carrying an invented figure across would mean quoting it
     * to an owner deciding what to charge, so the key resolves to nothing — and the failure is loud,
     * in the preview the staff member reads before pressing send, instead of a silently truncated
     * sentence nobody notices.
     *
     * <p>This listing has no {@code localitySlug} at all, which is the harder of the two ways to
     * arrive here: {@code LocalityResolver} declined to bind it to any row, so there is nothing to
     * ask for a rate. The sibling below covers the softer way — a locality that exists and has
     * simply not published one.
     */
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

    /**
     * A locality that exists but has published no rate leaves the key standing too.
     *
     * <p>The distinction matters because the two cases look identical in the message and are not
     * identical in the data: an unbound listing is a curation problem, and a bound listing with no
     * rate is a coverage problem. Both correctly refuse to invent a number. 15 of the 155 seeded
     * localities carry {@code rate_per_sqft}; {@code akurdi} is one of the 140 that do not.
     */
    @Test
    @DisplayName("a locality with no published rate leaves the key standing rather than guessing")
    void unratedLocalityLeavesTheKeyStanding() throws Exception {
        User owner = user("9853000009", "owner", "Nikhil Jadhav");
        User staff = user("9853000010", "staff", "Rhea Desk");
        Property p = listing(owner, true, staff.getId().toString());
        p.setLocalitySlug("akurdi");
        properties.saveAndFlush(p);

        String body = JsonPath.read(chase(staff, p, "wa-pricing", 200), "$.body");

        assertThat(body).contains("{market_rate}");
    }

    /**
     * When the locality has published a rate, the owner is quoted that one.
     *
     * <p>The same figure {@code GET /localities/{slug}} already shows buyers. That is the whole
     * argument for wiring it: the alternative to quoting the owner the number their buyers see is
     * either inventing one (what the mock did) or keeping it from them (what the server did until
     * now), and a pricing chaser that cannot name a price is not a pricing chaser.
     *
     * <p>{@code 11200} is {@code kothrud}'s seeded {@code rate_per_sqft}. Hard-coded on purpose: if
     * the seed moves, this test should say so rather than quietly re-derive whatever it finds and
     * assert that it equals itself.
     */
    @Test
    @DisplayName("a locality with a published rate is quoted, not guessed at")
    void publishedRateIsQuoted() throws Exception {
        User owner = user("9853000011", "owner", "Anjali More");
        User staff = user("9853000012", "staff", "Kabir Desk");
        Property p = listing(owner, true, staff.getId().toString());
        p.setLocalitySlug("kothrud");
        properties.saveAndFlush(p);

        String body = JsonPath.read(chase(staff, p, "wa-pricing", 200), "$.body");

        assertThat(body).contains("11200").doesNotContain("{market_rate}");
    }

    /**
     * The link an owner is asked to tap points at <em>this</em> deployment.
     *
     * <p>Three templates wrote the URL out by hand as {@code draazy.com/property/{listing_id}}.
     * Nothing failed: the message rendered, the handoff link opened, and the sentence read
     * correctly — while every chaser sent from a staging box asked an owner to confirm availability
     * on production, against a listing id that only exists here. The owner taps it, sees a 404 or,
     * worse, somebody else's flat, and the platform has just told them their listing is gone.
     *
     * <p>Asserted against the configured base URL rather than a literal, and paired with the
     * negative: a template that reverted to the hard-coded host would still contain a plausible
     * link, so "contains a URL" is not the assertion. {@code draazy.com} deliberately does not
     * appear in the test configuration for this reason — see {@code application.properties}.
     */
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

    /**
     * The handoff link is a real {@code wa.me} URL addressed to the owner's actual number, carrying
     * the rendered message.
     *
     * <p>This is where the send happens, so a link to the wrong number is not a cosmetic bug — it is
     * a message about somebody's flat arriving on a stranger's phone.
     */
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

    /**
     * Every chaser is recorded, and the log is what the next colleague reads before picking up the
     * phone.
     *
     * <p>Asserted through the read endpoint rather than the table, because a ledger nobody can query
     * is not a ledger. The status assertion is deliberate: this platform knows a message was
     * composed and handed to a human, and must not claim more.
     */
    @Test
    @DisplayName("chasers accumulate in a log the next colleague can read, marked prepared")
    void chasersAreRecorded() throws Exception {
        User owner = user("9853000007", "owner", "Deepa Nair");
        User staff = user("9853000008", "staff", "Rohit Desk");
        Property p = listing(owner, true, staff.getId().toString());

        chase(staff, p, "wa-photos", 200);
        chase(staff, p, "wa-aadhaar", 200);

        mvc.perform(get("/properties/" + p.getId() + "/outreach")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].templateId").value("wa-aadhaar"))
                .andExpect(jsonPath("$[0].status").value("prepared"))
                .andExpect(jsonPath("$[1].templateId").value("wa-photos"));
    }

    /**
     * The count on a pipeline card comes from the messages themselves.
     *
     * <p>D215 shipped {@code reminderCount} hard-coded to zero with a contract note promising it
     * would become a count over outbound messages rather than a column — precisely so it could not
     * drift from the messages actually sent. This is that promise being kept, and the reason it is
     * asserted through the moderation queue is that the queue is the one read where the number is
     * computed for a whole page at once.
     */
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

    /**
     * A template id the library does not know is refused rather than sent as literal text.
     *
     * <p>The alternative — silently sending the id — would put "wa-onbaord" on an owner's phone.
     */
    @Test
    @DisplayName("an unknown template is refused")
    void unknownTemplatesAreRefused() throws Exception {
        User owner = user("9853000011", "owner", "Anil Gokhale");
        User staff = user("9853000012", "staff", "Meera Desk");
        Property p = listing(owner, true, staff.getId().toString());

        chase(staff, p, "wa-does-not-exist", 400);
    }

    /**
     * Buyers cannot chase owners.
     *
     * <p>The guard is {@code postOnBehalf:write} rather than {@code properties:write} because this
     * puts a message on a member of the public's personal phone in the platform's name — the same
     * power, pointed at the same people, as creating a listing under their number.
     */
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
                .andExpect(jsonPath("$[?(@.id == 'wa-aadhaar')].name").value("Aadhaar verification"))
                .andExpect(jsonPath("$[?(@.id == 'wa-aadhaar')].body").value(
                        org.hamcrest.Matchers.hasItem(org.hamcrest.Matchers.containsString("{owner_name}"))));
    }
}
