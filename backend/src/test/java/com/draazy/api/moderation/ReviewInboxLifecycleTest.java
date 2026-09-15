package com.draazy.api.moderation;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.documents.vault.Document;
import com.draazy.api.documents.vault.DocumentRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.moderation.verification.PropertyReview;
import com.draazy.api.moderation.verification.PropertyReviewRepository;
import com.draazy.api.support.AbstractApiTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ReviewInboxLifecycleTest extends AbstractApiTest {
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired PropertyReviewRepository reviews;
    @Autowired DocumentRepository documents;

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "Existing support home", "rent", "Flat", 20000L, "Baner", "Pune");
        p.setImages(java.util.List.of("https://example.test/home.jpg"));
        return properties.saveAndFlush(p);
    }

    @Test void inboxReusesExistingThreadAndExcludesInternalBodiesIdsAndUnread() throws Exception {
        User owner = user("9800011920", "owner");
        Property p = listing(owner);
        PropertyReview review = new PropertyReview(p.getId());
        review.addMessage(null, "Please confirm the address");
        review.addInternalNote("Private duplicate investigation");
        reviews.saveAndFlush(review);
        mvc.perform(get("/me/property-reviews").header("Authorization", bearer(owner)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].propertyId").value(p.getId().toString()))
                .andExpect(jsonPath("$.content[0].propertyTitle").value("Existing support home"))
                .andExpect(jsonPath("$.content[0].propertyImage").value("https://example.test/home.jpg"))
                .andExpect(jsonPath("$.content[0].lastMessage").value("Please confirm the address"))
                .andExpect(jsonPath("$.content[0].unread").value(1))
                .andExpect(jsonPath("$.content[0].lifecycleStage").value("submitted"));
        mvc.perform(get("/properties/" + p.getId() + "/verification")
                .header("Authorization", bearer(owner))).andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andExpect(jsonPath("$.messages[0].id").value(review.getMessages().getFirst().getId().toString()))
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString(
                        review.getMessages().getLast().getId().toString()))))
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("Private duplicate"))));
        mvc.perform(get("/me/property-reviews/unread-count").header("Authorization", bearer(owner)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.count").value(1));
        mvc.perform(post("/properties/" + p.getId() + "/verification/read")
                .header("Authorization", bearer(owner))).andExpect(status().isNoContent());
        mvc.perform(get("/me/property-reviews/unread-count").header("Authorization", bearer(owner)))
                .andExpect(jsonPath("$.count").value(0));
    }

    @Test void internalOnlyCaseIsInvisibleInBothOwnerReads() throws Exception {
        User owner = user("9800011921", "owner");
        Property p = listing(owner);
        PropertyReview review = new PropertyReview(p.getId());
        review.addInternalNote("Internal only");
        reviews.saveAndFlush(review);
        mvc.perform(get("/me/property-reviews").header("Authorization", bearer(owner)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/properties/" + p.getId() + "/verification")
                .header("Authorization", bearer(owner))).andExpect(status().isNotFound());
        mvc.perform(get("/me/property-reviews/unread-count").header("Authorization", bearer(owner)))
                .andExpect(jsonPath("$.count").value(0));
    }

    @Test void revokedReaderCannotFallBackToOtherOwnersConversation() throws Exception {
        User staff = user("9800011922", "staff");
        Property p = listing(user("9800011923", "owner"));
        reviews.saveAndFlush(new PropertyReview(p.getId()));
        String token = bearer(staff);
        mvc.perform(get("/properties/" + p.getId() + "/verification").header("Authorization", token))
                .andExpect(status().isOk());
        jdbc.update("insert into back_office_permissions(user_id,permissions) values (?,?::jsonb)",
                staff.getId(), "[\"properties:write\"]");
        mvc.perform(get("/properties/" + p.getId() + "/verification").header("Authorization", token))
                .andExpect(status().isNotFound());
        mvc.perform(post("/properties/" + p.getId() + "/verification/messages").header("Authorization", token)
                .contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"Hello\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/me/property-reviews/unread-count").header("Authorization", token))
                .andExpect(jsonPath("$.count").value(0));
    }

    @Test void ownerChecklistUsesActualVaultRowsNotUnmaintainedCounter() throws Exception {
        User owner = user("9800011924", "owner");
        Property p = listing(owner);
        String url = "/properties/" + p.getId() + "/verification";
        mvc.perform(post(url).header("Authorization", bearer(owner)))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.checklist.length()").value(0));
        documents.saveAndFlush(new Document(p.getId(), "Index II", "proof.pdf", "test/proof", 100, "application/pdf"));
        mvc.perform(get(url).header("Authorization", bearer(owner)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.checklist.length()").value(3));
    }

    @Test void persistedDocumentUploadAdvancesStaffTrackButNeverPublishes() throws Exception {
        User owner = user("9800011925", "owner");
        Property p = listing(owner);
        p.setImages(java.util.List.of());
        p.markPostedOnBehalf("staff-maker");
        properties.saveAndFlush(p);
        java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(2, 2,
                java.awt.image.BufferedImage.TYPE_INT_RGB), "png", bytes);
        mvc.perform(multipart("/me/documents/" + p.getId())
                .file(new org.springframework.mock.web.MockMultipartFile("file", "proof.png", "image/png",
                        bytes.toByteArray())).param("category", "Index II")
                .header("Authorization", bearer(owner))).andExpect(status().isCreated());
        properties.flush();
        org.assertj.core.api.Assertions.assertThat(jdbc.queryForObject(
                "select lifecycle_stage from properties where id=?", String.class, p.getId()))
                .isEqualTo("photos_docs");
        org.assertj.core.api.Assertions.assertThat(p.getStatus()).isEqualTo("pending");
        org.assertj.core.api.Assertions.assertThat(documents.existsByPropertyIdAndServiceRequestIdIsNull(p.getId()))
                .isTrue();
    }

    @Test void unreadAggregateIsNotLimitedToTheRequestedInboxPage() throws Exception {
        User owner = user("9800011926", "owner");
        for (int i = 0; i < 3; i++) {
            PropertyReview review = new PropertyReview(listing(owner).getId());
            review.addMessage(null, "Public reply " + i);
            review.addInternalNote("Private finding");
            reviews.saveAndFlush(review);
        }
        mvc.perform(get("/me/property-reviews?size=1").header("Authorization", bearer(owner)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(3));
        mvc.perform(get("/me/property-reviews/unread-count").header("Authorization", bearer(owner)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.count").value(3));
    }
}