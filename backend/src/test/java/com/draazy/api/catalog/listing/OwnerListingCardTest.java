package com.draazy.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.leads.contact.ContactRequest;
import com.draazy.api.leads.contact.ContactRequestRepository;
import com.draazy.api.leads.contact.ContactRequestStatuses;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@DisplayName("My Listings — the row is a slim card with its lead count")
class OwnerListingCardTest extends AbstractApiTest {

    private static final List<String> FULL_RECORD_ONLY = List.of("description", "owner", "amenities", "images",
            "adminPipeline", "qualityScore", "city", "priceUnit");

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired ContactRequestRepository requests;
    @Autowired ObjectMapper objectMapper;

    private User user(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Card Owner");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, String title) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setDescription("A bright two bedroom flat close to the metro.");
        p.setStatus(PropertyStatus.APPROVED);
        return properties.saveAndFlush(p);
    }

    private void lead(Property p, User requester, String status) {
        ContactRequest row = new ContactRequest(p.getId(), requester.getId(), null);
        row.setStatus(status);
        requests.saveAndFlush(row);
    }

    private JsonNode read(String uri, User caller) throws Exception {
        String body = mvc.perform(get(uri).header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body);
    }

    private static JsonNode row(JsonNode page, Property p) {
        for (JsonNode r : page.get("content")) {
            if (r.get("id").asText().equals(p.getId().toString())) {
                return r;
            }
        }
        throw new AssertionError("no row for " + p.getId());
    }

    @Test
    @DisplayName("each row counts only its own open requests, and only the caller's rows come back")
    void pendingLeadsAreCountedPerListing() throws Exception {
        User o = user("9876511101");
        User stranger = user("9876511102");
        Property busy = listing(o, "Busy 2BHK");
        Property quiet = listing(o, "Quiet 2BHK");
        Property theirs = listing(stranger, "Not mine");
        lead(busy, user("9876511103"), ContactRequestStatuses.PENDING);
        lead(busy, user("9876511104"), ContactRequestStatuses.PENDING);
        lead(busy, user("9876511105"), ContactRequestStatuses.APPROVED);
        lead(busy, user("9876511106"), ContactRequestStatuses.DECLINED);
        lead(theirs, user("9876511107"), ContactRequestStatuses.PENDING);

        JsonNode page = read("/me/listings?size=100", o);

        assertThat(page.get("content")).hasSize(2);
        assertThat(row(page, busy).get("pendingLeads").asInt()).isEqualTo(2);
        assertThat(row(page, quiet).get("pendingLeads").asInt()).isZero();
    }

    @Test
    @DisplayName("the row carries what the card draws and none of the full record")
    void theRowIsSlim() throws Exception {
        User o = user("9876511111");
        Property p = listing(o, "Slim 2BHK");

        JsonNode r = row(read("/me/listings?size=100", o), p);

        assertThat(r.get("title").asText()).isEqualTo("Slim 2BHK");
        assertThat(r.get("status").asText()).isEqualTo("approved");
        assertThat(r.get("dealStatus").asText()).isEqualTo("active");
        assertThat(r.get("descLength").asInt()).isEqualTo(p.getDescription().length());
        assertThat(r.get("photoCount").asInt()).isZero();
        assertThat(r.has("progress")).isTrue();
        FULL_RECORD_ONLY.forEach(k -> assertThat(r.has(k)).as(k).isFalse());
        assertThat(r.size()).isLessThan(40);
    }

    @Test
    @DisplayName("a single row read answers the same row the list does")
    void theCardReadMatchesTheListRow() throws Exception {
        User o = user("9876511121");
        Property p = listing(o, "Row 2BHK");
        lead(p, user("9876511122"), ContactRequestStatuses.PENDING);

        JsonNode fromList = row(read("/me/listings?size=100", o), p);
        JsonNode fromCard = read("/me/listings/" + p.getId() + "/card", o);

        assertThat(fromCard).isEqualTo(fromList);
    }

    @Test
    @DisplayName("someone else's listing is a 404, not a card")
    void aStrangersCardIsNotFound() throws Exception {
        Property theirs = listing(user("9876511131"), "Theirs");

        mvc.perform(get("/me/listings/" + theirs.getId() + "/card")
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9876511132"))))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("pause answers the row with the new status and the lead count, not the full record")
    void pauseAnswersTheCard() throws Exception {
        User o = user("9876511141");
        Property p = listing(o, "Pause 2BHK");
        lead(p, user("9876511142"), ContactRequestStatuses.PENDING);

        String body = mvc.perform(post("/me/listings/" + p.getId() + "/pause")
                        .header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode r = objectMapper.readTree(body);

        assertThat(r.get("status").asText()).isEqualTo("paused");
        assertThat(r.get("pendingLeads").asInt()).isEqualTo(1);
        assertThat(r.has("description")).isFalse();
    }
}
