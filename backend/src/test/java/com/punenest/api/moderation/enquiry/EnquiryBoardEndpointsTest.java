package com.punenest.api.moderation.enquiry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.matchesPattern;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.deals.deal.Deal;
import com.punenest.api.deals.deal.DealRepository;
import com.punenest.api.deals.deal.DealStatuses;
import com.punenest.api.deals.visit.Visit;
import com.punenest.api.deals.visit.VisitModes;
import com.punenest.api.deals.visit.VisitRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.leads.contact.ContactRequest;
import com.punenest.api.leads.contact.ContactRequestRepository;
import com.punenest.api.leads.contact.ContactRequestStatuses;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
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

/**
 * D25 — {@code GET /admin/enquiries}, {@code /admin/visits}, {@code /admin/deals}: the demand board,
 * asserted at the route.
 *
 * <p><strong>Why this class exists.</strong> All three routes have been served since the console's
 * permission model landed, and a grep of the whole suite for {@code /admin/(enquiries|visits|deals)}
 * returned nothing — the board shipped, and no test had ever called it. What that leaves uncovered is
 * not the happy path, which is three repository reads and a projection, but the one property the
 * board exists to hold: <strong>the operator reading it is party to none of these conversations, so
 * no raw mobile may leave the server on any of the three routes, under any status, for any caller
 * role.</strong> That is a claim about a negative, and a negative is exactly the kind of thing that
 * survives a refactor by accident and dies by accident too.
 *
 * <p>So every masking assertion here is written twice over: once as {@code matchesPattern} against
 * the contract form {@code 98XXXXX210}, and once as an explicit {@code doesNotExist}-style check that
 * the raw digits are not the value. The pattern alone would pass if someone widened
 * {@link com.punenest.api.common.trust.MobileMask} to return its input; the inequality alone would
 * pass if someone replaced the mask with a constant. Together they pin the shape and the content.
 *
 * <p><strong>The deals tab is the one that matters most</strong> and reads like the least important.
 * A deal carries two possible sources for a number — {@code counterparty_mobile}, typed by an owner
 * closing off-platform, and the linked account's own mobile — and the service prefers the former.
 * A masking fix applied to "the user's mobile" would leave the typed one raw, and the typed one is
 * the number most likely to belong to somebody who never agreed to be on this platform at all. Both
 * branches are asserted separately for that reason.
 *
 * <p><strong>On the role split.</strong> {@code enquiries:read} is an <em>ops</em> atom, not an
 * admin-only one, so a plain staffer holds it from the baseline and gets a 200. That is deliberate —
 * this is a floor tool — and the test asserting it is not redundant with the admin one: it is what
 * makes the 403-for-a-buyer case mean "the role gate works" rather than "the route happens to be
 * admin-only today". Change the atom to {@code adminOnly} and this class tells you which decision
 * you changed.
 *
 * <p>Rows are seeded through the repositories rather than earned through the consumer flows that
 * would normally create them. A contact request earned through {@code POST /contacts} would drag the
 * contact gate's own preconditions into a test about masking, and a failure there would be reported
 * as a failure of this board.
 */
@DisplayName("D25 — the demand board reads, and never unmasks")
class EnquiryBoardEndpointsTest extends AbstractApiTest {

    /** The raw number every fixture requester carries; nothing may echo it back. */
    private static final String RAW = "9855100011";

    /** What {@link com.punenest.api.common.trust.MobileMask} must turn {@link #RAW} into. */
    private static final String MASKED = "98XXXXX011";

    /** The contract form, independent of any one fixture: two digits, five X, three digits. */
    private static final String MASK_SHAPE = "\\d{2}X{5}\\d{3}";

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

    // --- enquiries --------------------------------------------------------------------------

    @Nested
    @DisplayName("enquiries — contact requests, masked")
    class Enquiries {

        @Test
        @DisplayName("an admin sees the row, and the requester's number arrives already masked")
        void adminReadsMasked() throws Exception {
            User owner = user("9855100001", Roles.Wire.OWNER, "Owner One");
            User buyer = user(RAW, Roles.Wire.BUYER, "Curious Buyer");
            Property p = listing(owner, "Enquiry board fixture");
            enquiry(p, buyer, ContactRequestStatuses.PENDING);

            mvc.perform(get(Routes.Moderation.ADMIN_ENQUIRIES)
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin("9855100002")))
                            .param("status", ContactRequestStatuses.PENDING))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].requesterName").value("Curious Buyer"))
                    .andExpect(jsonPath("$.content[0].requesterMobile").value(MASKED))
                    .andExpect(jsonPath("$.content[0].requesterMobile",
                            matchesPattern(MASK_SHAPE)))
                    .andExpect(jsonPath("$.content[0].propertyTitle")
                            .value("Enquiry board fixture"));
        }

        /**
         * Approval is the status at which the <em>owner's</em> inbox reveals the number. This board
         * is not the owner's inbox, and the same row read here stays masked — which is the whole
         * reason {@code AdminEnquiryDto} exists instead of reusing {@code ContactRequestResponse}.
         */
        @Test
        @DisplayName("an approved request is still masked here — approval is not this board's key")
        void approvalDoesNotUnmask() throws Exception {
            User owner = user("9855100003", Roles.Wire.OWNER, "Owner Two");
            User buyer = user(RAW, Roles.Wire.BUYER, "Approved Buyer");
            enquiry(listing(owner, "Approved fixture"), buyer, ContactRequestStatuses.APPROVED);

            mvc.perform(get(Routes.Moderation.ADMIN_ENQUIRIES)
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin("9855100004")))
                            .param("status", ContactRequestStatuses.APPROVED))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].status")
                            .value(ContactRequestStatuses.APPROVED))
                    .andExpect(jsonPath("$.content[0].requesterMobile").value(MASKED));
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

    // --- visits -----------------------------------------------------------------------------

    @Nested
    @DisplayName("visits — the same masking, a different table")
    class Visits {

        @Test
        @DisplayName("the visitor's number is masked, and the slot survives the projection")
        void visitorIsMasked() throws Exception {
            User owner = user("9855100007", Roles.Wire.OWNER, "Owner Four");
            User visitor = user(RAW, Roles.Wire.BUYER, "Site Visitor");
            Property p = listing(owner, "Visit board fixture");
            visits.saveAndFlush(new Visit(p.getId(), visitor.getId(),
                    Instant.now().plus(2, ChronoUnit.DAYS), VisitModes.IN_PERSON, null));

            mvc.perform(get(Routes.Moderation.ADMIN_VISITS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin("9855100008"))))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].visitorName").value("Site Visitor"))
                    .andExpect(jsonPath("$.content[0].visitorMobile").value(MASKED))
                    .andExpect(jsonPath("$.content[0].visitorMobile", matchesPattern(MASK_SHAPE)))
                    .andExpect(jsonPath("$.content[0].mode").value(VisitModes.IN_PERSON))
                    .andExpect(jsonPath("$.content[0].slot").exists());
        }
    }

    // --- deals ------------------------------------------------------------------------------

    @Nested
    @DisplayName("deals — two sources for one number, both masked")
    class Deals {

        @Test
        @DisplayName("a registered counterparty's own mobile is masked")
        void registeredCounterpartyIsMasked() throws Exception {
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
                    .andExpect(jsonPath("$.content[0].counterpartyMobile").value(MASKED))
                    .andExpect(jsonPath("$.content[0].agreedPrice").value(24000));
        }

        /**
         * The branch a masking fix aimed at "the user's mobile" would miss entirely. There is no
         * account behind this number — an owner typed it while closing off-platform — so it belongs
         * to somebody who may never have used the product, and it is the last one that should reach
         * an operator's screen raw. The name is legitimately null here; the mobile is not.
         */
        @Test
        @DisplayName("an off-platform close: the typed number is masked even with no account behind it")
        void typedCounterpartyMobileIsMasked() throws Exception {
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
                    .andExpect(jsonPath("$.content[0].counterpartyMobile").value(MASKED))
                    .andExpect(jsonPath("$.content[0].counterpartyMobile",
                            matchesPattern(MASK_SHAPE)));
        }
    }

    // --- who may open the board ---------------------------------------------------------------

    @Nested
    @DisplayName("who may open the board")
    class Authorisation {

        /**
         * Not redundant with the admin cases. {@code enquiries:read} is an <em>ops</em> atom, so a
         * staffer holds it from the baseline with no permissions document at all — and that is the
         * decision this asserts. Without it, the buyer's 403 below would be equally consistent with
         * the route being admin-only, and nothing would notice if it silently became so.
         */
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

    // --- the audited reveal (D25) --------------------------------------------------------------

    /**
     * The half of the board that overturns a decision, and therefore the half most worth pinning.
     *
     * <p>Every test here asserts <em>both</em> halves of the bargain in one request: the number came
     * back raw, and a row was written saying so. Splitting them into separate tests would allow a
     * refactor that keeps each passing while breaking the relationship between them — a reveal that
     * logs nothing still returns the number, and an audit write that happens after a serialisation
     * failure still leaves the number on the wire. Asserting them together is the only way to state
     * "unlogged reveals are impossible" rather than "reveals happen and logging happens".
     *
     * <p>The audit row is checked for the <em>masked</em> value on purpose. The log exists to record
     * that a disclosure occurred; storing the raw number there would make it a second copy of the
     * thing being protected, in a table more people can read than can call these routes.
     */
    @Nested
    @DisplayName("the audited reveal")
    class Reveal {

        @Test
        @DisplayName("an admin opening an enquiry gets the raw number, and the log says they did")
        void enquiryRevealIsAuditedAndRaw() throws Exception {
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
        @DisplayName("a visit reveal is audited the same way")
        void visitRevealIsAudited() throws Exception {
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

        /**
         * The case the whole reveal was hardest to justify for, so it carries the extra assertion.
         * This number was typed by an owner closing off-platform and belongs to no account here; the
         * audit row therefore records <em>which source</em> it came from. A log that cannot tell a
         * stranger's number from a registered user's cannot answer the only question anyone will ask
         * of it afterwards.
         */
        @Test
        @DisplayName("an off-platform deal reveals the typed number, and the log names the source")
        void dealRevealNamesItsSource() throws Exception {
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

        /**
         * The load-bearing guard test, and the one that reads like pedantry. A staffer clears the
         * role gate on the <em>list</em> and holds {@code enquiries:read} from the baseline, so
         * nothing about their credentials distinguishes them here except the raised role term. Delete
         * this and the reveal quietly becomes available to the entire ops floor while every other
         * test in this class still passes.
         */
        @Test
        @DisplayName("a staffer who may read the board may not unmask a row")
        void staffCannotReveal() throws Exception {
            User owner = user("9855100022", Roles.Wire.OWNER, "Owner Ten");
            User buyer = user(RAW, Roles.Wire.BUYER, "Shielded Buyer");
            ContactRequest cr = enquiry(listing(owner, "Staff refusal"), buyer,
                    ContactRequestStatuses.PENDING);
            User desk = user("9855100023", Roles.Wire.STAFF, "Desk");

            mvc.perform(get(Routes.Moderation.ADMIN_ENQUIRIES)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isOk());
            mvc.perform(get(Routes.Moderation.ADMIN_ENQUIRY_BY_ID, cr.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isForbidden());

            assertThat(auditRows(desk, "enquiry.contact.reveal", cr.getId().toString())).isZero();
        }

        @Test
        @DisplayName("an unknown id is a 404, and nothing is logged for a reveal that did not happen")
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

    /**
     * Audit writes run in {@code REQUIRES_NEW}, so they outlive this class's rollback and would
     * otherwise pile up in a database other suites share. Cleaned by actor, the way
     * {@code ModeratedConversationEndpointTest} does it.
     */
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
