package com.draazy.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.support.AbstractCommittedApiTest;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

@DisplayName("Listing writes — each request commits on its own, as in production")
class CommittedListingWriteTest extends AbstractCommittedApiTest {

    @Override
    protected String mobilePrefix() {
        return "98631";
    }

    private UUID postListing(User owner, String locality) throws Exception {
        mvc.perform(post("/me/listings").header("Authorization", bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"Committed smoke flat","deal":"rent","propertyType":"apartment",
                                 "price":25000,"locality":"%s","city":"Pune","images":["/api/dev/storage/public/photos/%s/%s"]}
                                """.formatted(locality, owner.getId(), UUID.randomUUID())))
                .andExpect(status().isCreated());
        return jdbc.queryForObject("select id from properties where owner_id = ?", UUID.class, owner.getId());
    }

    @Test
    @DisplayName("posting, editing and taking down a listing each reach the row, with no session to hide a dropped write")
    void everyWriteReachesTheRow() throws Exception {
        User owner = user("00001", "buyer");
        UUID id = postListing(owner, liveLocality("Committed Smoke Town"));

        assertThat(jdbc.queryForObject("select listings_count from users where id = ?", Integer.class, owner.getId()))
                .as("the owner's lifetime tally moved in the database")
                .isEqualTo(1);

        mvc.perform(patch("/me/listings/" + id).header("Authorization", bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\":26000}"))
                .andExpect(status().isOk());
        assertThat(jdbc.queryForObject("select price from properties where id = ?", Long.class, id)).isEqualTo(26000L);

        mvc.perform(delete("/me/listings/" + id).header("Authorization", bearer(owner)))
                .andExpect(status().isOk());
        assertThat(jdbc.queryForObject("select status from properties where id = ?", String.class, id))
                .isNotEqualTo("approved");
    }
}