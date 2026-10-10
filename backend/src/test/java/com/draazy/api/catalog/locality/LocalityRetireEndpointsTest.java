package com.draazy.api.catalog.locality;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.PlacesLookup;
import com.draazy.api.provider.PlacesLookup.Place;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.ResultActions;

@DisplayName("Locality retire / restore: staff close an area to new listings and reopen it")
class LocalityRetireEndpointsTest extends AbstractApiTest {

    private static final String CLOSED = "That area isn't open for new listings.";

    @MockitoBean PlacesLookup places;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;

    private static final java.util.concurrent.atomic.AtomicInteger PHONE = new java.util.concurrent.atomic.AtomicInteger();

    @BeforeEach
    void googleEchoesTheHint() {
        jdbc.update("delete from audit_log where entity = 'locality'");
        when(places.details(any(), any())).thenAnswer(call -> {
            Place hint = call.getArgument(1);
            return Optional.of(hint);
        });
    }

    @AfterEach
    void cleanAudit() {
        jdbc.update("delete from audit_log where entity = 'locality'");
    }

    private User user(String role, String functionsJson) {
        User u = new User("98610100" + String.format("%02d", PHONE.getAndIncrement()), role);
        u.setName("Locality retire");
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        if (functionsJson != null) {
            jdbc.update("insert into back_office_permissions (user_id, permissions) values (?::uuid, ?::jsonb)",
                    saved.getId().toString(), functionsJson);
        }
        return saved;
    }

    private void locality(String slug, String name, String placeId, boolean active, boolean archived) {
        jdbc.update("insert into localities (slug, name, city, lat, lng, place_id, active, archived_at) "
                + "values (?, ?, 'Pune', 18.5, 73.8, ?, ?, " + (archived ? "now()" : "null") + ")",
                slug, name, placeId, active);
    }

    private void liveListing(String slug) {
        User owner = user("owner", null);
        Property p = new Property(owner, "Retire " + slug, "rent", "apartment", 20000L, "Retire", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setLocalitySlug(slug);
        p.setStatus(PropertyStatus.APPROVED);
        properties.saveAndFlush(p);
    }

    private ResultActions act(String verb, String slug, User actor) throws Exception {
        return mvc.perform(post("/admin/localities/" + slug + "/" + verb)
                .header(HttpHeaders.AUTHORIZATION, bearer(actor)));
    }

    private ResultActions resolve(String placeId, String name) throws Exception {
        String body = "{\"placeId\":\"" + placeId + "\",\"name\":\"" + name + "\",\"lat\":18.5,\"lng\":73.8,"
                + "\"types\":[\"sublocality_level_1\",\"political\"]}";
        return mvc.perform(post("/localities/resolve").contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private int audits(String action, String slug) {
        return jdbc.queryForObject("select count(*) from audit_log where action = ? and entity_id = ?",
                Integer.class, action, slug);
    }

    private boolean archived(String slug) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "select archived_at is not null from localities where slug = ?", Boolean.class, slug));
    }

    @Test
    @DisplayName("retire closes the area but keeps its live listings, and is audited once")
    void retireKeepsListings() throws Exception {
        locality("zz-retire-a", "Zz Retire A", "ChIJ-retire-a", true, false);
        liveListing("zz-retire-a");
        User staff = user("staff", null);

        act("retire", "zz-retire-a", staff)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archived").value(true))
                .andExpect(jsonPath("$.liveListings").value(1));
        act("retire", "zz-retire-a", staff)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archived").value(true));

        assertThat(archived("zz-retire-a")).isTrue();
        assertThat(audits("locality.retire", "zz-retire-a")).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from properties where locality_slug = 'zz-retire-a'"
                + " and status = 'approved' and archived_at is null", Integer.class)).isEqualTo(1);
    }

    @Test
    @DisplayName("a retired area with no listings stays in the admin list so it can be restored")
    void retiredEmptyAreaStaysListed() throws Exception {
        locality("zz-retire-empty", "Zz Retire Empty", "ChIJ-retire-empty", true, false);
        User admin = user("admin", null);

        act("retire", "zz-retire-empty", admin).andExpect(status().isOk());

        mvc.perform(get("/admin/localities").header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.slug == 'zz-retire-empty')].archived").value(true));
    }

    @Test
    @DisplayName("restore reopens a retired area, and a restored dormant seed row becomes active")
    void restoreReopens() throws Exception {
        locality("zz-restore-a", "Zz Restore A", "ChIJ-restore-a", true, true);
        locality("zz-restore-seed", "Zz Restore Seed", null, false, true);
        User admin = user("admin", null);

        act("restore", "zz-restore-a", admin).andExpect(status().isOk())
                .andExpect(jsonPath("$.archived").value(false));
        act("restore", "zz-restore-seed", admin).andExpect(status().isOk())
                .andExpect(jsonPath("$.archived").value(false));
        act("restore", "zz-restore-seed", admin).andExpect(status().isOk());

        assertThat(archived("zz-restore-a")).isFalse();
        assertThat(jdbc.queryForObject("select active from localities where slug = 'zz-restore-seed'",
                Boolean.class)).isTrue();
        assertThat(audits("locality.restore", "zz-restore-seed")).isEqualTo(1);
    }

    @Test
    @DisplayName("an unknown slug is a 404; a non-staff caller 403; an anonymous one 401")
    void guards() throws Exception {
        mvc.perform(post("/admin/localities/zz-retire-nothing/retire")).andExpect(status().isUnauthorized());
        act("retire", "zz-retire-nothing", user("staff", null)).andExpect(status().isNotFound());
        act("retire", "zz-retire-nothing", user("owner", null)).andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a staffer without the localities function cannot write")
    void functionIsRequired() throws Exception {
        locality("zz-retire-fn", "Zz Retire Fn", "ChIJ-retire-fn", true, false);

        act("retire", "zz-retire-fn", user("staff", "[\"reviews\"]")).andExpect(status().isForbidden());
        act("retire", "zz-retire-fn", user("staff", "[\"localities\"]")).andExpect(status().isOk());
    }

    @Test
    @DisplayName("a retired area cannot be picked for a new listing, by place or by name")
    void retiredAreaIsRefusedOnPick() throws Exception {
        locality("zz-closed-a", "Zz Closed A", "ChIJ-closed-a", true, false);
        act("retire", "zz-closed-a", user("staff", null)).andExpect(status().isOk());

        resolve("ChIJ-closed-a", "Zz Closed A")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value(CLOSED));
        assertThat(archived("zz-closed-a")).isTrue();
    }

    @Test
    @DisplayName("a retired row with no place is not revived by a pick; a dormant seed row still is")
    void adoptSkipsRetiredRows() throws Exception {
        locality("zz-closed-b", "Zz Closed B", null, false, true);
        User staff = user("staff", null);
        act("restore", "zz-closed-b", staff).andExpect(status().isOk());
        act("retire", "zz-closed-b", staff).andExpect(status().isOk());

        resolve("ChIJ-closed-b", "Zz Closed B")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value(CLOSED));
        assertThat(jdbc.queryForObject("select place_id from localities where slug = 'zz-closed-b'", String.class))
                .isNull();

        locality("zz-dormant-c", "Zz Dormant C", null, false, true);
        resolve("ChIJ-dormant-c", "Zz Dormant C")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("zz-dormant-c"));

        locality("zz-inactive-d", "Zz Inactive D", null, false, false);
        act("retire", "zz-inactive-d", staff).andExpect(status().isOk());
        resolve("ChIJ-inactive-d", "Zz Inactive D")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value(CLOSED));
    }
}
