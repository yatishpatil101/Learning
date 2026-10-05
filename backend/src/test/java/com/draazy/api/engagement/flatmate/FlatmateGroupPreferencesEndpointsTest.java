package com.draazy.api.engagement.flatmate;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("Flatmates — a group still looking for a flat states preferences, not a flat")
class FlatmateGroupPreferencesEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String name) {
        User u = new User(mobile, Roles.Wire.BUYER);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private static String huntingBody(String localities, String bhk, long rentMin, long rentMax) {
        return """
                {"title":"Three of us, hunting","policy":"any","seats":3,"seatsOpen":1,
                 "name":"Asha","deposit":99000,"lockInMonths":11,"role":"owner",
                 "propertyId":"%s","consentMobile":"9800000001",
                 "preferences":{"localities":[%s],"bhk":[%s],"rentMin":%d,"rentMax":%d,
                   "depositMin":60000,"depositMax":120000,"gatedOnly":true,"bachelors":true,
                   "furnishing":"semi","moveInBy":"2026-09-01"}}
                """.formatted(UUID.randomUUID(), localities, bhk, rentMin, rentMax);
    }

    private static String idOf(String json) {
        return json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    private String create(User host, String body) throws Exception {
        return idOf(mvc.perform(post(Routes.Flatmates.GROUPS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
    }

    @Test
    @DisplayName("is stored as ranges and a shortlist, with no flat terms or trust claim")
    void createsAHuntingGroup() throws Exception {
        User host = user("9811000401", "Hunter One");

        mvc.perform(post(Routes.Flatmates.GROUPS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(huntingBody("\" Aundh \",\"Baner\",\"Aundh\"", "\"3\",\"2\"",
                                36000, 54000)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.locality").value("Aundh"))
                .andExpect(jsonPath("$.rent").value(54000))
                .andExpect(jsonPath("$.perHead").value(18000))
                .andExpect(jsonPath("$.deposit").doesNotExist())
                .andExpect(jsonPath("$.lockInMonths").doesNotExist())
                .andExpect(jsonPath("$.propertyId").doesNotExist())
                .andExpect(jsonPath("$.hostRole").value("tenant"))
                .andExpect(jsonPath("$.verificationTier").value("identity"))
                .andExpect(jsonPath("$.preferences.localities", Matchers.contains("Aundh", "Baner")))
                .andExpect(jsonPath("$.preferences.bhk", Matchers.contains("2", "3")))
                .andExpect(jsonPath("$.preferences.rentMin").value(36000))
                .andExpect(jsonPath("$.preferences.rentMax").value(54000))
                .andExpect(jsonPath("$.preferences.depositMax").value(120000))
                .andExpect(jsonPath("$.preferences.gatedOnly").value(true))
                .andExpect(jsonPath("$.preferences.bachelors").value(true))
                .andExpect(jsonPath("$.preferences.furnishing").value("semi"))
                .andExpect(jsonPath("$.preferences.moveInBy").value("2026-09-01"));
    }

    @Test
    @DisplayName("is found on the team-up tab by any locality on its shortlist")
    void anyShortlistedLocalityFindsIt() throws Exception {
        User host = user("9811000402", "Hunter Two");
        String id = create(host, huntingBody("\"Aundh\",\"Baner\"", "\"2\"", 30000, 45000));
        jdbc.update("update flatmate_groups set mod_status = 'live' where id = ?", UUID.fromString(id));

        for (String locality : List.of("Aundh", "baner")) {
            mvc.perform(get(Routes.Flatmates.FEED).param("tab", "team-up")
                            .param("locality", locality).param("size", "100"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[*].id", Matchers.hasItem(id)));
        }
        mvc.perform(get(Routes.Flatmates.FEED).param("tab", "team-up")
                        .param("locality", "Wakad").param("size", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].id", Matchers.not(Matchers.hasItem(id))));

        mvc.perform(get(Routes.Flatmates.FEED).param("tab", "team-up")
                        .param("maxBudget", "12000").param("size", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].id", Matchers.hasItem(id)));
        mvc.perform(get(Routes.Flatmates.FEED).param("tab", "team-up")
                        .param("maxBudget", "9000").param("size", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].id", Matchers.not(Matchers.hasItem(id))));
    }

    @Test
    @DisplayName("answers the board's move-in filter by its move-in date; a flexible one always does")
    void moveInFilterReadsMoveInBy() throws Exception {
        User host = user("9811000406", "Hunter Six");
        User other = user("9811000407", "Hunter Seven");
        String later = create(host, huntingBody("\"Aundh\"", "\"2\"", 30000, 45000));
        String flexible = create(other, huntingBody("\"Aundh\"", "\"2\"", 30000, 45000));
        jdbc.update("update flatmate_groups set mod_status = 'live',"
                + " move_in_by = cast((now() at time zone 'Asia/Kolkata') as date) + 90 where id = ?",
                UUID.fromString(later));
        jdbc.update("update flatmate_groups set mod_status = 'live', move_in_by = null where id = ?",
                UUID.fromString(flexible));

        mvc.perform(get(Routes.Flatmates.FEED).param("tab", "team-up")
                        .param("moveInDays", "30").param("locality", "Aundh").param("size", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].id", Matchers.hasItem(flexible)))
                .andExpect(jsonPath("$.content[*].id", Matchers.not(Matchers.hasItem(later))));
        mvc.perform(get(Routes.Flatmates.FEED).param("tab", "team-up")
                        .param("moveInDays", "120").param("locality", "Aundh").param("size", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].id", Matchers.hasItems(flexible, later)));
    }

    @Test
    @DisplayName("refuses an inverted range, an unknown size and an empty shortlist")
    void rejectsNonsense() throws Exception {
        User host = user("9811000403", "Hunter Three");
        for (String body : List.of(
                huntingBody("\"Aundh\"", "\"2\"", 50000, 40000),
                huntingBody("\"Aundh\"", "\"7\"", 30000, 40000),
                huntingBody("", "\"2\"", 30000, 40000),
                huntingBody("\"A\",\"B\",\"C\",\"D\"", "\"2\"", 30000, 40000))) {
            mvc.perform(post(Routes.Flatmates.GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body))
                    .andExpect(status().is4xxClientError());
        }
    }

    @Test
    @DisplayName("still needs a locality and a rent when it is not hunting")
    void aHousedGroupStillNeedsItsFlat() throws Exception {
        User host = user("9811000404", "Housed Host");
        mvc.perform(post(Routes.Flatmates.GROUPS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"We have a flat\",\"name\":\"Ravi\",\"seats\":3}"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    @DisplayName("can find its flat: an edit without preferences turns it into a housed group")
    void anEditSettlesIt() throws Exception {
        User host = user("9811000405", "Hunter Five");
        String id = create(host, huntingBody("\"Aundh\",\"Baner\"", "\"2\"", 30000, 45000));

        mvc.perform(patch(Routes.Flatmates.GROUP_BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"Three of us, hunting","policy":"any","seats":3,
                                 "seatsOpen":1,"name":"Asha","locality":"Baner","rent":42000,
                                 "deposit":84000}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.locality").value("Baner"))
                .andExpect(jsonPath("$.rent").value(42000))
                .andExpect(jsonPath("$.deposit").value(84000))
                .andExpect(jsonPath("$.preferences").doesNotExist());
    }
}
