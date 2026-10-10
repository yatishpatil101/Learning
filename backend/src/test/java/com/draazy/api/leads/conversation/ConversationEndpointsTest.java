package com.draazy.api.leads.conversation;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
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
import com.draazy.api.security.Teams;
import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

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

    // These cover the derivation added for that — and, more importantly, that it did not become a way around the guard.
    @Nested
    @DisplayName("addressing by listing")
    class ByListing {

        @Test
        @DisplayName("an approved buyer opens the thread with propertyId and no mobile")
        void derivesTheOwnerFromTheListing() throws Exception {
            User owner = user("9830000161", Roles.Wire.OWNER, "Owner Sixty-one");
            User buyer = user("9830000162", Roles.Wire.BUYER, "Buyer Sixty-two");
            Property p = listing(owner);
            approve(buyer, p);

            // The buyer cannot have typed the number: this is exactly what they hold — a listing id.
            mvc.perform(post(Routes.Conversations.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(byListing(p, "is this still available?")))
                    .andExpect(status().isCreated())

                    .andExpect(jsonPath("$.counterpartyName").value("Owner Sixty-one"))
                    .andExpect(jsonPath("$.counterpartyMobile").value("9830000161"))
                    .andExpect(jsonPath("$.propertyId").value(p.getId().toString()));
        }

        @Test
        @DisplayName("the derived thread is the same thread the mobile would have opened")
        void derivationDoesNotForkTheThread() throws Exception {
            User owner = user("9830000163", Roles.Wire.OWNER, "Owner Sixty-three");
            User buyer = user("9830000164", Roles.Wire.BUYER, "Buyer Sixty-four");
            Property p = listing(owner);
            approve(buyer, p);

            String byMobile = start(buyer, owner, p, 201);
            String derived = mvc.perform(post(Routes.Conversations.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(byListing(p, "again")))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();

            // 200 not 201, same id, one row: the derivation resolves to the same user, so it cannot
            // give one relationship two inboxes depending on how the client happened to address it.
            assertThat(id(derived)).isEqualTo(id(byMobile));
            assertThat(conversations.inboxOf(buyer.getId(), Pageable.unpaged())).hasSize(1);
        }

        @Test
        @DisplayName("naming a listing is not a relationship — the approval still decides")
        void derivationIsNotAWayRoundTheGuard() throws Exception {
            User owner = user("9830000165", Roles.Wire.OWNER, "Owner Sixty-five");
            User stranger = user("9830000166", Roles.Wire.BUYER, "Stranger Sixty-six");
            Property p = listing(owner);

            // Byte-identical to the request in `derivesTheOwnerFromTheListing`; the only difference is the missing
            // approval.
            mvc.perform(post(Routes.Conversations.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(byListing(p, "is this still available?")))
                    .andExpect(status().isForbidden());

            approve(stranger, p);

            // The derived branch has to match it, or the same person becomes addressable by listing after they have
            // gone.
            mvc.perform(post(Routes.Conversations.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(byListing(p, "is this still available?")))
                    .andExpect(status().isCreated());
        }

        @Test
        @DisplayName("a listing whose owner has left is refused like any other unreachable party")
        void archivedOwnerIsRefused() throws Exception {
            User owner = user("9830000167", Roles.Wire.OWNER, "Owner Sixty-seven");
            User buyer = user("9830000168", Roles.Wire.BUYER, "Buyer Sixty-eight");
            Property p = listing(owner);
            approve(buyer, p);
            owner.archive("Erased on the account holder's request");
            users.saveAndFlush(owner);

            // Answering it with the enumeration-safe 403 would hide a client bug behind a refusal the client is told
            // to expect, and would leave `counterpartyMobile` looking optional in every case.
            mvc.perform(post(Routes.Conversations.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(byListing(p, "hello")))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("addressing nobody is a 422, deliberately not the catch-all 403")
        void addressingNobodyIsAValidationError() throws Exception {
            User caller = user("9830000169", Roles.Wire.BUYER, "Caller Sixty-nine");

            mvc.perform(post(Routes.Conversations.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"body\":\"hello\"}"))
                    .andExpect(status().isUnprocessableEntity());
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
        @DisplayName("a string that is not mobile-shaped is a 422, and that is not an oracle (D23a/Q1)")
        void malformedMobileIsRejectedAtTheEdge() throws Exception {
            User caller = user("9830000123", Roles.Wire.BUYER, "Edge caller");

            // Both are 422 at the edge, before any lookup.
            for (String notAMobile : new String[] {"not-a-number", "2012345678"}) {
                mvc.perform(post(Routes.Conversations.BASE)
                                .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body(notAMobile, null, "hello")))
                        .andExpect(status().isUnprocessableEntity());
            }

            // A 422 only ever says "not mobile-shaped".
            for (String wellFormed : new String[] {"9899999998", "919899999998"}) {
                mvc.perform(post(Routes.Conversations.BASE)
                                .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body(wellFormed, null, "hello")))
                        .andExpect(status().isForbidden());
            }
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
                    .andExpect(jsonPath("$.content[0].youAre").value("buyer"))
                    .andExpect(jsonPath("$.content[0].propertyPrice").value(25000))
                    .andExpect(jsonPath("$.content[0].propertyDeal").value("rent"))
                    .andExpect(jsonPath("$.content[0].propertyBhk").value("2 BHK"))
                    .andExpect(jsonPath("$.content[0].propertyLocality").value("Kothrud"))
                    .andExpect(jsonPath("$.content[0].propertyAvailable").value(true))
                    .andExpect(jsonPath("$.content[0].archived").value(false))
                    .andExpect(jsonPath("$.content[0].muted").value(false))
                    .andExpect(jsonPath("$.content[0].blocked").value(false))
                    .andExpect(jsonPath("$.content[0].awaitingReply").value(false))
                    .andExpect(jsonPath("$.content[0].counterpartyMobile").doesNotExist())
                    .andExpect(jsonPath("$.content[0].presence").doesNotExist())
                    .andExpect(jsonPath("$.content[0].messages").doesNotExist());

            // Both people are called "Same Name", so `author` cannot separate them and `mine`
            // is the only field that can. That is the whole reason this test uses a duplicate name.
            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.messages", hasSize(1)))
                    .andExpect(jsonPath("$.messages[0].body").value("hello"))
                    .andExpect(jsonPath("$.messages[0].read").value(false))
                    .andExpect(jsonPath("$.messages[0].author").value("Buyer"))
                    .andExpect(jsonPath("$.counterpartyName").value("Owner"));
        }

        @Test
        @DisplayName("a message says whether the reader wrote it, not whose id it carries")
        void messageCarriesMineNotAuthorId() throws Exception {
            User owner = user("9830000151", Roles.Wire.OWNER, "Same Name");
            User buyer = user("9830000152", Roles.Wire.BUYER, "Same Name");
            Property p = listing(owner);
            approve(buyer, p);
            String id = id(start(buyer, owner, p, 201));
            reply(owner, id, "replying", 201);

            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.messages[0].mine").value(true))
                    .andExpect(jsonPath("$.messages[1].mine").value(false))
                    .andExpect(jsonPath("$.messages[1].authorId").doesNotExist())
                    .andExpect(jsonPath("$.messages[1].authorRole").doesNotExist());
        }

        @Test
        @DisplayName("a message notifies the recipient — and only the recipient")
        void messageNotifiesTheOtherSide() throws Exception {
            User owner = user("9830000153", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000154", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);
            String id = id(start(buyer, owner, p, 201));

            assertThat(notificationsFor(owner)).hasSize(1);
            assertThat(notificationsFor(owner).getFirst().get("type")).isEqualTo("message.received");
            assertThat((String) notificationsFor(owner).getFirst().get("title")).contains("Buyer");
            assertThat((String) notificationsFor(owner).getFirst().get("link")).isEqualTo("/messages?c=" + id);

            assertThat(notificationsFor(buyer)).isEmpty();

            reply(owner, id, "sure, come by", 201);
            assertThat(notificationsFor(buyer)).hasSize(1);
            assertThat(notificationsFor(owner)).hasSize(1);
        }

        @Test
        @DisplayName("a burst of unread messages makes one bell row; reading re-arms it")
        void unreadBurstCollapsesToOneRow() throws Exception {
            User owner = user("9830000197", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000198", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);
            String id = id(start(buyer, owner, p, 201));

            reply(buyer, id, "are you there?", 201);
            reply(buyer, id, "hello?", 201);
            assertThat(notificationsFor(owner)).hasSize(1);

            mvc.perform(post(Routes.Conversations.READ, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isNoContent());
            reply(buyer, id, "one more thing", 201);
            assertThat(notificationsFor(owner)).hasSize(2);
        }

        @Test
        @DisplayName("a long message is truncated in the notification body")
        void longMessageIsPreviewed() throws Exception {
            User owner = user("9830000155", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000156", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);

            String wall = "x".repeat(1000);
            mvc.perform(post(Routes.Conversations.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body(owner.getMobile(), p.getId().toString(), wall)))
                    .andExpect(status().isCreated());

            String delivered = (String) notificationsFor(owner).getFirst().get("body");
            assertThat(delivered).hasSizeLessThan(200).endsWith("…");
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

            expectUnread(owner, 1);

            mvc.perform(post(Routes.Conversations.READ, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isNoContent());
            expectUnread(buyer, 0);
        }

        @Test
        @DisplayName("unread-count excludes muted threads, and read clears message notifications")
        void unreadCountExcludesMutedAndReadClearsNotification() throws Exception {
            User owner = user("9830000171", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000172", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);
            String id = id(start(buyer, owner, p, 201));

            mvc.perform(get(Routes.Conversations.UNREAD_COUNT)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(jsonPath("$.count").value(1));

            mvc.perform(patch(Routes.Conversations.STATE, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"muted\":true,\"archived\":true}"))
                    .andExpect(status().isNoContent());
            mvc.perform(get(Routes.Conversations.UNREAD_COUNT)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(jsonPath("$.count").value(0));

            mvc.perform(post(Routes.Conversations.READ, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isNoContent());
            assertThat((Boolean) jdbc.queryForList(
                    "select read from notifications where user_id = ?", owner.getId())
                    .getFirst().get("read")).isTrue();
        }

        @Test
        @DisplayName("state patch accepts one field on create and update")
        void statePatchAcceptsSingleField() throws Exception {
            User owner = user("9830000190", Roles.Wire.OWNER, "Owner");
            User otherOwner = user("9830000191", Roles.Wire.OWNER, "Other");
            User buyer = user("9830000192", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            Property other = listing(otherOwner);
            approve(buyer, p);
            approve(buyer, other);
            String id = id(start(buyer, owner, p, 201));
            String otherId = id(start(buyer, otherOwner, other, 201));

            mvc.perform(patch(Routes.Conversations.STATE, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"archived\":true}"))
                    .andExpect(status().isNoContent());
            // ADR-019: approval reveals the *owner's* number to the buyer who asked, never the
            // buyer's number to the owner. Being in one thread is not a mutual reveal.
            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(jsonPath("$.archived").value(true))
                    .andExpect(jsonPath("$.muted").value(false));
            mvc.perform(patch(Routes.Conversations.STATE, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"muted\":true}"))
                    .andExpect(status().isNoContent());
            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(jsonPath("$.archived").value(true))
                    .andExpect(jsonPath("$.muted").value(true));

            mvc.perform(patch(Routes.Conversations.STATE, otherId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"muted\":true}"))
                    .andExpect(status().isNoContent());
            mvc.perform(get(Routes.Conversations.BY_ID, otherId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(jsonPath("$.archived").value(false))
                    .andExpect(jsonPath("$.muted").value(true));
            mvc.perform(patch(Routes.Conversations.STATE, otherId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"archived\":true}"))
                    .andExpect(status().isNoContent());
            mvc.perform(get(Routes.Conversations.BY_ID, otherId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(jsonPath("$.archived").value(true))
                    .andExpect(jsonPath("$.muted").value(true));
        }

        @Test
        @DisplayName("clientId makes replies idempotent and replyTo must be in the same thread")
        void clientIdAndReplyTo() throws Exception {
            User owner = user("9830000173", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000174", Roles.Wire.BUYER, "Buyer");
            User otherOwner = user("9830000175", Roles.Wire.OWNER, "Other");
            Property p = listing(owner);
            Property other = listing(otherOwner);
            approve(buyer, p);
            approve(buyer, other);
            String id = id(start(buyer, owner, p, 201));
            String otherId = id(start(buyer, otherOwner, other, 201));
            String parent = firstMessageId(id, buyer);
            String foreign = firstMessageId(otherId, buyer);

            mvc.perform(post(Routes.Conversations.REPLY, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"body\":\"replying\",\"clientId\":\"c1\",\"replyToId\":\"" + parent + "\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.clientId").value("c1"))
                    .andExpect(jsonPath("$.replyTo.id").value(parent));
            mvc.perform(post(Routes.Conversations.REPLY, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"body\":\"replying twice\",\"clientId\":\"c1\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.body").value("replying"));
            mvc.perform(post(Routes.Conversations.REPLY, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"body\":\"bad\",\"replyToId\":\"" + foreign + "\"}"))
                    .andExpect(status().isBadRequest());
        }

        @Test
        @DisplayName("delete-for-me hides only that viewer's copy")
        void deleteForMe() throws Exception {
            User owner = user("9830000176", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000177", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);
            String id = id(start(buyer, owner, p, 201));
            String message = firstMessageId(id, buyer);

            mvc.perform(delete(Routes.Conversations.ITEM, id, message)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isNoContent());
            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(jsonPath("$.messages", hasSize(0)));
            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(jsonPath("$.messages", hasSize(1)));
        }

        @Test
        @DisplayName("block stops replies until unblocked")
        void blockStopsReplies() throws Exception {
            User owner = user("9830000178", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000179", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);
            String id = id(start(buyer, owner, p, 201));

            mvc.perform(post(Routes.Conversations.BLOCK, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isNoContent());
            reply(buyer, id, "blocked", 403);
            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(jsonPath("$.blocked").value(true));
            mvc.perform(delete(Routes.Conversations.BLOCK, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isNoContent());
            reply(buyer, id, "works", 201);
        }

        @Test
        @DisplayName("first-contact spam is rate-limited before the counterparty replies")
        void firstContactRateLimit() throws Exception {
            User owner = user("9830000180", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000181", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);
            String id = id(start(buyer, owner, p, 201));

            for (int i = 0; i < 19; i++) {
                reply(buyer, id, "ping " + i, 201);
            }
            reply(buyer, id, "one too many", 429);
        }

        @Test
        @DisplayName("notification previews mask phones, email and links")
        void notificationPreviewMasksPersonalData() throws Exception {
            User owner = user("9830000182", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000183", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);

            mvc.perform(post(Routes.Conversations.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body(owner.getMobile(), p.getId().toString(),
                                    "call 09876543210, 98765.43210, +91 98765 43210, 9876543210 or a@b.com https://x.test/a")))
                    .andExpect(status().isCreated());

            String body = (String) notificationsFor(owner).getFirst().get("body");
            assertThat(body).contains("98XXXXX210", "[email]", "[link]")
                    .doesNotContain("09876543210")
                    .doesNotContain("98765.43210")
                    .doesNotContain("+91 98765 43210")
                    .doesNotContain("9876543210")
                    .doesNotContain("a@b.com")
                    .doesNotContain("https://x.test");
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
        @DisplayName("the approved buyer sees the owner's number, and the owner sees the buyer")
        void asymmetry() throws Exception {
            User owner = user("9830000151", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000152", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);
            String id = id(start(buyer, owner, p, 201));

            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(jsonPath("$.counterpartyMobile").value("9830000151"));
            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(jsonPath("$.counterpartyMobile").value("9830000152"));
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

        @Test
        @DisplayName("message bodies from a hidden counterparty are masked, including reply previews")
        void hiddenCounterpartyBodiesAreMasked() throws Exception {
            User owner = user("9830000193", Roles.Wire.OWNER, "Owner");
            owner.setHideNumber(true);
            users.saveAndFlush(owner);
            User buyer = user("9830000194", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);
            String id = id(start(buyer, owner, p, 201));
            String ownerMessage = id(mvc.perform(post(Routes.Conversations.REPLY, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"body\":\"owner says 09876543210 owner@example.com https://x.test/a\"}"))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString());

            mvc.perform(post(Routes.Conversations.REPLY, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"body\":\"my number stays raw 9876543210 me@example.com\","
                                    + "\"replyToId\":\"" + ownerMessage + "\"}"))
                    .andExpect(status().isCreated());
            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(jsonPath("$.messages[1].body")
                            .value("owner says 98XXXXX210 [email] https://x.test/a"))
                    .andExpect(jsonPath("$.messages[2].body")
                            .value("my number stays raw 9876543210 me@example.com"))
                    .andExpect(jsonPath("$.messages[2].replyTo.body")
                            .value("owner says 98XXXXX210 [email] https://x.test/a"));
        }

        @Test
        @DisplayName("revealed counterparties see raw message bodies and reply previews")
        void revealedCounterpartyBodiesStayRaw() throws Exception {
            User owner = user("9830000195", Roles.Wire.OWNER, "Owner");
            User buyer = user("9830000196", Roles.Wire.BUYER, "Buyer");
            Property p = listing(owner);
            approve(buyer, p);
            String id = id(start(buyer, owner, p, 201));
            String ownerText = "owner says 09876543210 owner@example.com https://x.test/a";
            String ownerMessage = id(mvc.perform(post(Routes.Conversations.REPLY, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"body\":\"" + ownerText + "\"}"))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString());

            mvc.perform(post(Routes.Conversations.REPLY, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"body\":\"ack\",\"replyToId\":\"" + ownerMessage + "\"}"))
                    .andExpect(status().isCreated());
            mvc.perform(get(Routes.Conversations.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(jsonPath("$.messages[1].body").value(ownerText))
                    .andExpect(jsonPath("$.messages[2].replyTo.body").value(ownerText));
        }
    }

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

    private String firstMessageId(String id, User caller) throws Exception {
        String json = mvc.perform(get(Routes.Conversations.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return json.replaceAll("(?s)^.*?\"messages\":\\[\\{\"id\":\"([^\"]+)\".*$", "$1");
    }

    private java.util.List<java.util.Map<String, Object>> notificationsFor(User user) {
        return jdbc.queryForList(
                "select type, title, body, link from notifications where user_id = ?", user.getId());
    }

    private static String body(String mobile, String propertyId, String text) {
        return "{\"counterpartyMobile\":\"" + mobile + "\""
                + (propertyId == null ? "" : ",\"propertyId\":\"" + propertyId + "\"")
                + ",\"body\":\"" + text + "\"}";
    }

    private static String byListing(Property property, String text) {
        return "{\"propertyId\":\"" + property.getId() + "\",\"body\":\"" + text + "\"}";
    }

    private static String id(String json) {
        return json.replaceAll("(?s)^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    private static String strip(String json) {
        return json.replaceAll("\"(timestamp|correlationId|traceId|path)\":\"[^\"]*\"", "");
    }
}
