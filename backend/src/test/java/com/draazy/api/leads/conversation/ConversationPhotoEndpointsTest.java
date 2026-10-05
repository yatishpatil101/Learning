package com.draazy.api.leads.conversation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
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
import com.draazy.api.support.AbstractApiTest;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;

class ConversationPhotoEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    ContactRequestRepository contactRequests;

    @Test
    void storesPhotoAttachmentAndStripsExif() throws Exception {
        User owner = user("9831000101", Roles.Wire.OWNER, "Owner");
        User buyer = user("9831000102", Roles.Wire.BUYER, "Buyer");
        Property property = listing(owner);
        approve(buyer, property);
        String conversationId = id(start(buyer, owner, property));

        String json = mvc.perform(multipart(Routes.Conversations.PHOTOS, conversationId)
                        .file(jpegWithExif())
                        .param("clientId", "photo-exif")
                        .param("caption", "balcony")
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.attachments", hasSize(1)))
                .andExpect(jsonPath("$.attachments[0].contentType").value("image/jpeg"))
                .andReturn().getResponse().getContentAsString();

        String messageId = id(json);
        assertThat(jdbc.queryForObject(
                "select count(*) from message_attachments where message_id = ?",
                Integer.class, UUID.fromString(messageId))).isEqualTo(1);

        byte[] stored = mvc.perform(get(mockMvcPath(field(json, "url")))
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();
        assertThat(new String(stored, StandardCharsets.ISO_8859_1)).doesNotContain("Exif", "GPS");
    }

    @Test
    void refusesNonImagesAndDamagedImages() throws Exception {
        User owner = user("9831000103", Roles.Wire.OWNER, "Owner");
        User buyer = user("9831000104", Roles.Wire.BUYER, "Buyer");
        Property property = listing(owner);
        approve(buyer, property);
        String conversationId = id(start(buyer, owner, property));

        mvc.perform(multipart(Routes.Conversations.PHOTOS, conversationId)
                        .file(new MockMultipartFile("file", "note.txt", "text/plain",
                                "not an image".getBytes(StandardCharsets.UTF_8)))
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isUnsupportedMediaType());

        mvc.perform(multipart(Routes.Conversations.PHOTOS, conversationId)
                        .file(new MockMultipartFile("file", "broken.jpg", "image/jpeg",
                                new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xD9}))
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void strangerGets404AndBlockedThreadGets403() throws Exception {
        User owner = user("9831000105", Roles.Wire.OWNER, "Owner");
        User buyer = user("9831000106", Roles.Wire.BUYER, "Buyer");
        User stranger = user("9831000107", Roles.Wire.BUYER, "Stranger");
        Property property = listing(owner);
        approve(buyer, property);
        String conversationId = id(start(buyer, owner, property));

        mvc.perform(multipart(Routes.Conversations.PHOTOS, conversationId)
                        .file(png())
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());

        mvc.perform(post(Routes.Conversations.BLOCK, conversationId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());
        mvc.perform(multipart(Routes.Conversations.PHOTOS, conversationId)
                        .file(png())
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isForbidden());
    }

    @Test
    void clientIdIsIdempotent() throws Exception {
        User owner = user("9831000108", Roles.Wire.OWNER, "Owner");
        User buyer = user("9831000109", Roles.Wire.BUYER, "Buyer");
        Property property = listing(owner);
        approve(buyer, property);
        String conversationId = id(start(buyer, owner, property));

        String first = mvc.perform(multipart(Routes.Conversations.PHOTOS, conversationId)
                        .file(png())
                        .param("clientId", "same-photo")
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String second = mvc.perform(multipart(Routes.Conversations.PHOTOS, conversationId)
                        .file(png())
                        .param("clientId", "same-photo")
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(id(second)).isEqualTo(id(first));
        assertThat(jdbc.queryForObject(
                "select count(*) from message_attachments where message_id = ?",
                Integer.class, UUID.fromString(id(first)))).isEqualTo(1);
    }

    @Test
    void captionIsMaskedForHiddenCounterparty() throws Exception {
        User owner = user("9831000110", Roles.Wire.OWNER, "Owner");
        owner.setHideNumber(true);
        users.saveAndFlush(owner);
        User buyer = user("9831000111", Roles.Wire.BUYER, "Buyer");
        Property property = listing(owner);
        approve(buyer, property);
        String conversationId = id(start(buyer, owner, property));

        mvc.perform(multipart(Routes.Conversations.PHOTOS, conversationId)
                        .file(png())
                        .param("caption", "call 09876543210 owner@example.com")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());

        mvc.perform(get(Routes.Conversations.BY_ID, conversationId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages[1].body").value("call 98XXXXX210 [email]"));
    }

    @Test
    void firstContactLimitAppliesToPhotos() throws Exception {
        User owner = user("9831000112", Roles.Wire.OWNER, "Owner");
        User buyer = user("9831000113", Roles.Wire.BUYER, "Buyer");
        Property property = listing(owner);
        approve(buyer, property);
        String conversationId = id(start(buyer, owner, property));
        for (int i = 0; i < 19; i++) {
            mvc.perform(post(Routes.Conversations.REPLY, conversationId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"body\":\"ping " + i + "\"}"))
                    .andExpect(status().isCreated());
        }

        mvc.perform(multipart(Routes.Conversations.PHOTOS, conversationId)
                        .file(png())
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    void pushSubscriptionUpsertAndDelete() throws Exception {
        User owner = user("9831000114", Roles.Wire.OWNER, "Owner");

        mvc.perform(post(Routes.Engagement.PUSH_SUBSCRIPTIONS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(pushBody("https://push.example/device-1", "k1", "a1")))
                .andExpect(status().isNoContent());
        mvc.perform(post(Routes.Engagement.PUSH_SUBSCRIPTIONS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(pushBody("https://push.example/device-1", "k2", "a2")))
                .andExpect(status().isNoContent());
        assertThat(jdbc.queryForObject(
                "select count(*) from push_subscriptions where user_id = ? and p256dh = 'k2'",
                Integer.class, owner.getId())).isEqualTo(1);

        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .delete(Routes.Engagement.PUSH_SUBSCRIPTIONS)
                        .param("endpoint", "https://push.example/device-1")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());
        assertThat(jdbc.queryForObject(
                "select count(*) from push_subscriptions where user_id = ?",
                Integer.class, owner.getId())).isZero();
    }

    private User user(String mobile, String role, String name) {
        User user = new User(mobile, role);
        user.setName(name);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private Property listing(User owner) {
        Property property = new Property(owner, "2BHK in Kothrud", "rent", "apartment", 25000L,
                "Kothrud", "Pune");
        property.setStatus("approved");
        return properties.saveAndFlush(property);
    }

    private void approve(User requester, Property property) {
        ContactRequest request = new ContactRequest(property.getId(), requester.getId(), "interested");
        request.setStatus(ContactRequestStatuses.APPROVED);
        contactRequests.saveAndFlush(request);
    }

    private String start(User caller, User counterparty, Property property) throws Exception {
        return mvc.perform(post(Routes.Conversations.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"counterpartyMobile\":\"" + counterparty.getMobile()
                                + "\",\"propertyId\":\"" + property.getId() + "\",\"body\":\"hello\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
    }

    private static MockMultipartFile png() throws Exception {
        return new MockMultipartFile("file", "room.png", "image/png", image("png"));
    }

    private static MockMultipartFile jpegWithExif() throws Exception {
        byte[] jpeg = image("jpg");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(jpeg, 0, 2);
        out.write(segment(0xE1, "Exif\0\0GPS=home".getBytes(StandardCharsets.ISO_8859_1)));
        out.write(jpeg, 2, jpeg.length - 2);
        return new MockMultipartFile("file", "room.jpg", "image/jpeg", out.toByteArray());
    }

    private static byte[] image(String format) throws Exception {
        BufferedImage image = new BufferedImage(10, 10, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(Color.BLUE);
        g.fillRect(0, 0, 10, 10);
        g.dispose();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, format, out);
        return out.toByteArray();
    }

    private static byte[] segment(int marker, byte[] payload) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(0xFF);
        out.write(marker);
        int length = payload.length + 2;
        out.write((length >>> 8) & 0xFF);
        out.write(length & 0xFF);
        out.writeBytes(payload);
        return out.toByteArray();
    }

    private static String id(String json) {
        return json.replaceAll("(?s)^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    private static String field(String json, String field) {
        return json.replaceAll("(?s)^.*\"" + field + "\":\"([^\"]+)\".*$", "$1")
                .replace("\\u0026", "&");
    }

    private static String mockMvcPath(String url) {
        return url.startsWith("/api/") ? url.substring(4) : url;
    }

    private static String pushBody(String endpoint, String p256dh, String auth) {
        return "{\"endpoint\":\"" + endpoint + "\",\"keys\":{\"p256dh\":\""
                + p256dh + "\",\"auth\":\"" + auth + "\"}}";
    }
}
