package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

@DisplayName("Flatmate seeker posts store canonical live locality names")
class FlatmateLocalityBindingTest extends AbstractApiTest {

    @Autowired UserRepository users;

    private String actor;

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        if (actor != null) {
            jdbc.update("delete from audit_log where actor = ?", actor);
        }
    }

    private User seeker() {
        User u = new User("9862000101", Roles.Wire.BUYER);
        u.setName("Locality Seeker");
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        actor = saved.getId().toString();
        return saved;
    }

    private ResultActions createPost(User u, String localities) throws Exception {
        return mvc.perform(post(Routes.Flatmates.POSTS)
                .header(HttpHeaders.AUTHORIZATION, bearer(u))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"name":"Locality Seeker","gender":"female","age":26,"occupation":"UX Designer",
                         "budget":18000,"localities":[%s],"moveIn":"2026-09-01",
                         "flatPref":"women","roomPref":"private","tags":["Vegetarian"],"note":"Quiet and tidy."}
                        """.formatted(localities)));
    }

    @Test
    void typedNamesAreStoredAsTheirCanonicalSpelling() throws Exception {
        createPost(seeker(), "\"aundh\",\"BANER\",\"baner\"")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.localities[0]").value("Aundh"))
                .andExpect(jsonPath("$.localities[1]").value("Baner"))
                .andExpect(jsonPath("$.localities.length()").value(2));
    }

    @Test
    void aNameThatIsNotALiveLocalityIsRefused() throws Exception {
        createPost(seeker(), "\"Aundh\",\"Nowhere At All\"")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value("Pick the locality from the suggestions."));

        assertThat(jdbc.queryForObject("select count(*) from flatmate_seeker_posts", Integer.class)).isZero();
    }

    private ResultActions createGroup(User u, String localityBody) throws Exception {
        return mvc.perform(post(Routes.Flatmates.GROUPS)
                .header(HttpHeaders.AUTHORIZATION, bearer(u))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Four of us\",\"policy\":\"any\",\"rent\":45000,\"seats\":3,"
                        + "\"seatsOpen\":1,\"name\":\"Locality Seeker\"," + localityBody + "}"));
    }

    @Test
    void aGroupBoundBySlugStoresTheCanonicalName() throws Exception {
        liveLocality("Zzflat Nagar");
        String slug = jdbc.queryForObject("select slug from localities where name='Zzflat Nagar'", String.class);

        createGroup(seeker(), "\"locality\":\"whatever the user typed\",\"localitySlug\":\"" + slug + "\"")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.locality").value("Zzflat Nagar"));
    }

    @Test
    void aGroupSlugOfARetiredRowIsRefused() throws Exception {
        jdbc.update("insert into localities (slug, name, city, active, archived_at) "
                + "values ('zzretired-wadi', 'Zzretired Wadi', 'Pune', false, now())");

        createGroup(seeker(), "\"locality\":\"Zzretired Wadi\",\"localitySlug\":\"zzretired-wadi\"")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value("Pick the locality from the suggestions."));
    }
}
