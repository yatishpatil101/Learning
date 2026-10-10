package com.draazy.api.engagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

/** {@code followedByMe} only answers for societies already in hand, so the dashboard and finder need this read;
 * ordering is newest follow first, and the cards are the directory's own shape. */
@DisplayName("Societies — which ones do I follow?")
class SocietyFollowListTest extends AbstractApiTest {

    private static final String PATH = "/me/societies/following";

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;

    private User user(String mobile) {
        User u = new User(mobile, "buyer");
        u.setName("Follower " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /** Any three seeded societies: named slugs would tie these tests to demo seed data, which is not contract. */
    private List<String> someSocieties(int n) {
        List<String> slugs = jdbc.queryForList(
                "select slug from societies order by slug limit ?", String.class, n);
        assertThat(slugs).as("seeded societies to follow").hasSize(n);
        return slugs;
    }

    private void follow(User u, String slug) throws Exception {
        mvc.perform(put("/me/societies/" + slug + "/follow")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNoContent());
    }

    /** Backdated because two follows in one test often share a millisecond, so ordering checks pass by luck. */
    private void followedAgo(User u, String slug, int minutes) {
        jdbc.update("""
                update society_follows set created_at = ?
                where user_id = ? and society_id = (select id from societies where slug = ?)""",
                Timestamp.from(Instant.now().minus(minutes, ChronoUnit.MINUTES)), u.getId(), slug);
    }

    /** The dashboard row: what it draws, nothing the directory card carries beyond that. */
    @Test
    @DisplayName("a follow made through the toggle is readable as a slim dashboard row")
    void followThenRead() throws Exception {
        User a = user("9821200002");
        User b = user("9821200009");
        String slug = someSocieties(1).get(0);

        follow(a, slug);
        follow(b, slug);

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(a)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].slug").value(slug))
                .andExpect(jsonPath("$.content[0].name").isNotEmpty())
                .andExpect(jsonPath("$.content[0].listingCount").exists())
                .andExpect(jsonPath("$.content[0].followerCount").doesNotExist())
                .andExpect(jsonPath("$.content[0].id").doesNotExist())
                .andExpect(jsonPath("$.content[0].lat").doesNotExist())
                .andExpect(jsonPath("$.content[0].rera").doesNotExist())
                .andExpect(jsonPath("$.content[0].reviewCount").doesNotExist());
    }
    @Test
    @DisplayName("the most recent follow comes first — a follow made just now is not buried")
    void newestFollowFirst() throws Exception {
        User u = user("9821200003");
        List<String> slugs = someSocieties(3);
        for (String slug : slugs) {
            follow(u, slug);
        }
        // Reverse the natural (alphabetical) order of the slugs, so an accidental order-by-slug
        // or an order-by-nothing that happens to return insertion order both fail.
        followedAgo(u, slugs.get(0), 30);
        followedAgo(u, slugs.get(1), 20);
        followedAgo(u, slugs.get(2), 10);

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].slug").value(slugs.get(2)))
                .andExpect(jsonPath("$.content[1].slug").value(slugs.get(1)))
                .andExpect(jsonPath("$.content[2].slug").value(slugs.get(0)));
    }

    @Test
    @DisplayName("a follow of a merged-away society reads as its survivor, once")
    void mergedAwayFollowReadsAsSurvivor() throws Exception {
        User u = user("9821200012");
        List<String> slugs = someSocieties(2);
        follow(u, slugs.get(0));
        follow(u, slugs.get(1));
        jdbc.update("""
                update societies set merged_into = (select id from societies where slug = ?),
                       merged_at = now(), merged_by = ? where slug = ?""", slugs.get(1), u.getId(), slugs.get(0));
        try {
            mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalElements").value(1))
                    .andExpect(jsonPath("$.content.length()").value(1))
                    .andExpect(jsonPath("$.content[0].slug").value(slugs.get(1)));
        } finally {
            jdbc.update("update societies set merged_into = null, merged_at = null, merged_by = null where slug = ?",
                    slugs.get(0));
        }
    }

    @Test
    @DisplayName("unfollowing removes it from the list")
    void unfollowRemovesIt() throws Exception {
        User u = user("9821200004");
        String slug = someSocieties(1).get(0);

        follow(u, slug);
        mvc.perform(delete("/me/societies/" + slug + "/follow")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNoContent());

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    @DisplayName("one caller's follows are not another's")
    void callerScoped() throws Exception {
        User a = user("9821200005");
        User b = user("9821200006");
        String slug = someSocieties(1).get(0);

        follow(a, slug);

        // A caller who follows nothing gets an empty page, not a 404.
        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(b)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0))
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    /** Paged because nothing caps how many societies one person may follow, and api-standards.md §5.1
     * permits an array only where growth is bounded. */
    @Test
    @DisplayName("the list is paged — a small page still reports the full total")
    void pagedNotBareArray() throws Exception {
        User u = user("9821200007");
        List<String> slugs = someSocieties(3);
        for (String slug : slugs) {
            follow(u, slug);
        }

        mvc.perform(get(PATH + "?page=0&size=2").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.page").value(0));

        mvc.perform(get(PATH + "?page=1&size=2").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(3));
    }

    /** {@code /me/societies/{slug}/follow} has a segment after the variable, so the literal
     * cannot be swallowed by it; proved from both directions. */
    @Test
    @DisplayName("the literal path does not collide with the slug-shaped toggle route")
    void doesNotCollideWithTheToggle() throws Exception {
        User u = user("9821200011");

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk());

        // There is no society called "following", and asking to follow it must still 404 rather
        // than resolving against the list route.
        mvc.perform(put("/me/societies/following/follow")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("an anonymous caller has no follows to read")
    void anonymousIsRefused() throws Exception {
        mvc.perform(get(PATH)).andExpect(status().isUnauthorized());
    }
}
