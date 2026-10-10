package com.draazy.api.leads.conversation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.leads.contact.ContactRequest;
import com.draazy.api.leads.contact.ContactRequestRepository;
import com.draazy.api.leads.contact.ContactRequestStatuses;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@DisplayName("Messages Phase 2 realtime contract")
class ConversationRealtimeTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    ContactRequestRepository contactRequests;
    @Autowired
    MessageEvents events;
    @Autowired
    ConversationMessageRepository messageRepository;
    @Autowired
    PlatformTransactionManager transactionManager;

    @Test
    @DisplayName("typing is participant-only")
    void typingRequiresParticipant() throws Exception {
        User owner = user(Roles.Wire.OWNER, "Owner");
        User buyer = user(Roles.Wire.BUYER, "Buyer");
        User stranger = user(Roles.Wire.BUYER, "Stranger");
        Property property = listing(owner);
        approve(buyer, property);
        String id = id(start(buyer, owner, property));

        mvc.perform(post(Routes.Conversations.TYPING, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isNoContent());
        mvc.perform(post(Routes.Conversations.TYPING, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("opening the inbox marks pair messages delivered")
    void inboxMarksDelivered() throws Exception {
        User owner = user(Roles.Wire.OWNER, "Owner");
        User buyer = user(Roles.Wire.BUYER, "Buyer");
        Property property = listing(owner);
        approve(buyer, property);
        String id = id(start(buyer, owner, property));

        assertDeliveredAt(id, buyer, null);
        mvc.perform(get(Routes.Conversations.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Conversations.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages[0].delivered").value(true));
    }

    @Test
    @DisplayName("read receipts are hidden unless both users share them")
    void readReceiptsAreReciprocal() throws Exception {
        User owner = user(Roles.Wire.OWNER, "Owner");
        owner.setShareReadReceipts(false);
        users.saveAndFlush(owner);
        User buyer = user(Roles.Wire.BUYER, "Buyer");
        Property property = listing(owner);
        approve(buyer, property);
        String id = id(start(buyer, owner, property));

        mvc.perform(post(Routes.Conversations.READ, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());

        mvc.perform(get(Routes.Conversations.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages[0].read").value(false))
                .andExpect(jsonPath("$.messages[0].delivered").value(true));
    }

    @Test
    @DisplayName("read receipts and presence are hidden across a block")
    void blockHidesReadReceiptsAndPresence() throws Exception {
        User owner = user(Roles.Wire.OWNER, "Owner");
        User buyer = user(Roles.Wire.BUYER, "Buyer");
        Property property = listing(owner);
        approve(buyer, property);
        String id = id(start(buyer, owner, property, "hello"));

        mvc.perform(post(Routes.Conversations.READ, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());
        mvc.perform(get(Routes.Conversations.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages[0].read").value(true))
                .andExpect(jsonPath("$.presence").exists());

        mvc.perform(post(Routes.Conversations.BLOCK, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());

        mvc.perform(get(Routes.Conversations.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages[0].read").value(false))
                .andExpect(jsonPath("$.presence").doesNotExist());
    }

    @Test
    @DisplayName("last message preview is masked until contact is revealed")
    void lastMessagePreviewMasksCounterpartyPhone() throws Exception {
        User owner = user(Roles.Wire.OWNER, "Owner");
        User buyer = user(Roles.Wire.BUYER, "Buyer");
        Property property = listing(owner);
        approve(buyer, property);

        start(buyer, owner, null, "Call me 9876543210");

        mvc.perform(get(Routes.Conversations.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].lastMessage").value(containsString("98XXXXX210")))
                .andExpect(jsonPath("$.content[0].lastMessage").value(not(containsString("9876543210"))));
    }

    @Test
    @DisplayName("presence is omitted when either side hides activity")
    void presenceHonoursActivityPrivacy() throws Exception {
        User owner = user(Roles.Wire.OWNER, "Owner");
        User buyer = user(Roles.Wire.BUYER, "Buyer");
        Property property = listing(owner);
        approve(buyer, property);
        String id = id(start(buyer, owner, property));

        owner.setShareActivityStatus(false);
        users.saveAndFlush(owner);
        mvc.perform(get(Routes.Conversations.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.presence").doesNotExist());

        owner.setShareActivityStatus(true);
        buyer.setShareActivityStatus(false);
        users.saveAndFlush(owner);
        users.saveAndFlush(buyer);
        mvc.perform(get(Routes.Conversations.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.presence").doesNotExist());
    }

    @Test
    @DisplayName("the badge count marks nothing delivered; a message to a live stream is delivered at once")
    void deliveryIsWrittenOnHandOverNotOnTheBadgeRead() throws Exception {
        User owner = user(Roles.Wire.OWNER, "Owner");
        User buyer = user(Roles.Wire.BUYER, "Buyer");
        Property property = listing(owner);
        approve(buyer, property);
        String offline = id(start(buyer, owner, property));

        mvc.perform(get(Routes.Conversations.UNREAD_COUNT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count").value(1));
        assertDeliveredAt(offline, buyer, null);
        // The returned ids are who the `delivered` event goes to, so a second pass must find nothing.
        assertThat(messageRepository.markInboxDelivered(owner.getId())).containsExactly(UUID.fromString(offline));
        assertThat(messageRepository.markInboxDelivered(owner.getId())).isEmpty();

        User live = user(Roles.Wire.OWNER, "Live owner");
        Property other = listing(live);
        approve(buyer, other);
        MvcResult stream = mvc.perform(get(Routes.Conversations.STREAM)
                        .header(HttpHeaders.AUTHORIZATION, bearer(live)))
                .andExpect(request().asyncStarted())
                .andReturn();
        try {
            String online = id(start(buyer, live, other));
            assertThat(jdbc.queryForObject("select delivered_at from messages where conversation_id = ?::uuid",
                    Instant.class, online)).isNotNull();
        } finally {
            stream.getRequest().getAsyncContext().complete();
        }
    }

    @Test
    @DisplayName("stream is SSE for authenticated users")
    void streamEndpointShape() throws Exception {
        User buyer = user(Roles.Wire.BUYER, "Buyer");

        MvcResult stream = mvc.perform(get(Routes.Conversations.STREAM)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_TYPE, startsWith(MediaType.TEXT_EVENT_STREAM_VALUE)))
                .andExpect(header().string("X-Accel-Buffering", "no"))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-cache"))
                .andExpect(request().asyncStarted())
                .andReturn();
        stream.getRequest().getAsyncContext().complete();

        mvc.perform(get(Routes.Conversations.STREAM))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("self profile round-trips realtime privacy toggles")
    void selfProfileRoundTripsRealtimeToggles() throws Exception {
        User buyer = user(Roles.Wire.BUYER, "Buyer");

        mvc.perform(patch(Routes.Auth.ME)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"shareActivityStatus\":false,\"shareReadReceipts\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shareActivityStatus").value(false))
                .andExpect(jsonPath("$.shareReadReceipts").value(false));

        mvc.perform(get(Routes.Auth.ME)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shareActivityStatus").value(false))
                .andExpect(jsonPath("$.shareReadReceipts").value(false));
    }

    @Test
    @DisplayName("after-commit callbacks wait for the commit, then fire")
    void afterCommitCallbackWaitsForCommit() {
        AtomicInteger fired = new AtomicInteger();

        events.afterCommit(fired::incrementAndGet);
        assertThat(fired).hasValue(0);

        TransactionTemplate committing = new TransactionTemplate(transactionManager);
        committing.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        committing.executeWithoutResult(status -> events.afterCommit(fired::incrementAndGet));

        assertThat(fired).hasValue(1);
    }

    private User user(String role, String name) {
        User user = new User(freshMobile(), role);
        user.setName(name);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
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

    private String start(User caller, User counterparty, Property property) throws Exception {
        return start(caller, counterparty, property, "hello");
    }

    private String start(User caller, User counterparty, Property property, String body) throws Exception {
        String propertyJson = property == null ? "" : ",\"propertyId\":\"" + property.getId() + "\"";
        return mvc.perform(post(Routes.Conversations.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"counterpartyMobile\":\"" + counterparty.getMobile()
                                + "\"" + propertyJson + ",\"body\":\"" + body + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
    }

    private void assertDeliveredAt(String conversationId, User author, Instant expected) {
        Instant actual = jdbc.queryForObject("""
                select delivered_at from messages
                 where conversation_id = ?::uuid and author_id = ?::uuid
                """, Instant.class, conversationId, author.getId().toString());
        org.assertj.core.api.Assertions.assertThat(actual).isEqualTo(expected);
    }

    private static String id(String json) {
        return json.replaceAll("(?s)^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    private static String freshMobile() {
        long n = Math.abs(UUID.randomUUID().getMostSignificantBits() % 1_000_000_000L);
        return "9" + String.format("%09d", n);
    }
}
