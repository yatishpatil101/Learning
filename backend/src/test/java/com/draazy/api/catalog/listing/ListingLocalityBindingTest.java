package com.draazy.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

@DisplayName("Listing writes bind to a live locality the user picked")
class ListingLocalityBindingTest extends AbstractApiTest {

    private static final String PICK = "Pick the locality from the suggestions.";

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;

    private User owner() {
        User u = new User("9862000001", "owner");
        u.setName("Binding Owner");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private void locality(String slug, String name, boolean archived) {
        jdbc.update("insert into localities (slug, name, city, lat, lng, place_id, active, archived_at) "
                + "values (?, ?, 'Pune', 18.5, 73.8, ?, ?, " + (archived ? "now()" : "null") + ")",
                slug, name, "p-" + slug, !archived);
    }

    private ResultActions create(User o, String locality, String localitySlug) throws Exception {
        String slugField = localitySlug == null ? "" : ",\"localitySlug\":\"" + localitySlug + "\"";
        return mvc.perform(post("/me/listings")
                .header(HttpHeaders.AUTHORIZATION, bearer(o))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"title":"Bound flat","deal":"rent","propertyType":"apartment","price":31000,"bhk":2,
                         "locality":"%s","city":"Pune"%s,"images":["/api/dev/storage/public/photos/%s/%s"]}
                        """.formatted(locality, slugField, o.getId(), UUID.randomUUID())));
    }

    private Property approved(User o, String localityName, String slug) {
        Property p = new Property(o, "Existing flat", "rent", "apartment", 25000L, localityName, "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setStatus(PropertyStatus.APPROVED);
        p.setFurnishing("unfurnished");
        p.setPossession("under-construction");
        p.setLocalitySlug(slug);
        return properties.saveAndFlush(p);
    }

    @Test
    void aTypedNameIsStoredAsTheCanonicalLiveLocality() throws Exception {
        locality("zzlw-live", "Zzlw Live", false);

        User o = owner();
        String created = create(o, "zzlw live", null)
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        storedListing(o, com.jayway.jsonpath.JsonPath.read(created, "$.id"))
                .andExpect(jsonPath("$.locality").value("Zzlw Live"))
                .andExpect(jsonPath("$.localitySlug").value("zzlw-live"));
    }

    @Test
    void anUnknownTypedNameIsRefused() throws Exception {
        create(owner(), "Nowhere At All", null)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value(PICK));
    }

    @Test
    void aPickedSlugWinsOverTheTypedName() throws Exception {
        locality("zzlw-picked", "Zzlw Picked", false);

        User o = owner();
        String created = create(o, "whatever", "zzlw-picked")
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        storedListing(o, com.jayway.jsonpath.JsonPath.read(created, "$.id"))
                .andExpect(jsonPath("$.localitySlug").value("zzlw-picked"))
                .andExpect(jsonPath("$.locality").value("Zzlw Picked"));
    }

    @Test
    void theSlugOfAnArchivedLocalityIsRefused() throws Exception {
        locality("zzlw-gone", "Zzlw Gone", true);

        create(owner(), "Zzlw Gone", "zzlw-gone")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value(PICK));
    }

    @Test
    void anEditThatDoesNotTouchTheLocalityKeepsAnArchivedBinding() throws Exception {
        locality("zzlw-old", "Zzlw Old", true);
        User o = owner();
        Property p = approved(o, "Zzlw Old", "zzlw-old");

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"description\":\"Fresh paint\",\"locality\":\"Zzlw Old\",\"localitySlug\":\"zzlw-old\"}"))
                .andExpect(status().isOk());

        assertThat(properties.findById(p.getId()).orElseThrow().getLocalitySlug()).isEqualTo("zzlw-old");
    }

    @Test
    void anEditMayMoveToAnotherLiveLocalityButNotToATypedUnknownOne() throws Exception {
        locality("zzlw-new", "Zzlw New", false);
        User o = owner();
        Property p = approved(o, "Kothrud", "kothrud");

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"localitySlug\":\"zzlw-new\"}"))
                .andExpect(status().isOk());
        assertThat(properties.findById(p.getId()).orElseThrow().getLocalitySlug()).isEqualTo("zzlw-new");

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"locality\":\"Nowhere At All\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value(PICK));
    }
}
