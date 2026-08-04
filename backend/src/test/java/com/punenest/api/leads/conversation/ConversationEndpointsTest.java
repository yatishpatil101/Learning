package com.punenest.api.leads.conversation;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.leads.contact.ContactRequest;
import com.punenest.api.leads.contact.ContactRequestRepository;
import com.punenest.api.leads.contact.ContactRequestStatuses;
import com.punenest.api.security.Roles;
import com.punenest.api.security.Teams;
import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * In-app messaging, organised around the three things that can go wrong rather than around the four
 * endpoints: <strong>who may open a thread</strong>, <strong>whether the refusal leaks</strong>, and
 * <strong>whether a thread can fork</strong>.
 *
 * <p>The enumeration-oracle test is the one that matters most and is the easiest to delete by
 * accident, because it asserts that two different situations produce the <em>same</em> response —
 * which reads like a redundant test until you remember that the difference is the vulnerability.
 */
@DisplayName("Slice 12 — conversations: who may talk to whom")
class ConversationEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    ContactRequestRepository contactRequests;
    @Autowired
    ConversationRepository conversations;

    @Nested
    @DisplayName("the relationship guard")
    class Guard {

        @Test
        @DisplayName("an approved contact request opens the door — in either direction")
        void approvedContactMayMessage() throws Exception {
            User owner = user("9830000101", Roles.Wire.OWNER, "Owner One");
            User buyer = user("9830000102", Roles.Wire.BUYER, "Buyer Two");
            Property p = listing(owner);
            approve(buyer, p);

            // Buyer -> owner: the buyer is the one who asked.
            start(buyer, owner, p, 201);
            // Owner -> buyer, about the same listing: the guard looks both ways, so the owner does
            // not have to raise a contact request against their own flat to answer.
            start(owner, buyer, p, 200);
        }

        @Test
        @DisplayName("a stranger cannot message an owner they never asked about")
        void strangerRefused() throws Exception {
            User owner = user("9830000103", Roles.Wire.OWNER, "Owner Three");
            User stranger = user("9830000104", Roles.Wire.BUYER, "Stranger");
            listing(owner);

            start(stranger, owner, null, 403);
        }

        @Test
        @DisplayName("a pending contact request is not a relationship")
        void pendingIsNotApproved() throws Exception {
            User owner = user("9830000105", Roles.Wire.OWNER, "Owner Five");
            User buyer = user("9830000106", Roles.Wire.BUYER, "Buyer Six");
            Property p = listing(owner);
            contactRequests.saveAndFlush(new ContactRequest(p.getId(), buyer.getId(), "interested"));

            start(buyer, owner, p, 403);
        }

        @Test
        @DisplayName("staff may open a thread with anyone")
        void staffMayAlwaysMessage() throws Exception {
            User desk = user("9830000107", Roles.Wire.STAFF, "Desk", Teams.LEGAL);
            User anyone = user("9830000108", Roles.Wire.BUYER, "Anyone");

            start(desk, anyone, null, 201);
        }

        @Test
        @DisplayName("nobody can message themselves")
        void selfRefused() throws Exception {
            User me = user("9830000109", Roles.Wire.BUYER, "Me");

            start(me, me, null, 403);
        }

        @Test
        @DisplayName("a listing neither party owns cannot be the subject of a thread")
        void unrelatedPropertyRefused() throws Exception {
            User owner = user("9830000110", Roles.Wire.OWNER, "Owner Ten");
            User buyer = user("9830000111", Roles.Wire.BUYER, "Buyer Eleven");
            User thirdParty = user("9830000112", Roles.Wire.OWNER, "Third Party");
            Property theirs = listing(owner);
            Property elsewhere = listing(thirdParty);
            approve(buyer, theirs);

            // The pair are related, but the listing they claim to be discussing belongs to neither
            // of them — otherwise propertyId is an arbitrary id that drives the title and the gate.
            start(buyer, owner, elsewhere, 403);
        }
    }

    @Nested
    @DisplayName("the refusal must not be an oracle")
    class Oracle {

        @Test
        @DisplayName("an unregistered number and an unrelated user get the identical answer")
        void refusalIsIndistinguishable() throws Exception {
            User caller = user("9830000121", Roles.Wire.BUYER, "Caller");
            User unrelated = user("9830000122", Roles.Wire.OWNER, "Unrelated");

            String toUnregistered = mvc.perform(post(Routes.Conversations.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body("9899999999", null, "hello")))
                    .andExpect(status().isForbidden())
                    .andReturn().getResponse().getContentAsString();

            String toUnrelated = mvc.perform(post(Routes.Conversations.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body(unrelated.getMobile(), null, "hello")))
                    .andExpect(status().isForbidden())
                    .andReturn().getResponse().getContentAsString();

            // Same status, same body. If these ever diverge, POST /messages becomes a way to test a
            // list of phone numbers against the user base without an account of the target's.
            assertThat(strip(toUnregistered)).isEqualTo(strip(toUnrelated));
        }

        @Test
        @DisplayName("a string that is not mobile-shaped is a 422, and that is not an oracle (D23a)")
        void malformedMobileIsRejectedAtTheEdge() throws Exception {
            User caller = user("9830000123", Roles.Wire.BUYER, "Edge caller");

            // The field carried only @Size(max = 20) until D23a, while the contract $refs Mobile.
            // Anything non-numeric fell through to MobileMask.normalise(), which answers null, which
            // the lookup turned into the catch-all 403 -- so "not a phone number" was reported as
            // "no such conversation partner".
            for (String notAMobile : new String[] {"not-a-number", "919876543210", "2012345678"}) {
                mvc.perform(post(Routes.Conversations.BASE)
                                .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body(notAMobile, null, "hello")))
                        .andExpect(status().isUnprocessableEntity());
            }

            // The oracle property survives: a 422 says the string is not mobile-shaped, which the
            // caller already knew. It never distinguishes a registered number from an unregistered
            // one -- both of those are well-formed, and both still take the 403 path asserted above.
            mvc.perform(post(Routes.Conversations.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body("9899999998", null, "hello")))
                    .andExpect(status().isForbidden());
        }
    }

    @Nested
    @DisplayName("a thread cannot fork")
    class FindOrCreate {

        @Test
        @DisplayName("starting twice returns the same thread, 201 then 200")
        void idempotent() throws Exception {
            User owner = user("9830000131", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000132", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);

            String first = start(buyer, owner, p, 201);
            String second = start(buyer, owner, p, 200);

            assertThat(id(first)).isEqualTo(id(second));
            assertThat(conversations.inboxOf(buyer.getId(), Pageable.unpaged())).hasSize(1);
        }

        @Test
        @DisplayName("the other party opening the same thread does not create a second one")
        void flippedPairFindsTheSameRow() throws Exception {
            User owner = user("9830000133", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000134", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);

            String fromBuyer = start(buyer, owner, p, 201);
            String fromOwner = start(owner, buyer, p, 200);

            // The canonical ordering is what makes this true: whoever posts first, the pair lands in
            // the same two columns, so the second lookup hits the existing row.
            assertThat(id(fromBuyer)).isEqualTo(id(fromOwner));
            assertThat(conversations.inboxOf(owner.getId(), Pageable.unpaged())).hasSize(1);
        }

        @Test
        @DisplayName("a general thread and a listing thread are different conversations")
        void propertyDistinguishesThreads() throws Exception {
            User owner = user("9830000135", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000136", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);

            start(buyer, owner, p, 201);
            start(buyer, owner, null, 201);

            // Two rows, and the null-property one is reachable — a plain `property_id = null`
            // comparison would have missed it and forked the general thread on every send.
            assertThat(conversations.inboxOf(buyer.getId(), Pageable.unpaged())).hasSize(2);
        }
    }

    @Nested
    @DisplayName("the thread itself")
    class Thread {

        @Test
        @DisplayName("the inbox omits messages; the detail carries them")
        void listVersusDetail() throws Exception {
            User owner = user("9830000141", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000142", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);
            String id = id(start(buyer, owner, p, 201));

            mvc.perform(get(Routes.Conversations.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", hasSize(1)))
                    .andExpect(jsonPath("$.content[0].lastMessage").value("hello"))
                    .andExpect(jsonPath("$.content[0].propertyTitle").value("2BHK in Kothrud"))
                    .andExpect(jsonPath("$.content[0].messages").doesNotExist());

            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.messages", hasSize(1)))
                    .andExpect(jsonPath("$.messages[0].body").value("hello"))
                    .andExpect(jsonPath("$.messages[0].author").value("Buyer"))
                    .andExpect(jsonPath("$.counterpartyName").value("Owner"));
        }

        @Test
        @DisplayName("unread counts the other side's messages, and read clears them")
        void unreadAccounting() throws Exception {
            User owner = user("9830000143", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000144", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);
            String id = id(start(buyer, owner, p, 201));
            reply(owner, id, "sure, come by", 201);

            // The sender never accrues unread against their own words.
            expectUnread(buyer, 1);
            expectUnread(owner, 1);

            mvc.perform(post(Routes.Conversations.READ, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isNoContent());

            expectUnread(buyer, 0);
            // Reading my side does not read yours.
            expectUnread(owner, 1);

            // Idempotent: the client marks read on every open.
            mvc.perform(post(Routes.Conversations.READ, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isNoContent());
            expectUnread(buyer, 0);
        }

        @Test
        @DisplayName("a non-participant gets 404, never 403 — the id is the secret")
        void outsiderSeesNothing() throws Exception {
            User owner = user("9830000145", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000146", Roles.Wire.BUYER, "Buyer");
            User nosy = user("9830000147", Roles.Wire.BUYER, "Nosy");
            User boss = user("9830000148", Roles.Wire.ADMIN, "Admin");
            Property p = listing(owner);
            approve(buyer, p);
            String id = id(start(buyer, owner, p, 201));

            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(nosy)))
                    .andExpect(status().isNotFound());
            reply(nosy, id, "let me in", 404);
            mvc.perform(post(Routes.Conversations.READ, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(nosy)))
                    .andExpect(status().isNotFound());

            // Admin is not exempt: a private chat is not an ops surface. If moderation ever needs
            // one it should arrive as its own audited endpoint, not as a role check hidden here.
            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(boss)))
                    .andExpect(status().isNotFound());

            mvc.perform(get(Routes.Conversations.BY_ID, "not-a-uuid")
                            .header(HttpHeaders.AUTHORIZATION, bearer(nosy)))
                    .andExpect(status().isNotFound());
        }
    }

    @Nested
    @DisplayName("masking is not relaxed by being in a thread")
    class Masking {

        @Test
        @DisplayName("the approved buyer sees the owner's number; the owner still sees a mask")
        void asymmetry() throws Exception {
            User owner = user("9830000151", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000152", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);
            String id = id(start(buyer, owner, p, 201));

            // ADR-019: approval reveals the *owner's* number to the buyer who asked, never the
            // buyer's number to the owner. Being in one thread is not a mutual reveal.
            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(jsonPath("$.counterpartyMobile").value("9830000151"));
            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(jsonPath("$.counterpartyMobile").value("98XXXXX152"));
        }

        @Test
        @DisplayName("a thread with no listing masks both ways — there is no gate to have passed")
        void generalThreadMasksBothWays() throws Exception {
            User owner = user("9830000153", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000154", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);
            String id = id(start(buyer, owner, null, 201));

            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(jsonPath("$.counterpartyMobile").value("98XXXXX153"));
            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(jsonPath("$.counterpartyMobile").value("98XXXXX154"));
        }
    }

    // --- fixtures -------------------------------------------------------------------------

    private User user(String mobile, String role, String name) {
        return user(mobile, role, name, null);
    }

    private User user(String mobile, String role, String name, String team) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setTeam(team);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "2BHK in Kothrud", "rent", "apartment", 25000L,
                "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        return properties.saveAndFlush(p);
    }

    private void approve(User requester, Property property) {
        ContactRequest cr = new ContactRequest(property.getId(), requester.getId(), "interested");
        cr.setStatus(ContactRequestStatuses.APPROVED);
        contactRequests.saveAndFlush(cr);
    }

    private String start(User caller, User counterparty, Property property, int expected)
            throws Exception {
        return mvc.perform(post(Routes.Conversations.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(counterparty.getMobile(),
                                property == null ? null : property.getId().toString(), "hello")))
                .andExpect(status().is(expected))
                .andReturn().getResponse().getContentAsString();
    }

    private void reply(User caller, String id, String text, int expected) throws Exception {
        mvc.perform(post(Routes.Conversations.REPLY, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"" + text + "\"}"))
                .andExpect(status().is(expected));
    }

    private void expectUnread(User caller, int expected) throws Exception {
        mvc.perform(get(Routes.Conversations.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].unread").value(expected));
    }

    private static String body(String mobile, String propertyId, String text) {
        return "{\"counterpartyMobile\":\"" + mobile + "\""
                + (propertyId == null ? "" : ",\"propertyId\":\"" + propertyId + "\"")
                + ",\"body\":\"" + text + "\"}";
    }

    private static String id(String json) {
        return json.replaceAll("(?s)^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    /** Drop anything per-request (timestamps, correlation ids) so two errors can be compared. */
    private static String strip(String json) {
        return json.replaceAll("\"(timestamp|correlationId|traceId|path)\":\"[^\"]*\"", "");
    }
}
