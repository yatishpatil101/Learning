package com.draazy.api.engagement.flatmate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

// `flatCommitted` is not only displayed: `occupancy` and `shareMax` are derived from it.
// Anonymous must omit occupancy, not publish `0`, or it labels occupied rooms as empty.
@DisplayName("D212 — the public feed reports a full flat as occupied")
class FlatmateOccupancyAgreementTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @Autowired
    PropertyRepository properties;

    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    @Test
    @DisplayName("a full flat never reports itself empty")
    void aFullFlatReportsOccupied() throws Exception {
        User owner = user("9830000041", "Ledger", Roles.Wire.OWNER);
        User admin = user("9830000042", "Moderator3", Roles.Wire.ADMIN);
        Property flat = listing(owner);

        // Two rooms, two people allowed in the whole flat, one person in each: the flat is full.
        String split = mvc.perform(post(Routes.Properties.SPLIT, flat.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"maxOccupants\":2,\"rooms\":["
                                + "{\"roomKind\":\"master\",\"rent\":15000},"
                                + "{\"roomKind\":\"bedroom\",\"rent\":12000}]}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String first = com.jayway.jsonpath.JsonPath.read(split, "$.rooms[0].id");
        String second = com.jayway.jsonpath.JsonPath.read(split, "$.rooms[1].id");

        moveIn(owner, first);
        moveIn(owner, second);
        clear(admin, first);
        clear(admin, second);

        // The flat holds two people and allows two: full.
        Map<String, Object> fromFeed = feedCard(first);

        assertEquals(2, fromFeed.get("flatCommitted"));
        assertEquals("occupied", fromFeed.get("occupancy"));

        assertEquals(2, feedCard(second).get("flatCommitted"));
    }

    private Map<String, Object> feedCard(String roomId) throws Exception {
        return roomIn(body(get(Routes.Flatmates.FEED).param("tab", "move-in")
                .param("locality", "Baner").param("size", "50")), "$.content", roomId);
    }

    private String body(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    /** The one card with this id, so the assertion survives whatever else the feed is holding. */
    private static Map<String, Object> roomIn(String json, String listPath, String id) {
        List<Map<String, Object>> cards = com.jayway.jsonpath.JsonPath.read(json, listPath);
        return cards.stream()
                .filter(card -> id.equals(card.get("id")))
                .findFirst()
                .orElseThrow(() -> new AssertionError(
                        "room " + id + " missing from " + listPath + ": " + json));
    }

    private void moveIn(User owner, String roomId) throws Exception {
        mvc.perform(patch(Routes.Flatmates.ROOM_OCCUPANTS, roomId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"occupants\":1}"))
                .andExpect(status().isOk());
    }

    private void clear(User admin, String roomId) throws Exception {
        mvc.perform(patch(Routes.Moderation.FLATMATE_MODERATION.replace("{id}", roomId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"modStatus\":\"approved\"}"))
                .andExpect(status().isOk());
    }

    private User user(String mobile, String name, String role) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "Flat in Baner", "rent", "apartment",
                45000L, "Baner", "Pune");
        p.setBhk(BigDecimal.valueOf(2));
        p.setStatus(PropertyStatus.APPROVED);
        return properties.saveAndFlush(p);
    }
}
