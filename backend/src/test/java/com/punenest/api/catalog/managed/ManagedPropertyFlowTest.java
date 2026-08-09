package com.punenest.api.catalog.managed;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * The owner's private managed-property lifecycle: {@code GET/POST /me/managed-properties},
 * {@code GET/PATCH/DELETE /me/managed-properties/{id}} and {@code POST …/{id}/publish} (slice B,
 * V33).
 *
 * <p>Organised around the invariants that make this its own resource rather than a flavour of
 * {@code /me/listings}: a record is owner-scoped (a cross-owner id is a {@code 404}, never a
 * {@code 403}), born {@code private}/{@code managed} with lifecycle fields the body can't set, and
 * enters the marketplace only through publish — which spawns an ordinary <em>pending</em> listing,
 * links back to it, and is idempotent.
 */
class ManagedPropertyFlowTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    ManagedPropertyRepository managed;

    private User user(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private String register(User owner, String body) throws Exception {
        String json = mvc.perform(post(Routes.MeManagedProperties.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.replaceAll("^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    private static String flat(String locality, long price) {
        return "{\"deal\":\"rent\",\"propertyType\":\"Flat\",\"bhk\":2,\"price\":" + price
                + ",\"locality\":\"" + locality + "\"}";
    }

    // ---------------- register ----------------

    @Test
    void register_isBornPrivateAndManaged_withServerOwnedLifecycle() throws Exception {
        User owner = user("9831003001");

        mvc.perform(post(Routes.MeManagedProperties.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        // visibility/status in the body must be ignored, not honoured.
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deal\":\"rent\",\"propertyType\":\"Flat\",\"bhk\":2,"
                                + "\"price\":25000,\"locality\":\"Baner\","
                                + "\"visibility\":\"public\",\"status\":\"published\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.visibility").value("private"))
                .andExpect(jsonPath("$.status").value("managed"))
                .andExpect(jsonPath("$.publishedListingId").doesNotExist())
                .andExpect(jsonPath("$.localitySlug").exists());
    }

    @Test
    void register_synthesizesATitleWhenBlank() throws Exception {
        User owner = user("9831003002");

        mvc.perform(post(Routes.MeManagedProperties.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(flat("Baner", 25000)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("2 BHK Flat in Baner"));
    }

    @Test
    void register_defaultsMonthlyRentToPriceForARentDeal() throws Exception {
        User owner = user("9831003003");

        mvc.perform(post(Routes.MeManagedProperties.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(flat("Baner", 25000)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.monthlyRent").value(25000));
    }

    @Test
    void register_rejectsAnUnknownDeal() throws Exception {
        User owner = user("9831003004");

        mvc.perform(post(Routes.MeManagedProperties.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deal\":\"lease\",\"propertyType\":\"Flat\","
                                + "\"price\":25000,\"locality\":\"Baner\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    // ---------------- list ----------------

    @Test
    void list_showsOnlyTheCallersOwnRecords_newestFirst() throws Exception {
        User owner = user("9831003005");
        User other = user("9831003006");
        register(owner, flat("Baner", 20000));
        register(owner, flat("Kothrud", 30000));
        register(other, flat("Wakad", 40000));

        mvc.perform(get(Routes.MeManagedProperties.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].locality").value("Kothrud"));
    }

    // ---------------- get / ownership ----------------

    @Test
    void get_returnsAnOwnedRecord() throws Exception {
        User owner = user("9831003007");
        String id = register(owner, flat("Baner", 25000));

        mvc.perform(get(Routes.MeManagedProperties.BASE + "/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id));
    }

    @Test
    void get_returns404ForAnotherOwnersRecord_neverConfirmingItExists() throws Exception {
        User owner = user("9831003008");
        User other = user("9831003009");
        String id = register(owner, flat("Baner", 25000));

        mvc.perform(get(Routes.MeManagedProperties.BASE + "/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(other)))
                .andExpect(status().isNotFound());
    }

    @Test
    void get_returns404ForAnUnknownId() throws Exception {
        User owner = user("9831003010");

        mvc.perform(get(Routes.MeManagedProperties.BASE + "/" + UUID.randomUUID())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNotFound());
    }

    // ---------------- update ----------------

    @Test
    void update_appliesOnlySuppliedFields_leavingTheRestUntouched() throws Exception {
        User owner = user("9831003011");
        String id = register(owner, flat("Baner", 25000));

        mvc.perform(patch(Routes.MeManagedProperties.BASE + "/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rented\":true,\"tenantName\":\"Rohan\",\"dueDay\":5}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rented").value(true))
                .andExpect(jsonPath("$.tenantName").value("Rohan"))
                .andExpect(jsonPath("$.dueDay").value(5))
                // untouched
                .andExpect(jsonPath("$.locality").value("Baner"))
                .andExpect(jsonPath("$.price").value(25000));
    }

    @Test
    void update_returns404ForAnotherOwnersRecord() throws Exception {
        User owner = user("9831003012");
        User other = user("9831003013");
        String id = register(owner, flat("Baner", 25000));

        mvc.perform(patch(Routes.MeManagedProperties.BASE + "/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(other))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rented\":true}"))
                .andExpect(status().isNotFound());
    }

    // ---------------- delete ----------------

    @Test
    void delete_removesAnOwnedRecord() throws Exception {
        User owner = user("9831003014");
        String id = register(owner, flat("Baner", 25000));

        mvc.perform(delete(Routes.MeManagedProperties.BASE + "/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());

        mvc.perform(get(Routes.MeManagedProperties.BASE + "/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNotFound());
    }

    @Test
    void delete_returns404ForAnotherOwnersRecord() throws Exception {
        User owner = user("9831003015");
        User other = user("9831003016");
        String id = register(owner, flat("Baner", 25000));

        mvc.perform(delete(Routes.MeManagedProperties.BASE + "/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(other)))
                .andExpect(status().isNotFound());
    }

    // ---------------- publish ----------------

    @Test
    void publish_spawnsAPendingListing_linksBack_andFlipsTheRecordPublic() throws Exception {
        User owner = user("9831003017");
        String id = register(owner, flat("Baner", 25000));

        String json = mvc.perform(post(Routes.MeManagedProperties.BASE + "/" + id + "/publish")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.visibility").value("public"))
                .andExpect(jsonPath("$.status").value("published"))
                .andExpect(jsonPath("$.publishedListingId").exists())
                .andReturn().getResponse().getContentAsString();

        String listingId = json.replaceAll("^.*?\"publishedListingId\":\"([^\"]+)\".*$", "$1");
        String status = jdbc.queryForObject(
                "SELECT status FROM properties WHERE id = ?::uuid", String.class, listingId);
        assertThat(status).isEqualTo(PropertyStatus.PENDING);
    }

    @Test
    void publish_isIdempotent_noSecondListing() throws Exception {
        User owner = user("9831003018");
        String id = register(owner, flat("Baner", 25000));

        String first = mvc.perform(post(Routes.MeManagedProperties.BASE + "/" + id + "/publish")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String firstListing = first.replaceAll("^.*?\"publishedListingId\":\"([^\"]+)\".*$", "$1");

        mvc.perform(post(Routes.MeManagedProperties.BASE + "/" + id + "/publish")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.publishedListingId").value(firstListing));

        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM properties WHERE owner_id = ?::uuid", Integer.class,
                owner.getId().toString());
        assertThat(count).isEqualTo(1);
    }

    @Test
    void publish_returns404ForAnotherOwnersRecord() throws Exception {
        User owner = user("9831003019");
        User other = user("9831003020");
        String id = register(owner, flat("Baner", 25000));

        mvc.perform(post(Routes.MeManagedProperties.BASE + "/" + id + "/publish")
                        .header(HttpHeaders.AUTHORIZATION, bearer(other)))
                .andExpect(status().isNotFound());
    }

    @Test
    void publish_rejectsARecordThatCannotLegallyBecomeAListing() throws Exception {
        User owner = user("9831003021");
        // A managed record may be captured with a zero price (a private draft); the marketplace
        // contract requires a positive one. Publish is the boundary, so it must 422 rather than
        // slip a ₹0 listing into the catalogue.
        String id = register(owner, "{\"deal\":\"rent\",\"propertyType\":\"Flat\",\"bhk\":2,"
                + "\"price\":0,\"locality\":\"Baner\"}");

        mvc.perform(post(Routes.MeManagedProperties.BASE + "/" + id + "/publish")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isUnprocessableEntity());

        // ...and the record stayed private — no half-published state.
        mvc.perform(get(Routes.MeManagedProperties.BASE + "/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("managed"))
                .andExpect(jsonPath("$.publishedListingId").doesNotExist());
    }

    // ---------------- auth ----------------

    @Test
    void endpoints_requireAuthentication() throws Exception {
        mvc.perform(get(Routes.MeManagedProperties.BASE))
                .andExpect(status().isUnauthorized());
        mvc.perform(post(Routes.MeManagedProperties.BASE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(flat("Baner", 25000)))
                .andExpect(status().isUnauthorized());
    }
}
