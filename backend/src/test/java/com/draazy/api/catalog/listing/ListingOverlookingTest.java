package com.draazy.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

class ListingOverlookingTest extends AbstractApiTest {

    private static final String CREATE_BODY = """
            {"title":"Overlooking regression","deal":"rent","propertyType":"apartment",
             "price":25000,"locality":"Kothrud","city":"Pune","facing":"East"%s}
            """;

    @Autowired UserRepository users;
    @Autowired EntityManager em;
    private User owner;
    private String authorization;

    @BeforeEach
    void setUp() {
        User user = new User("9862900001", "buyer");
        user.setName("Overlooking Owner");
        user.setMobileVerified(true);
        owner = users.saveAndFlush(user);
        authorization = bearer(owner);
    }

    @ParameterizedTest
    @ValueSource(strings = {"Garden", "12345678901234567890123456789012"})
    void postPersistsOverlookingAndReadsItIndependentlyOfFacing(String overlooking) throws Exception {
        UUID id = postListing(",\"overlooking\":\"" + overlooking + "\"");

        assertStored(id, overlooking, "East");
        mvc.perform(get("/me/listings/" + id).header("Authorization", authorization))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.overlooking").value(overlooking))
                .andExpect(jsonPath("$.facing").value("East"));

        jdbc.update("update properties set status = 'approved' where id = ?", id);
        em.clear();
        mvc.perform(get("/properties/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.overlooking").value(overlooking))
                .andExpect(jsonPath("$.facing").value("East"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"Pool", "12345678901234567890123456789012"})
    void patchPersistsOverlookingWithoutChangingFacing(String overlooking) throws Exception {
        UUID id = postListing(",\"overlooking\":\"Garden\"");

        mvc.perform(patch("/me/listings/" + id).header("Authorization", authorization)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"overlooking\":\"" + overlooking + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.overlooking").value(overlooking))
                .andExpect(jsonPath("$.facing").value("East"));

        assertStored(id, overlooking, "East");
        mvc.perform(get("/me/listings/" + id).header("Authorization", authorization))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.overlooking").value(overlooking))
                .andExpect(jsonPath("$.facing").value("East"));
    }

    @Test
    void postWithoutOverlookingLeavesItUnstated() throws Exception {
        UUID id = postListing("");

        assertStored(id, null, "East");
        mvc.perform(get("/me/listings/" + id).header("Authorization", authorization))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.overlooking").doesNotExist())
                .andExpect(jsonPath("$.facing").value("East"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"facing\":\"West\"}", "{\"facing\":\"West\",\"overlooking\":null}"})
    void patchWithOmittedOrNullOverlookingPreservesIt(String body) throws Exception {
        UUID id = postListing(",\"overlooking\":\"Garden\"");

        mvc.perform(patch("/me/listings/" + id).header("Authorization", authorization)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.overlooking").value("Garden"))
                .andExpect(jsonPath("$.facing").value("West"));

        assertStored(id, "Garden", "West");
    }

    @Test
    void postRejectsOverlookingLongerThan32Characters() throws Exception {
        mvc.perform(post("/me/listings").header("Authorization", authorization)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(CREATE_BODY.formatted(",\"overlooking\":\"" + "x".repeat(33) + "\"")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error").value("validation_failed"))
                .andExpect(jsonPath("$.fields.length()").value(1))
                .andExpect(jsonPath("$.fields[0].field").value("overlooking"));
    }

    @Test
    void patchRejectsOverlookingLongerThan32Characters() throws Exception {
        UUID id = postListing(",\"overlooking\":\"Garden\"");

        mvc.perform(patch("/me/listings/" + id).header("Authorization", authorization)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"overlooking\":\"" + "x".repeat(33) + "\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error").value("validation_failed"))
                .andExpect(jsonPath("$.fields.length()").value(1))
                .andExpect(jsonPath("$.fields[0].field").value("overlooking"));
    }

    private UUID postListing(String extraFields) throws Exception {
        mvc.perform(post("/me/listings").header("Authorization", authorization)
                        .contentType(MediaType.APPLICATION_JSON).content(CREATE_BODY.formatted(extraFields)))
                .andExpect(status().isCreated());
        em.flush();
        em.clear();
        return jdbc.queryForObject("select id from properties where owner_id = ?", UUID.class, owner.getId());
    }

    private void assertStored(UUID id, String overlooking, String facing) {
        // MockMvc shares the test transaction; a managed entity would not prove a database write.
        em.flush();
        em.clear();
        assertThat(jdbc.queryForObject("select overlooking from properties where id = ?", String.class, id))
                .isEqualTo(overlooking);
        assertThat(jdbc.queryForObject("select facing from properties where id = ?", String.class, id))
                .isEqualTo(facing);
    }
}