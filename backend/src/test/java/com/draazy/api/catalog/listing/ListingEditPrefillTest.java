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

class ListingEditPrefillTest extends AbstractApiTest {
    private static final String BODY = """
            {"title":"Edit prefill regression","deal":"rent","propertyType":"Flat",
             "price":31000,"maintenance":2500,"negotiable":true,"locality":"Baner","city":"Pune","area":1000,
             "pincode":"411045","carpetArea":875.5,"builtUpArea":1000.25,
             "address":"C-901, North, Edit Homes, Baner Road",
             "electricityMeterNo":"00123456789","reraId":"P52100000001",
             "formDetails":%s}
            """;
    private static final String DETAILS = """
            {"flatNumber":"C-901","tower":"North","society":"Edit Homes",
             "street":"Baner Road","landmark":"Near library","ownership":"Freehold",
             "loanAvailable":false,"agreementDuration":"24","lockIn":"0","availableFrom":"2027-01-20",
             "furniture":["Study Table"],"preferredTenants":["family","bachelors"],"fixtures":[]}
            """;

    @Autowired UserRepository users;
    @Autowired EntityManager em;
    private User owner;
    private String auth;

    @BeforeEach
    void owner() {
        owner = users.saveAndFlush(new User("9862985001", "buyer"));
        auth = bearer(owner);
    }

    @Test
        void savedAnswersSurviveFreshReadAndOnlySelectedAnswersArePublic() throws Exception {
        UUID id = create();
        mvc.perform(patch("/me/listings/" + id).header("Authorization", auth)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"description\":\"Updated text\"}"))
                .andExpect(status().isOk());
        em.flush();
        em.clear();
        assertThat(jdbc.queryForObject("select form_details->>'flatNumber' from properties where id = ?",
                String.class, id)).isEqualTo("C-901");
        mvc.perform(get("/me/listings/" + id).header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pincode").value("411045"))
                .andExpect(jsonPath("$.carpetArea").value(875.5))
                .andExpect(jsonPath("$.builtUpArea").value(1000.25))
                .andExpect(jsonPath("$.formDetails.flatNumber").value("C-901"))
                .andExpect(jsonPath("$.formDetails.loanAvailable").value(false))
                .andExpect(jsonPath("$.formDetails.lockIn").value("0"))
                .andExpect(jsonPath("$.formDetails.fixtures").isEmpty())
                .andExpect(jsonPath("$.electricityMeterNo").value("00123456789"));
        jdbc.update("update properties set status = 'approved' where id = ?", id);
        em.clear();
        mvc.perform(get("/properties/" + id)).andExpect(status().isOk())
                .andExpect(jsonPath("$.ownership").value("Freehold"))
                .andExpect(jsonPath("$.loanAvailable").value(false))
                .andExpect(jsonPath("$.agreementDuration").value("24"))
                .andExpect(jsonPath("$.furniture[0]").value("Study Table"))
                .andExpect(jsonPath("$.maintenance").value(2500))
                .andExpect(jsonPath("$.negotiable").value(true))
                .andExpect(jsonPath("$.formDetails").doesNotExist())
                .andExpect(jsonPath("$.address").doesNotExist())
                .andExpect(jsonPath("$.electricityMeterNo").doesNotExist());
        User stranger = users.saveAndFlush(new User("9862985002", "buyer"));
        mvc.perform(get("/me/listings/" + id).header("Authorization", bearer(stranger)))
                .andExpect(status().isNotFound());
    }

    @Test
    void completeReplacementCanClearAnswersWithoutChangingTheAddress() throws Exception {
        UUID id = create();
        mvc.perform(patch("/me/listings/" + id).header("Authorization", auth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"formDetails\":{\"landmark\":\"\",\"preferredTenants\":[]},\"pincode\":\"411038\"}"))
                .andExpect(status().isOk());
        em.flush();
        em.clear();
        mvc.perform(get("/me/listings/" + id).header("Authorization", auth))
                .andExpect(jsonPath("$.formDetails.landmark").value(""))
                .andExpect(jsonPath("$.formDetails.preferredTenants").isEmpty())
                .andExpect(jsonPath("$.pincode").value("411038"))
                .andExpect(jsonPath("$.address").value("C-901, North, Edit Homes, Baner Road"));
    }

    @Test
    void clearMaintenanceRemovesThePreviouslyStatedAmount() throws Exception {
        UUID id = create();
        mvc.perform(patch("/me/listings/" + id).header("Authorization", auth)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"clearMaintenance\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.maintenance").doesNotExist());
        em.flush();
        jdbc.update("update properties set status = 'approved' where id = ?", id);
        em.clear();
        mvc.perform(get("/properties/" + id)).andExpect(status().isOk())
                .andExpect(jsonPath("$.maintenance").doesNotExist());
    }

    @Test
    void directAddressCorrectionInvalidatesOnlyStaleAddressComponents() throws Exception {
        UUID id = create();
        mvc.perform(patch("/me/listings/" + id).header("Authorization", auth)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"address\":\"Corrected address\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.formDetails.flatNumber").doesNotExist())
                .andExpect(jsonPath("$.formDetails.loanAvailable").value(false));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"ownerVerified\":true}", "{\"loanAvailable\":\"false\"}",
            "{\"flatNumber\":123}", "{\"fixtures\":[{}]}", "{\"unknown\":\"x\"}",
            "{\"street\":\"bad\\u0000\"}", "{\"fixtures\":[\"bad\\u0001\"]}"})
    void createAndPatchRejectUnsupportedKeysAndWrongTypes(String details) throws Exception {
        mvc.perform(post("/me/listings").header("Authorization", auth)
                        .contentType(MediaType.APPLICATION_JSON).content(BODY.formatted(details)))
                .andExpect(status().isUnprocessableEntity());
        UUID id = create();
        mvc.perform(patch("/me/listings/" + id).header("Authorization", auth)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"formDetails\":" + details + "}"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void rejectsUnboundedTextAndInvalidPostcode() throws Exception {
        mvc.perform(post("/me/listings").header("Authorization", auth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY.formatted("{\"flatNumber\":\"" + "a".repeat(21) + "\"}")))
                .andExpect(status().isUnprocessableEntity());
        mvc.perform(post("/me/listings").header("Authorization", auth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY.formatted(DETAILS).replace("411045", "012345")))
                .andExpect(status().isUnprocessableEntity());
    }

    private UUID create() throws Exception {
        mvc.perform(post("/me/listings").header("Authorization", auth)
                        .contentType(MediaType.APPLICATION_JSON).content(BODY.formatted(DETAILS)))
                .andExpect(status().isCreated());
        em.flush();
        em.clear();
        return jdbc.queryForObject("select id from properties where owner_id = ?", UUID.class, owner.getId());
    }
}