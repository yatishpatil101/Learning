package com.draazy.api.engagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@DisplayName("Societies — the hub read: five community sections, one request")
class SocietyHubTest extends AbstractApiTest {

    @Autowired UserRepository users;

    // Mobile block 98730000xx is used by no other test class; class rollback removes the rows.
    private User user(String mobile, String name) {
        User u = new User(mobile, Roles.Wire.BUYER);
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private String staff(String mobile) {
        User u = new User(mobile, Roles.Wire.STAFF);
        u.setName("Ops " + mobile.substring(6));
        u.setMobileVerified(true);
        return bearer(users.saveAndFlush(u));
    }

    private String society(int offset) {
        List<String> slugs = jdbc.queryForList(
                "select slug from societies where source <> 'community' order by slug offset ? limit 1",
                String.class, offset);
        assertThat(slugs).as("a seeded society at offset " + offset).hasSize(1);
        return slugs.get(0);
    }

    private String idOf(ResultActions r) throws Exception {
        String json = r.andReturn().getResponse().getContentAsString();
        int at = json.indexOf("\"id\":\"") + 6;
        return json.substring(at, json.indexOf('"', at));
    }

    private ResultActions write(MockHttpServletRequestBuilder req, String auth, String json)
            throws Exception {
        return mvc.perform(req.header(HttpHeaders.AUTHORIZATION, auth)
                .contentType(MediaType.APPLICATION_JSON).content(json));
    }

    private ResultActions postTo(String slug, String path, String auth, String json)
            throws Exception {
        return write(post("/societies/" + slug + path), auth, json);
    }

    private void makeResident(User u, String slug, String flat, String reviewer) throws Exception {
        String id = idOf(postTo(slug, "/residents", bearer(u),
                "{\"flat\":\"" + flat + "\",\"relation\":\"owner\"}").andExpect(status().isOk()));
        write(patch("/societies/" + slug + "/residents/" + id), reviewer,
                "{\"status\":\"verified\"}").andExpect(status().isOk());
    }

    private void makeCommittee(User u, String slug) throws Exception {
        String claimId = idOf(postTo(slug, "/claim", bearer(u),
                "{\"name\":\"Committee Member\",\"role\":\"Hon. Secretary\","
                        + "\"email\":\"sec@example.com\"}").andExpect(status().isOk()));
        write(patch("/admin/society-claims/" + claimId), staff("9873000090"),
                "{\"status\":\"approved\"}").andExpect(status().isOk());
    }

    private void seed(String slug, User author, String ops) throws Exception {
        makeResident(author, slug, "101", ops);
        postTo(slug, "/questions", bearer(author), "{\"body\":\"Is water metered?\"}")
                .andExpect(status().isCreated());
        postTo(slug, "/board", bearer(author), "{\"kind\":\"notice\",\"title\":\"Tank cleaning\"}")
                .andExpect(status().isCreated());
        postTo(slug, "/contributions", bearer(author),
                "{\"kind\":\"pick\",\"body\":\"Reliable electrician\","
                        + "\"referralName\":\"Vishal\",\"referralContact\":\"9822001122\"}")
                .andExpect(status().isCreated());
    }

    private ResultActions hub(String slug, String auth) throws Exception {
        MockHttpServletRequestBuilder req = get("/societies/" + slug + "/hub");
        return mvc.perform(auth == null ? req : req.header(HttpHeaders.AUTHORIZATION, auth));
    }

    @Test
    @DisplayName("an anonymous reader gets every section: the public facts, no personal parts")
    void anonymousGetsAllFiveSections() throws Exception {
        String slug = society(20);
        seed(slug, user("9873000001", "Author"), staff("9873000002"));

        hub(slug, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.membership.societySlug").value(slug))
                .andExpect(jsonPath("$.membership.resident").value(nullValue()))
                .andExpect(jsonPath("$.membership.admin").value(false))
                .andExpect(jsonPath("$.membership.verifiedResidents").value(1))
                .andExpect(jsonPath("$.questions.totalElements").value(1))
                .andExpect(jsonPath("$.questions.content[0].body").value("Is water metered?"))
                .andExpect(jsonPath("$.board.content[0].title").value("Tank cleaning"))
                .andExpect(jsonPath("$.board.content[0].canRemove").value(false))
                .andExpect(jsonPath("$.contributions.content[0].referralName").value("Vishal"))
                .andExpect(jsonPath("$.contributions.content[0].referralContact").doesNotExist())
                .andExpect(jsonPath("$.contributions.content[0].helpfulByMe").value(false))
                .andExpect(jsonPath("$.proposals.pending").isArray())
                .andExpect(jsonPath("$.proposals.whatsappJoinUrl").doesNotExist());
    }

    @Test
    @DisplayName("a verified resident is known to the membership and sees the withheld contact")
    void memberSections() throws Exception {
        String slug = society(21);
        String ops = staff("9873000003");
        User author = user("9873000004", "Author");
        seed(slug, author, ops);
        User neighbour = user("9873000005", "Neighbour");
        makeResident(neighbour, slug, "102", ops);

        hub(slug, bearer(neighbour))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.membership.resident.status").value("verified"))
                .andExpect(jsonPath("$.membership.admin").value(false))
                .andExpect(jsonPath("$.membership.verifiedResidents").value(2))
                .andExpect(jsonPath("$.board.content[0].canRemove").value(false))
                .andExpect(jsonPath("$.contributions.content[0].canRemove").value(false))
                .andExpect(jsonPath("$.contributions.content[0].referralContact")
                        .value("9822001122"));

        hub(slug, bearer(author))
                .andExpect(jsonPath("$.board.content[0].canRemove").value(true))
                .andExpect(jsonPath("$.contributions.content[0].canRemove").value(true));
    }

    @Test
    @DisplayName("the committee is admin and may remove other people's notices")
    void committeeSections() throws Exception {
        String slug = society(22);
        User committee = user("9873000006", "Committee");
        seed(slug, user("9873000007", "Author"), staff("9873000008"));
        makeCommittee(committee, slug);

        hub(slug, bearer(committee))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.membership.admin").value(true))
                .andExpect(jsonPath("$.membership.claim.status").value("approved"))
                .andExpect(jsonPath("$.board.content[0].canRemove").value(true));
    }

    @Test
    @DisplayName("staff without the content function are not offered moderation, and are not refused")
    void staffWithoutTheFunction() throws Exception {
        String slug = society(23);
        seed(slug, user("9873000009", "Author"), staff("9873000010"));

        User desk = new User("9873000011", Roles.Wire.STAFF);
        desk.setName("Desk");
        desk.setMobileVerified(true);
        desk = users.saveAndFlush(desk);
        jdbc.update("insert into back_office_permissions (user_id, permissions) "
                + "values (?::uuid, '[]'::jsonb)", desk.getId().toString());

        hub(slug, bearer(desk))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.board.content[0].canRemove").value(false))
                .andExpect(jsonPath("$.contributions.content[0].canRemove").value(false))
                .andExpect(jsonPath("$.membership.societySlug").value(slug));
    }

    @Test
    @DisplayName("an unknown society is a 404 for the whole read")
    void unknownSociety() throws Exception {
        hub("no-such-society-anywhere", null).andExpect(status().isNotFound());
        hub("no-such-society-anywhere", bearer(user("9873000012", "Lost")))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a section that is refused is null while the others are still present")
    void aRefusedSectionIsNullNotTheWholeRead() throws Exception {
        String slug = society(24);
        seed(slug, user("9873000013", "Author"), staff("9873000014"));

        mvc.perform(get("/societies/" + slug + "/hub").param("kind", "rumour"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.board").value(nullValue()))
                .andExpect(jsonPath("$.membership.societySlug").value(slug))
                .andExpect(jsonPath("$.questions.totalElements").value(1))
                .andExpect(jsonPath("$.contributions.totalElements").value(1))
                .andExpect(jsonPath("$.proposals.pending").isArray());
    }

    @Test
    @DisplayName("kind narrows only the board; page and size apply to the paged sections, clamped")
    void paging() throws Exception {
        String slug = society(25);
        User author = user("9873000015", "Author");
        seed(slug, author, staff("9873000016"));
        postTo(slug, "/questions", bearer(author), "{\"body\":\"Second question?\"}")
                .andExpect(status().isCreated());
        postTo(slug, "/board", bearer(author),
                "{\"kind\":\"event\",\"title\":\"AGM\",\"eventDate\":\"2030-01-15\"}")
                .andExpect(status().isCreated());

        mvc.perform(get("/societies/" + slug + "/hub").param("kind", "notice"))
                .andExpect(jsonPath("$.board.totalElements").value(1))
                .andExpect(jsonPath("$.questions.totalElements").value(2));

        mvc.perform(get("/societies/" + slug + "/hub").param("page", "0").param("size", "1"))
                .andExpect(jsonPath("$.questions.content.length()").value(1))
                .andExpect(jsonPath("$.questions.totalElements").value(2))
                .andExpect(jsonPath("$.board.content.length()").value(1))
                .andExpect(jsonPath("$.contributions.content.length()").value(1));

        mvc.perform(get("/societies/" + slug + "/hub").param("page", "0").param("size", "500"))
                .andExpect(jsonPath("$.questions.size").value(100))
                .andExpect(jsonPath("$.questions.content.length()").value(2));
    }
}
