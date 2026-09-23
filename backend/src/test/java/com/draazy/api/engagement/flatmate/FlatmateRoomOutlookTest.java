package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import com.jayway.jsonpath.JsonPath;
import jakarta.persistence.EntityManager;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

class FlatmateRoomOutlookTest extends AbstractApiTest {

    @Autowired UserRepository users;
        @Autowired PropertyRepository properties;
    @Autowired EntityManager em;
    private User host;

    @BeforeEach
    void createHost() {
        host = new User("9811199301", Roles.Wire.BUYER);
        host.setName("Outlook Host");
        host.setMobileVerified(true);
        host = users.saveAndFlush(host);
    }

    @AfterEach
    void cleanAudit() {
        jdbc.update("delete from audit_log where actor = ?", host.getId().toString());
    }

    @Test
    void createAndUpdatePersistIndependentFieldsAcrossOwnerAndPublicReads() throws Exception {
        String id = create("\"facing\":\" E \",\"overlooking\":\" Garden \"")
                .andExpect(jsonPath("$.facing").value("E"))
                .andExpect(jsonPath("$.overlooking").value("Garden"))
                .andReturn().getResponse().getContentAsString();
        id = JsonPath.read(id, "$.id");
        assertStoredAndReadable(id, "E", "Garden");

        update(id, "\"facing\":\" W \",\"overlooking\":\" Main Road \"")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.facing").value("W"))
                .andExpect(jsonPath("$.overlooking").value("Main Road"));
        assertStoredAndReadable(id, "W", "Main Road");

        update(id, "\"facing\":\"N\"").andExpect(status().isOk());
        assertStoredAndReadable(id, "N", null);
        update(id, "\"overlooking\":\"Parking\"").andExpect(status().isOk());
        assertStoredAndReadable(id, null, "Parking");
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "\"facing\":null,\"overlooking\":null",
            "\"facing\":\"  \",\"overlooking\":\"  \""})
    void omittedNullAndBlankStayOptionalAndClearOnUpdate(String fields) throws Exception {
        String id = idOf(create(fields));
        assertStoredAndReadable(id, null, null);
        update(id, "\"facing\":\"S\",\"overlooking\":\"Amenity\"")
                .andExpect(status().isOk());
        assertStoredAndReadable(id, "S", "Amenity");

        update(id, fields).andExpect(status().isOk());
        assertStoredAndReadable(id, null, null);
    }

    @ParameterizedTest
    @ValueSource(strings = {"facing", "overlooking"})
    void accepts32CharactersOnCreateAndUpdate(String field) throws Exception {
        String value = "x".repeat(32);
        String id = idOf(create("\"" + field + "\":\"" + value + "\""));
        assertStoredAndReadable(id, field.equals("facing") ? value : null,
                field.equals("overlooking") ? value : null);

        value = "y".repeat(32);
        update(id, "\"" + field + "\":\"" + value + "\"").andExpect(status().isOk());
        assertStoredAndReadable(id, field.equals("facing") ? value : null,
                field.equals("overlooking") ? value : null);
    }

    @ParameterizedTest
    @ValueSource(strings = {"facing", "overlooking"})
    void rejects33CharactersOnCreateAndUpdateWithoutChangingStorage(String field) throws Exception {
        String fields = "\"" + field + "\":\"" + "x".repeat(33) + "\"";
        mvc.perform(post(Routes.Flatmates.ROOMS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON).content(body(fields)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value(field));
        assertThat(jdbc.queryForObject("select count(*) from flatmate_rooms where host_id = ?",
                Integer.class, host.getId())).isZero();

        String id = idOf(create("\"facing\":\"E\",\"overlooking\":\"Garden\""));
        update(id, fields).andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value(field));
        assertStoredAndReadable(id, "E", "Garden");
    }

    @Test
    void splitRoomsDoNotInheritTheParentOutlook() throws Exception {
        Property parent = new Property(host, "Outlook flat", "rent", "apartment",
                45000L, "Baner", "Pune");
        parent.setStatus(PropertyStatus.APPROVED);
        parent.setFacing("E");
        parent.setOverlooking("Garden");
        parent = properties.saveAndFlush(parent);

        mvc.perform(post(Routes.Properties.SPLIT, parent.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"maxOccupants\":2,\"rooms\":[{\"roomKind\":\"master\",\"rent\":15000}]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.rooms.length()").value(1))
                .andExpect(jsonPath("$.rooms[0].facing").doesNotExist())
                .andExpect(jsonPath("$.rooms[0].overlooking").doesNotExist());

        em.flush();
        em.clear();
        var stored = jdbc.queryForList(
                "select facing, overlooking from flatmate_rooms where property_id = ?", parent.getId());
        assertThat(stored).hasSize(1);
        assertThat(stored.getFirst().get("facing")).isNull();
        assertThat(stored.getFirst().get("overlooking")).isNull();
        assertThat(jdbc.queryForMap("select facing, overlooking from properties where id = ?",
                parent.getId())).containsEntry("facing", "E").containsEntry("overlooking", "Garden");
    }

    private ResultActions create(String fields) throws Exception {
        return mvc.perform(post(Routes.Flatmates.ROOMS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON).content(body(fields)))
                .andExpect(status().isCreated());
    }

    private ResultActions update(String id, String fields) throws Exception {
        return mvc.perform(patch(Routes.Flatmates.ROOMS + "/" + id)
                .header(HttpHeaders.AUTHORIZATION, bearer(host))
                .contentType(MediaType.APPLICATION_JSON).content(body(fields)));
    }

    private static String idOf(ResultActions result) throws Exception {
        return JsonPath.read(result.andReturn().getResponse().getContentAsString(), "$.id");
    }

    private static String body(String fields) {
        return """
                {"bhk":"2","roomType":"Private room","locality":"Baner",
                 "society":"Outlook House","rentShare":15000,"agreementDeclared":true,
                 "photos":["https://cdn.example/room.jpg"],%s%s}
                """.formatted(FlatmateAgreementFixture.EVIDENCE,
                fields.isEmpty() ? "" : "," + fields);
    }

    private void assertStoredAndReadable(String id, String facing, String overlooking) throws Exception {
        // Evict the shared test persistence context so a cached entity cannot stand in for a write.
        em.flush();
        em.clear();
        var stored = jdbc.queryForMap("select facing, overlooking from flatmate_rooms where id = ?",
                UUID.fromString(id));
        assertThat(stored.get("facing")).isEqualTo(facing);
        assertThat(stored.get("overlooking")).isEqualTo(overlooking);
        for (String route : new String[]{Routes.Flatmates.MY_ROOMS, Routes.Flatmates.ROOMS,
                Routes.Flatmates.FEED}) {
            var request = get(route).param("size", "100").param("tab", "move-in");
            if (route.equals(Routes.Flatmates.MY_ROOMS)) {
                request.header(HttpHeaders.AUTHORIZATION, bearer(host));
            }
            String response = mvc.perform(request).andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            java.util.List<java.util.Map<String, Object>> matches = JsonPath.read(response,
                    "$.content[?(@.id == '" + id + "')]");
            assertThat(matches).as(route).hasSize(1);
            assertThat(matches.getFirst().get("facing")).as(route).isEqualTo(facing);
            assertThat(matches.getFirst().get("overlooking")).as(route).isEqualTo(overlooking);
        }
    }
}