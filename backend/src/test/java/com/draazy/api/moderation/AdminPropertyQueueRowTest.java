package com.draazy.api.moderation;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.moderation.verification.PropertyReview;
import com.draazy.api.moderation.verification.PropertyReviewRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

@DisplayName("Moderation — the queue row is slim, the full record is one read away")
class AdminPropertyQueueRowTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    PropertyReviewRepository reviews;

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        jdbc.update("delete from audit_log where entity = 'property'");
    }

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Row " + mobile);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        if ("staff".equals(role)) {
            jdbc.update("""
                    INSERT INTO back_office_permissions (user_id, permissions)
                    VALUES (?::uuid, ?::jsonb)
                    ON CONFLICT (user_id) DO UPDATE SET permissions = EXCLUDED.permissions
                    """, saved.getId().toString(),
                    "[\"kyc\",\"propertyVerification\",\"listingModeration\",\"support\",\"content\",\"reports\",\"desk:rental\"]");
        }
        return saved;
    }

    private Property listing(User owner, String title, String status) {
        Property p = new Property(owner, title, "rent", "apartment", 28000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("950"));
        p.setStatus(status);
        p.setLocalitySlug("baner");
        p.setSlug("flat-" + title.toLowerCase().replace(' ', '-') + "-baner");
        p.setAddress("Flat 12, Sunrise Heights, Baner Road");
        p.setElectricityMeterNo("MSEB-445566");
        p.setDescription("A bright two bedroom flat close to the market with a covered parking slot.");
        p.setAmenities(List.of("lift", "parking", "gym"));
        p.setImages(List.of("https://example.test/a.jpg", "https://example.test/b.jpg"));
        p.setFormDetails(java.util.Map.of("bestTimeToCall", "evening"));
        return properties.saveAndFlush(p);
    }

    @Test
    @DisplayName("a queue row carries what the table reads and none of the form, address or meter")
    void rowIsSlim() throws Exception {
        User owner = user("9851000001", "owner");
        User staff = user("9851000002", "staff");
        listing(owner, "Slim flat", PropertyStatus.PENDING);

        mvc.perform(get("/admin/properties").header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].title").value("Slim flat"))
                .andExpect(jsonPath("$.content[0].status").value(PropertyStatus.PENDING))
                .andExpect(jsonPath("$.content[0].owner.name").value("Row 9851000001"))
                .andExpect(jsonPath("$.content[0].owner.mobile").value("9851000001"))
                .andExpect(jsonPath("$.content[0].progress.track").exists())
                .andExpect(jsonPath("$.content[0].signals.items").isArray())
                .andExpect(jsonPath("$.content[0].ownerReplied").value(false))
                .andExpect(jsonPath("$.content[0].photoCount").value(2))
                .andExpect(jsonPath("$.content[0].descLength").value(
                        "A bright two bedroom flat close to the market with a covered parking slot.".length()))
                .andExpect(jsonPath("$.content[0].amenityCount").value(3))
                .andExpect(jsonPath("$.content[0].coverImage").value("https://example.test/a.jpg"))
                .andExpect(jsonPath("$.content[0].address").doesNotExist())
                .andExpect(jsonPath("$.content[0].electricityMeterNo").doesNotExist())
                .andExpect(jsonPath("$.content[0].formDetails").doesNotExist())
                .andExpect(jsonPath("$.content[0].description").doesNotExist())
                .andExpect(jsonPath("$.content[0].amenities").doesNotExist())
                .andExpect(jsonPath("$.content[0].images").doesNotExist())
                .andExpect(jsonPath("$.content[0].commercial").doesNotExist())
                .andExpect(jsonPath("$.content[0].land").doesNotExist())
                .andExpect(jsonPath("$.content[0].societyName").doesNotExist())
                .andExpect(jsonPath("$.content[0].flagReason").doesNotExist())
                .andExpect(jsonPath("$.content[0].lat").doesNotExist());
    }

    @Test
    @DisplayName("the detail read is the whole listing, by id or slug, archived included")
    void detailIsTheWholeListing() throws Exception {
        User owner = user("9851000003", "owner");
        User staff = user("9851000004", "staff");
        Property p = listing(owner, "Whole flat", PropertyStatus.APPROVED);
        p.archive("owner withdrew");
        properties.saveAndFlush(p);

        mvc.perform(get("/admin/properties/" + p.getId()).header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(p.getId().toString()))
                .andExpect(jsonPath("$.address").value("Flat 12, Sunrise Heights, Baner Road"))
                .andExpect(jsonPath("$.electricityMeterNo").value("MSEB-445566"))
                .andExpect(jsonPath("$.owner.mobile").value("9851000003"))
                .andExpect(jsonPath("$.archived").value(true))
                .andExpect(jsonPath("$.signals.items").isArray())
                .andExpect(jsonPath("$.ownerReplied").value(false));

        mvc.perform(get("/admin/properties/" + p.getSlug()).header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(p.getId().toString()));
    }

    @Test
    @DisplayName("the detail read is closed to seekers and anonymous callers, and 404s for a stranger id")
    void detailIsGuarded() throws Exception {
        User owner = user("9851000005", "owner");
        User staff = user("9851000006", "staff");
        User seeker = user("9851000007", "buyer");
        Property p = listing(owner, "Guarded flat", PropertyStatus.PENDING);

        mvc.perform(get("/admin/properties/" + p.getId())).andExpect(status().isUnauthorized());
        mvc.perform(get("/admin/properties/" + p.getId()).header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                .andExpect(status().isForbidden());
        mvc.perform(get("/admin/properties/" + java.util.UUID.randomUUID())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isNotFound());
        mvc.perform(get("/admin/properties/no-such-slug").header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("opening the case marks the owner's messages read only when asked, so opening the modal is one write")
    void openMarksReadOnlyOnRequest() throws Exception {
        User owner = user("9851000008", "owner");
        User staff = user("9851000009", "staff");
        Property p = listing(owner, "Chatty flat", PropertyStatus.PENDING);
        PropertyReview review = new PropertyReview(p.getId());
        review.addMessage(owner.getId(), "Here are my documents");
        reviews.saveAndFlush(review);

        mvc.perform(post("/properties/" + p.getId() + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.messages[0].read").value(false));

        mvc.perform(post("/properties/" + p.getId() + "/verification")
                        .param("markRead", "true")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.messages[0].read").value(true));
    }
}
