package com.draazy.api.catalog.listing;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.photo.PhotoKeys;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

@DisplayName("Listings — a photo is one we stored, never a link to somewhere else")
class ListingPhotoSourcesTest extends AbstractApiTest {

    private static final String OURS = "/api/dev/storage/public/photos/";

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    PhotoKeys keys;

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Photo Source Owner");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private static String upload(User owner, String hashSuffix) {
        return OURS + owner.getId() + "/" + UUID.randomUUID() + hashSuffix;
    }

    private ResultActions create(User owner, String photosJson) throws Exception {
        return mvc.perform(post("/me/listings").header(HttpHeaders.AUTHORIZATION, bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"title":"2BHK in Baner","deal":"rent","propertyType":"apartment","price":28000,
                         "bhk":2,"locality":"Baner","city":"Pune","floor":3,%s}
                        """.formatted(photosJson)));
    }

    @Test
    @DisplayName("an uploaded photo, hashed or not, is accepted")
    void anUploadIsAccepted() throws Exception {
        User o = owner("9861500001");
        create(o, "\"images\":[\"%s\",\"%s\"],\"floorPlan\":\"%s\""
                .formatted(upload(o, "-ffff0000ffff0000"), upload(o, ""), upload(o, "")))
                .andExpect(status().isCreated());
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "https://images.unsplash.com/photo-1.jpg",
        "https://evil.example/api/dev/storage/public/photos/a/7c9e6679-7425-40de-944b-e07fc1f90ae7",
        OURS + "a/7c9e6679-7425-40de-944b-e07fc1f90ae7-ffff0000ffff0000?1",
        OURS + "a/7c9e6679-7425-40de-944b-e07fc1f90ae7#x",
        OURS + "a/legacy.jpg",
        OURS + "a/b/7c9e6679-7425-40de-944b-e07fc1f90ae7",
    })
    @DisplayName("a photo linked from anywhere else, or dressed to dodge its hash, is refused")
    void anythingElseIsRefused(String url) throws Exception {
        create(owner("9861500002"), "\"images\":[\"%s\"]".formatted(url))
                .andExpect(status().isUnprocessableEntity());
        create(owner("9861500003"), "\"floorPlan\":\"%s\"".formatted(url))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    @DisplayName("an edit may keep a photo the listing already had, but may not add a foreign one")
    void anEditKeepsWhatItHadButAddsOnlyUploads() throws Exception {
        User o = owner("9861500004");
        String legacy = "https://images.unsplash.com/photo-legacy.jpg";
        Property p = new Property(o, "Bright 2BHK", "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setStatus(PropertyStatus.APPROVED);
        p.setLocalitySlug("kothrud");
        p.setImages(List.of(legacy));
        properties.saveAndFlush(p);

        edit(o, p, "{\"images\":[\"%s\",\"%s\"]}".formatted(legacy, upload(o, "")))
                .andExpect(status().isOk());
        edit(o, p, "{\"images\":[\"%s\",\"https://images.unsplash.com/photo-new.jpg\"]}".formatted(legacy))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    @DisplayName("an owner may not attach another owner's Draazy upload")
    void anotherOwnersUploadIsRefused() throws Exception {
        User o = owner("9861500005");
        User other = owner("9861500006");

        create(o, "\"images\":[\"%s\"]".formatted(upload(other, "")))
                .andExpect(status().isUnprocessableEntity());
        create(o, "\"images\":[\"%s\"]".formatted(OURS.replace("photos/", "") + keys.newKey(other.getId())))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    @DisplayName("a tagged upload, which names no user, is accepted from its uploader")
    void aTaggedUploadIsAccepted() throws Exception {
        User o = owner("9861500008");
        create(o, "\"images\":[\"%s\"]".formatted(OURS.replace("photos/", "") + keys.newKey(o.getId()) + "-ffff0000ffff0000"))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("an owner create without photos is a field error")
    void ownerCreateWithoutPhotosIsFieldError() throws Exception {
        create(owner("9861500007"), "\"images\":[]")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value("images"));
    }

    private ResultActions edit(User o, Property p, String body) throws Exception {
        return mvc.perform(patch("/me/listings/" + p.getId()).header(HttpHeaders.AUTHORIZATION, bearer(o))
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }
}
