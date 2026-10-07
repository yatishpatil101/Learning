package com.draazy.api.moderation.enquiry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.deals.deal.Deal;
import com.draazy.api.deals.deal.DealRepository;
import com.draazy.api.deals.deal.DealStatuses;
import com.draazy.api.deals.visit.Visit;
import com.draazy.api.deals.visit.VisitModes;
import com.draazy.api.deals.visit.VisitRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.leads.contact.ContactRequest;
import com.draazy.api.leads.contact.ContactRequestRepository;
import com.draazy.api.leads.contact.ContactRequestStatuses;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/** Mobiles arrive in full on the lists; opening one row is audited with the masked number. Rows are seeded via repositories to skip the contact gate. */
@DisplayName("D25 — the demand board")
class EnquiryBoardEndpointsTest extends AbstractApiTest {

    private static final String RAW = "9855100011";

    /** What the audit row stores in place of {@link #RAW}. */
    private static final String MASKED = "98XXXXX011";

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    ContactRequestRepository contactRequests;
    @Autowired
    VisitRepository visits;
    @Autowired
    DealRepository deals;

    @Nested
    @DisplayName("enquiries — contact requests")
    class Enquiries {

        @Test
        @DisplayName("an admin sees the row with the requester's full number")
        void adminReadsFullMobile() throws Exception {
            User owner = user("9855100001", Roles.Wire.OWNER, "Owner One");
            User buyer = user(RAW, Roles.Wire.BUYER, "Curious Buyer");
            Property p = listing(owner, "Enquiry board fixture");
            enquiry(p, buyer, ContactRequestStatuses.PENDING);

            mvc.perform(get(Routes.Moderation.ADMIN_ENQUIRIES)
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin("9855100002")))
                            .param("status", ContactRequestStatuses.PENDING))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].requesterName").value("Curious Buyer"))
                    .andExpect(jsonPath("$.content[0].requesterMobile").value(RAW))
                    .andExpect(jsonPath("$.content[0].propertyTitle")
                            .value("Enquiry board fixture"));
        }

        @Test
        @DisplayName("the status filter narrows — a declined row is absent from the pending page")
        void statusFilterNarrows() throws Exception {
            User owner = user("9855100005", Roles.Wire.OWNER, "Owner Three");
            User buyer = user(RAW, Roles.Wire.BUYER, "Declined Buyer");
            enquiry(listing(owner, "Declined fixture"), buyer, ContactRequestStatuses.DECLINED);

            mvc.perform(get(Routes.Moderation.ADMIN_ENQUIRIES)
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin("9855100006")))
                            .param("status", ContactRequestStatuses.DECLINED))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].status")
                            .value(ContactRequestStatuses.DECLINED));
        }
    }

    @Nested
    @DisplayName("visits")
    class Visits {

        @Test
        @DisplayName("the visitor's full number, and the slot survives the projection")
        void visitorMobileInFull() throws Exception {
            User owner = user("9855100007", Roles.Wire.OWNER, "Owner Four");
            User visitor = user(RAW, Roles.Wire.BUYER, "Site Visitor");
            Property p = listing(owner, "Visit board fixture");
            visits.saveAndFlush(new Visit(p.getId(), visitor.getId(),
                    Instant.now().plus(2, ChronoUnit.DAYS), VisitModes.IN_PERSON, null));

            mvc.perform(get(Routes.Moderation.ADMIN_VISITS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin("9855100008"))))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].visitorName").value("Site Visitor"))
                    .andExpect(jsonPath("$.content[0].visitorMobile").value(RAW))
                    .andExpect(jsonPath("$.content[0].mode").value(VisitModes.IN_PERSON))
                    .andExpect(jsonPath("$.content[0].slot").exists());
        }
    }

    @Nested
    @DisplayName("deals — two sources for one number")
    class Deals {

        @Test
        @DisplayName("a registered counterparty's own mobile")
        void registeredCounterparty() throws Exception {
            User owner = user("9855100009", Roles.Wire.OWNER, "Owner Five");
            User counterparty = user(RAW, Roles.Wire.BUYER, "Registered Party");
            Property p = listing(owner, "Deal board fixture");
            Deal d = new Deal(p.getId(), "rent");
            d.setCounterpartyId(counterparty.getId());
            d.setAgreedPrice(24000L);
            d.setStatus(DealStatuses.ACTIVE);
            deals.saveAndFlush(d);

            mvc.perform(get(Routes.Moderation.ADMIN_DEALS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin("9855100010"))))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].counterpartyName").value("Registered Party"))
                    .andExpect(jsonPath("$.content[0].counterpartyMobile").value(RAW))
                    .andExpect(jsonPath("$.content[0].agreedPrice").value(24000));
        }

        @Test
        @DisplayName("an off-platform close: the typed number, with no account behind it")
        void typedCounterpartyMobile() throws Exception {
            User owner = user("9855100012", Roles.Wire.OWNER, "Owner Six");
            Property p = listing(owner, "Off-platform close fixture");
            Deal d = new Deal(p.getId(), "buy");
            d.setCounterpartyMobile(RAW);
            d.setStatus(DealStatuses.CLOSED);
            d.setClosedAt(Instant.now());
            deals.saveAndFlush(d);

            mvc.perform(get(Routes.Moderation.ADMIN_DEALS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin("9855100013")))
                            .param("status", DealStatuses.CLOSED))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].counterpartyName").doesNotExist())
                    .andExpect(jsonPath("$.content[0].counterpartyMobile").value(RAW));
        }
    }

    // --- who may open the board ---------------------------------------------------------------

    @Nested
    @DisplayName("who may open the board")
    class Authorisation {

        /** {@code enquiries:read} is an ops atom held by staff from the baseline with no permissions document; asserted so the route cannot silently become admin-only. */
        @Test
        @DisplayName("a staffer reads it too — this is a floor tool, not an admin-only one")
        void staffMayRead() throws Exception {
            mvc.perform(get(Routes.Moderation.ADMIN_ENQUIRIES)
                            .header(HttpHeaders.AUTHORIZATION,
                                    bearer(user("9855100014", Roles.Wire.STAFF, "Desk"))))
                    .andExpect(status().isOk());
        }

        @Test
        @DisplayName("a buyer is refused on all three tabs")
        void buyerRefused() throws Exception {
            String buyer = bearer(user("9855100015", Roles.Wire.BUYER, "Nosy Buyer"));

            mvc.perform(get(Routes.Moderation.ADMIN_ENQUIRIES)
                            .header(HttpHeaders.AUTHORIZATION, buyer))
                    .andExpect(status().isForbidden());
            mvc.perform(get(Routes.Moderation.ADMIN_VISITS)
                            .header(HttpHeaders.AUTHORIZATION, buyer))
                    .andExpect(status().isForbidden());
            mvc.perform(get(Routes.Moderation.ADMIN_DEALS)
                            .header(HttpHeaders.AUTHORIZATION, buyer))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("an anonymous caller is refused")
        void anonymousRefused() throws Exception {
            mvc.perform(get(Routes.Moderation.ADMIN_ENQUIRIES))
                    .andExpect(status().isUnauthorized());
        }
    }


    /** The number and the audit row are asserted in one request, so a refactor cannot keep one
     * and drop the other. */
    @Nested
    @DisplayName("opening one row is audited")
    class Detail {

        @Test
        @DisplayName("an admin opening an enquiry gets the number, and the log says they did")
        void enquiryDetailIsAudited() throws Exception {
            User owner = user("9855100016", Roles.Wire.OWNER, "Owner Seven");
            User buyer = user(RAW, Roles.Wire.BUYER, "Revealed Buyer");
            ContactRequest cr = enquiry(listing(owner, "Reveal fixture"), buyer,
                    ContactRequestStatuses.PENDING);
            User actor = admin("9855100017");

            mvc.perform(get(Routes.Moderation.ADMIN_ENQUIRY_BY_ID, cr.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.requesterMobile").value(RAW))
                    .andExpect(jsonPath("$.requesterName").value("Revealed Buyer"));

            assertThat(auditRows(actor, "enquiry.contact.reveal", cr.getId().toString()))
                    .isEqualTo(1);
            assertThat(auditMetadata(actor, "enquiry.contact.reveal")).contains(MASKED)
                    .doesNotContain(RAW);
        }

        @Test
        @DisplayName("a visit detail is audited the same way")
        void visitDetailIsAudited() throws Exception {
            User owner = user("9855100018", Roles.Wire.OWNER, "Owner Eight");
            User visitor = user(RAW, Roles.Wire.BUYER, "Revealed Visitor");
            Visit v = visits.saveAndFlush(new Visit(listing(owner, "Visit reveal").getId(),
                    visitor.getId(), Instant.now().plus(1, ChronoUnit.DAYS),
                    VisitModes.IN_PERSON, null));
            User actor = admin("9855100019");

            mvc.perform(get(Routes.Moderation.ADMIN_VISIT_BY_ID, v.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.visitorMobile").value(RAW));

            assertThat(auditRows(actor, "visit.contact.reveal", v.getId().toString())).isEqualTo(1);
        }

        /** A typed number may belong to someone with no account, so the log names the source. */
        @Test
        @DisplayName("an off-platform deal's log names the number's source")
        void dealDetailNamesItsSource() throws Exception {
            User owner = user("9855100020", Roles.Wire.OWNER, "Owner Nine");
            Deal d = new Deal(listing(owner, "Off-platform reveal").getId(), "buy");
            d.setCounterpartyMobile(RAW);
            d.setStatus(DealStatuses.CLOSED);
            d.setClosedAt(Instant.now());
            deals.saveAndFlush(d);
            User actor = admin("9855100021");

            mvc.perform(get(Routes.Moderation.ADMIN_DEAL_BY_ID, d.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.counterpartyMobile").value(RAW));

            assertThat(auditMetadata(actor, "deal.contact.reveal"))
                    .contains("off-platform")
                    .contains(MASKED)
                    .doesNotContain(RAW);
        }

        @Test
        @DisplayName("a staffer who reads the board opens a row too, and is audited")
        void staffOpensARow() throws Exception {
            User owner = user("9855100022", Roles.Wire.OWNER, "Owner Ten");
            User buyer = user(RAW, Roles.Wire.BUYER, "Desk Buyer");
            ContactRequest cr = enquiry(listing(owner, "Staff detail"), buyer,
                    ContactRequestStatuses.PENDING);
            User desk = user("9855100023", Roles.Wire.STAFF, "Desk");

            mvc.perform(get(Routes.Moderation.ADMIN_ENQUIRY_BY_ID, cr.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.requesterMobile").value(RAW));

            assertThat(auditRows(desk, "enquiry.contact.reveal", cr.getId().toString()))
                    .isEqualTo(1);
        }

        @Test
        @DisplayName("an unknown id is a 404, and nothing is logged")
        void unknownIdIsNotFoundAndUnlogged() throws Exception {
            User actor = admin("9855100024");
            String ghost = UUID.randomUUID().toString();

            mvc.perform(get(Routes.Moderation.ADMIN_ENQUIRY_BY_ID, ghost)
                            .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                    .andExpect(status().isNotFound());

            assertThat(auditRows(actor, "enquiry.contact.reveal", ghost)).isZero();
        }

        /** A path that is not a UUID is the same answer as one that is but names nothing. */
        @Test
        @DisplayName("a non-UUID id is a 404, not a 500")
        void malformedIdIsNotFound() throws Exception {
            mvc.perform(get(Routes.Moderation.ADMIN_ENQUIRY_BY_ID, "ENQ-17")
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin("9855100025"))))
                    .andExpect(status().isNotFound());
        }
    }

    // --- fixtures -----------------------------------------------------------------------------

    private User admin(String mobile) {
        return user(mobile, Roles.Wire.ADMIN, "Board Reader");
    }

    private User user(String mobile, String role, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        revealActors.add(saved.getId().toString());
        return saved;
    }

    private Property listing(User owner, String title) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        return properties.saveAndFlush(p);
    }

    private ContactRequest enquiry(Property p, User requester, String status) {
        ContactRequest cr = new ContactRequest(p.getId(), requester.getId(), "interested");
        cr.setStatus(status);
        return contactRequests.saveAndFlush(cr);
    }

    // --- audit helpers ------------------------------------------------------------------------

    /** Audit writes use {@code REQUIRES_NEW} and outlive the class rollback in a shared DB; cleaned by actor. */
    private final List<String> revealActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        revealActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        revealActors.clear();
    }

    /** Scoped by actor <em>and</em> entity id — other suites write to this table too. */
    private int auditRows(User actor, String action, String entityId) {
        return jdbc.queryForObject("""
                select count(*) from audit_log
                where actor = ? and action = ? and entity_id = ?
                """, Integer.class, actor.getId().toString(), action, entityId);
    }

    private String auditMetadata(User actor, String action) {
        return jdbc.queryForObject("""
                select coalesce(string_agg(metadata::text, ' '), '') from audit_log
                where actor = ? and action = ?
                """, String.class, actor.getId().toString(), action);
    }
}
