package com.punenest.api.engagement.flatmate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
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

/**
 * D212 — one room, one occupancy answer, whichever endpoint asked.
 *
 * <p>{@code flatCommitted} is not only displayed: {@code occupancy} and {@code shareMax} are
 * derived from it. So when {@code RoomView.anonymous} passed {@code 0} because an anonymous caller
 * "has no business knowing", it did not withhold the number — it published a wrong <em>label</em>.
 * A full flat advertised itself as {@code empty} on the mixed feed while the room feed, reading the
 * same row through a different call site, said {@code occupied}. The contract declares one schema
 * for all three reads, so this was not a projection difference; it was two answers to one question.
 *
 * <p>The test therefore asserts <strong>agreement</strong> rather than a value: it reads the same
 * room back from all three public endpoints and requires them to say the same thing. A future
 * refactor that gets the number wrong in one place still fails here, which a per-endpoint
 * expectation would not catch if both expectations were edited together.
 */
@DisplayName("D212 — every public read reports the same occupancy for the same room")
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
    @DisplayName("a full flat never reports itself empty, on any of the three room reads")
    void everyPublicReadAgrees() throws Exception {
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

        // The three public reads of the same room. Compared as objects rather than asserted one
        // endpoint at a time: agreement is the property under test, and three separate literal
        // expectations would be edited together by anyone who broke it.
        Map<String, Object> fromFlat = roomIn(
                body(get(Routes.Properties.ROOMS, flat.getId())), "$", first);
        Map<String, Object> fromRoomFeed = roomIn(
                body(get(Routes.Flatmates.ROOMS).param("locality", "Baner").param("size", "50")),
                "$.content", first);
        Map<String, Object> fromMixedFeed = roomIn(
                body(get(Routes.Flatmates.FEED).param("tab", "move-in")
                        .param("locality", "Baner").param("size", "50")),
                "$.content", first);

        // The flat holds two people and allows two: full. The mixed feed used to say `empty` here,
        // because its RoomView carried a hardcoded zero rather than the flat's real ledger.
        assertEquals(2, fromFlat.get("flatCommitted"), "the flat's own room list");
        assertEquals("occupied", fromFlat.get("occupancy"), "the flat's own room list");
        assertEquals(fromFlat.get("flatCommitted"), fromRoomFeed.get("flatCommitted"), "room feed");
        assertEquals(fromFlat.get("occupancy"), fromRoomFeed.get("occupancy"), "room feed");
        assertEquals(fromFlat.get("flatCommitted"), fromMixedFeed.get("flatCommitted"), "mixed feed");
        assertEquals(fromFlat.get("occupancy"), fromMixedFeed.get("occupancy"), "mixed feed");

        // The sibling shares the ledger, so it reports the same total, not its own single head.
        assertEquals(2, roomIn(
                body(get(Routes.Flatmates.ROOMS).param("locality", "Baner").param("size", "50")),
                "$.content", second).get("flatCommitted"));
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
