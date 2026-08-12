package com.punenest.api.common.attachment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
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
import com.punenest.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;

/**
 * D49 — {@code MessageCreate.attachments} used to parse and vanish. This asserts it now does
 * something, on both of the surfaces that accept a {@code MessageCreate}: the chat thread and the
 * support ticket. (The third message record, on service requests, takes a {@code MessageRequest} and
 * was never in scope.)
 *
 * <p>Attachments arrive in two steps — upload, then reference the returned id on the reply — so the
 * tests are grouped by the three things that can go wrong with that shape:
 *
 * <ol>
 *   <li><strong>The upload is a write endpoint that takes bytes</strong>, so its limits are not
 *       cosmetic: an uncapped count or size on a route any authenticated user can reach is a
 *       denial-of-service surface, and a declared content type that nobody checks against the
 *       actual bytes is a stored-file type confusion.</li>
 *   <li><strong>An id is a bearer token for bytes</strong> between the two steps. If one thread's
 *       pending upload can be claimed from another thread, or by the counterparty, the two-step
 *       shape has quietly become a way to post files into conversations you are not in.</li>
 *   <li><strong>Reading an attachment must be exactly as hard as reading its message.</strong> That
 *       is the invariant the row asks for, and the round-trip tests are what hold it.</li>
 * </ol>
 */
@DisplayName("D49 — message attachments are real, on both message surfaces")
class MessageAttachmentEndpointsTest extends AbstractApiTest {

    /** A minimal but genuine PNG header — long enough for the 12-byte sniff window. */
    private static final byte[] PNG = {
        (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 'I', 'H', 'D', 'R'
    };

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    ContactRequestRepository contactRequests;

    @Nested
    @DisplayName("the upload endpoint's limits")
    class Limits {

        @Test
        @DisplayName("a genuine image is stored, and comes back with a signed URL")
        void happyPath() throws Exception {
            Chat c = chat("9850000101", "9850000102");

            mvc.perform(multipart(Routes.Conversations.ATTACHMENTS, c.id)
                            .file(png("floorplan.png"))
                            .header(HttpHeaders.AUTHORIZATION, bearer(c.buyer)))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.fileName").value("floorplan.png"))
                    .andExpect(jsonPath("$.contentType").value(MediaType.IMAGE_PNG_VALUE))
                    .andExpect(jsonPath("$.sizeBytes").value(PNG.length))
                    .andExpect(jsonPath("$.url").isNotEmpty());
        }

        /**
         * The declared type is a claim by the client, so it is checked against the bytes. Accepting
         * "this .png is really a PDF" would let a caller choose the type the platform later serves
         * it back as, which is how a stored file becomes a stored script.
         */
        @Test
        @DisplayName("bytes that disagree with the declared content type are refused")
        void forgedTypeRefused() throws Exception {
            Chat c = chat("9850000103", "9850000104");
            MockMultipartFile lying = new MockMultipartFile("file", "notreally.png",
                    MediaType.IMAGE_PNG_VALUE, "%PDF-1.7 and then some".getBytes(StandardCharsets.UTF_8));

            mvc.perform(multipart(Routes.Conversations.ATTACHMENTS, c.id)
                            .file(lying)
                            .header(HttpHeaders.AUTHORIZATION, bearer(c.buyer)))
                    .andExpect(status().isUnsupportedMediaType());
        }

        @Test
        @DisplayName("a type outside the allow-list is refused even when the bytes are honest")
        void unknownTypeRefused() throws Exception {
            Chat c = chat("9850000105", "9850000106");
            MockMultipartFile zip = new MockMultipartFile("file", "payload.zip",
                    "application/zip", new byte[] {'P', 'K', 3, 4, 0, 0, 0, 0, 0, 0, 0, 0});

            mvc.perform(multipart(Routes.Conversations.ATTACHMENTS, c.id)
                            .file(zip)
                            .header(HttpHeaders.AUTHORIZATION, bearer(c.buyer)))
                    .andExpect(status().isUnsupportedMediaType());
        }

        @Test
        @DisplayName("a file over the per-file ceiling is refused")
        void oversizeRefused() throws Exception {
            Chat c = chat("9850000107", "9850000108");
            byte[] big = new byte[(int) MessageAttachmentUploads.MAX_BYTES + 1];
            System.arraycopy(PNG, 0, big, 0, PNG.length);
            MockMultipartFile huge =
                    new MockMultipartFile("file", "huge.png", MediaType.IMAGE_PNG_VALUE, big);

            mvc.perform(multipart(Routes.Conversations.ATTACHMENTS, c.id)
                            .file(huge)
                            .header(HttpHeaders.AUTHORIZATION, bearer(c.buyer)))
                    .andExpect(status().isPayloadTooLarge());
        }

        @Test
        @DisplayName("an empty part is a 400 rather than a zero-byte attachment")
        void emptyRefused() throws Exception {
            Chat c = chat("9850000109", "9850000110");
            MockMultipartFile nothing = new MockMultipartFile("file", "empty.png",
                    MediaType.IMAGE_PNG_VALUE, new byte[0]);

            mvc.perform(multipart(Routes.Conversations.ATTACHMENTS, c.id)
                            .file(nothing)
                            .header(HttpHeaders.AUTHORIZATION, bearer(c.buyer)))
                    .andExpect(status().isBadRequest());
        }

        /**
         * Uploads that are never referenced by a message are invisible but not free — they are bytes
         * in storage and rows in a table, written by anyone with a thread. The pending cap is what
         * stops one thread being used as unmetered storage.
         */
        @Test
        @DisplayName("unsent uploads on one thread are capped")
        void pendingCapped() throws Exception {
            Chat c = chat("9850000111", "9850000112");
            for (int i = 0; i < MessageAttachmentUploads.MAX_PENDING_PER_THREAD; i++) {
                mvc.perform(multipart(Routes.Conversations.ATTACHMENTS, c.id)
                                .file(png("ok" + i + ".png"))
                                .header(HttpHeaders.AUTHORIZATION, bearer(c.buyer)))
                        .andExpect(status().isCreated());
            }

            mvc.perform(multipart(Routes.Conversations.ATTACHMENTS, c.id)
                            .file(png("one-too-many.png"))
                            .header(HttpHeaders.AUTHORIZATION, bearer(c.buyer)))
                    .andExpect(status().isBadRequest());
        }

        @Test
        @DisplayName("more attachment ids than the cap on one message is refused at the boundary")
        void tooManyOnOneMessage() throws Exception {
            Chat c = chat("9850000113", "9850000114");
            String[] ids = new String[MessageAttachmentUploads.MAX_PER_MESSAGE + 1];
            for (int i = 0; i < ids.length; i++) {
                ids[i] = upload(c.buyer, c.id, "f" + i + ".png");
            }

            reply(c.buyer, c.id, "here you go", ids).andExpect(status().is4xxClientError());
        }
    }

    @Nested
    @DisplayName("an attachment id is not a bearer token for other people's threads")
    class Claiming {

        @Test
        @DisplayName("a stranger cannot upload to a thread they are not in — and gets 404, not 403")
        void strangerCannotUpload() throws Exception {
            Chat c = chat("9850000115", "9850000116");
            User stranger = user("9850000117", Roles.Wire.BUYER, "Stranger");

            mvc.perform(multipart(Routes.Conversations.ATTACHMENTS, c.id)
                            .file(png("nosy.png"))
                            .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                    .andExpect(status().isNotFound());
        }

        /**
         * Both parties are legitimately on this thread, so the guard that refuses this one is the
         * uploader check rather than the participant check. Without it, either side could attach a
         * file to the other side's name.
         */
        @Test
        @DisplayName("the counterparty cannot send someone else's pending upload")
        void counterpartyCannotClaim() throws Exception {
            Chat c = chat("9850000118", "9850000119");
            String mine = upload(c.buyer, c.id, "mine.png");

            reply(c.owner, c.id, "not mine to send", mine).andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("an id from another thread cannot be sent on this one")
        void crossThreadClaimRefused() throws Exception {
            Chat one = chat("9850000120", "9850000121");
            Chat two = chat("9850000122", "9850000123");
            String elsewhere = upload(one.buyer, one.id, "elsewhere.png");

            reply(two.buyer, two.id, "smuggled", elsewhere).andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("an id that has already been sent cannot be sent again")
        void reuseRefused() throws Exception {
            Chat c = chat("9850000124", "9850000125");
            String once = upload(c.buyer, c.id, "once.png");
            reply(c.buyer, c.id, "first", once).andExpect(status().isCreated());

            reply(c.buyer, c.id, "again", once).andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("the same id twice in one message is refused — the first use consumes it")
        void duplicateInOneMessageRefused() throws Exception {
            Chat c = chat("9850000126", "9850000127");
            String once = upload(c.buyer, c.id, "dup.png");

            reply(c.buyer, c.id, "twice", once, once).andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("an id that is not a uuid at all is a 404, like any other unknown id")
        void garbageIdRefused() throws Exception {
            Chat c = chat("9850000128", "9850000129");

            reply(c.buyer, c.id, "nonsense", "../../etc/passwd").andExpect(status().isNotFound());
        }
    }

    @Nested
    @DisplayName("reading an attachment is exactly as hard as reading its message")
    class Visibility {

        @Test
        @DisplayName("chat: upload, send, and both participants see it on the thread")
        void chatRoundTrip() throws Exception {
            Chat c = chat("9850000130", "9850000131");
            String id = upload(c.buyer, c.id, "plan.png");
            reply(c.buyer, c.id, "see attached", id)
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.attachments", hasSize(1)))
                    .andExpect(jsonPath("$.attachments[0].fileName").value("plan.png"));

            for (User reader : new User[] {c.buyer, c.owner}) {
                mvc.perform(get(Routes.Conversations.BY_ID, c.id)
                                .header(HttpHeaders.AUTHORIZATION, bearer(reader)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.messages[1].attachments", hasSize(1)))
                        .andExpect(jsonPath("$.messages[1].attachments[0].url").isNotEmpty());
            }
        }

        @Test
        @DisplayName("a message with no attachments carries an empty array, never a null")
        void plainMessageHasEmptyArray() throws Exception {
            Chat c = chat("9850000132", "9850000133");

            mvc.perform(get(Routes.Conversations.BY_ID, c.id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(c.buyer)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.messages[0].attachments", hasSize(0)));
        }

        /**
         * The load-bearing half of the invariant. The attachment lives on a thread the stranger
         * cannot read, so the stranger must not be able to reach it by any of the routes that return
         * messages — and the refusal is the thread's own 404, unchanged by this feature.
         */
        @Test
        @DisplayName("a stranger cannot read the thread, so cannot reach its attachments")
        void strangerSeesNothing() throws Exception {
            Chat c = chat("9850000134", "9850000135");
            String id = upload(c.buyer, c.id, "private.png");
            reply(c.buyer, c.id, "see attached", id).andExpect(status().isCreated());
            User stranger = user("9850000136", Roles.Wire.BUYER, "Stranger Two");

            mvc.perform(get(Routes.Conversations.BY_ID, c.id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                    .andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("support: a customer attaches, and the desk sees it on the ticket")
        void supportRoundTrip() throws Exception {
            User customer = user("9850000137", Roles.Wire.BUYER, "Customer");
            User desk = user("9850000138", Roles.Wire.STAFF, "Desk", Teams.LEGAL);
            String ticket = raiseTicket(customer);

            String id = mvc.perform(multipart(Routes.SupportTickets.ATTACHMENTS, ticket)
                            .file(png("receipt.png"))
                            .header(HttpHeaders.AUTHORIZATION, bearer(customer)))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString()
                    .replaceAll("(?s)^.*?\"id\":\"([^\"]+)\".*$", "$1");

            mvc.perform(post(Routes.SupportTickets.MESSAGES, ticket)
                            .header(HttpHeaders.AUTHORIZATION, bearer(customer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"body\":\"proof of payment\",\"attachments\":[\"" + id + "\"]}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.attachments", hasSize(1)));

            mvc.perform(get(Routes.SupportTickets.BY_ID, ticket)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.messages[1].attachments[0].fileName").value("receipt.png"));
        }

        @Test
        @DisplayName("support: another customer cannot upload to a ticket they did not raise")
        void supportStrangerRefused() throws Exception {
            User customer = user("9850000139", Roles.Wire.BUYER, "Customer Two");
            User other = user("9850000140", Roles.Wire.BUYER, "Other");
            String ticket = raiseTicket(customer);

            mvc.perform(multipart(Routes.SupportTickets.ATTACHMENTS, ticket)
                            .file(png("nosy.png"))
                            .header(HttpHeaders.AUTHORIZATION, bearer(other)))
                    .andExpect(status().isNotFound());
        }
    }

    // --- fixtures -------------------------------------------------------------------------

    private record Chat(User owner, User buyer, String id) {
    }

    private static MockMultipartFile png(String name) {
        return new MockMultipartFile("file", name, MediaType.IMAGE_PNG_VALUE, PNG);
    }

    private String upload(User caller, String threadId, String name) throws Exception {
        return mvc.perform(multipart(Routes.Conversations.ATTACHMENTS, threadId)
                        .file(png(name))
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()
                .replaceAll("(?s)^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    private org.springframework.test.web.servlet.ResultActions reply(
            User caller, String threadId, String text, String... attachmentIds) throws Exception {
        String ids = Arrays.stream(attachmentIds)
                .map(a -> "\"" + a + "\"")
                .reduce((a, b) -> a + "," + b)
                .orElse("");
        return mvc.perform(post(Routes.Conversations.REPLY, threadId)
                .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"" + text + "\",\"attachments\":[" + ids + "]}"));
    }

    private String raiseTicket(User caller) throws Exception {
        return mvc.perform(post(Routes.SupportTickets.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\":\"Refund\",\"category\":\"billing\","
                                + "\"body\":\"Please help\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()
                .replaceAll("(?s)^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    private Chat chat(String ownerMobile, String buyerMobile) throws Exception {
        User owner = user(ownerMobile, Roles.Wire.OWNER, "Owner");
        User buyer = user(buyerMobile, Roles.Wire.BUYER, "Buyer");
        Property p = listing(owner);
        ContactRequest cr = new ContactRequest(p.getId(), buyer.getId(), "interested");
        cr.setStatus(ContactRequestStatuses.APPROVED);
        contactRequests.saveAndFlush(cr);

        String id = mvc.perform(post(Routes.Conversations.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"counterpartyMobile\":\"" + owner.getMobile() + "\","
                                + "\"propertyId\":\"" + p.getId() + "\","
                                + "\"body\":\"is it still available\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()
                .replaceAll("(?s)^.*?\"id\":\"([^\"]+)\".*$", "$1");
        return new Chat(owner, buyer, id);
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
}
