package com.punenest.api.engagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
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

/**
 * D227 — {@code GET /me/societies/following}: which societies does this caller follow?
 *
 * <p>The two writes on this table shipped in slice 8 and were never called once. The browser kept
 * its own {@code pnFollowedSocieties} array instead, so following a society on a laptop did not
 * follow it on a phone, and the follower count on the hub counted nobody. The missing piece was
 * never a write — it was this read. {@code followedByMe} can only answer "do I follow this one?"
 * for societies the caller already has in hand, and the dashboard panel, the dashboard tile and the
 * society finder all ask the question with no page of societies to scope it to.
 *
 * <p>The assertions that carry weight here are ordering (newest follow first, because a follow made
 * ten seconds ago must not be buried), the envelope (paged, not a bare array), caller-scoping, and
 * that the cards are the directory's cards rather than a second, thinner shape assembled here.
 */
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

    /**
     * Three seeded societies, whichever they are.
     *
     * <p>Named slugs would tie these tests to the demo seed, and the seed is data rather than
     * contract — a curation pass that renames a building should not turn this file red.
     */
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

    /**
     * Pin a follow's age.
     *
     * <p>Two follows made in the same test land within the same millisecond often enough that an
     * ordering assertion on {@code now()} passes by luck. Backdating one of them makes the
     * assertion about the ordering rather than about the clock.
     */
    private void followedAgo(User u, String slug, int minutes) {
        jdbc.update("""
                update society_follows set created_at = ?
                where user_id = ? and society_id = (select id from societies where slug = ?)""",
                Timestamp.from(Instant.now().minus(minutes, ChronoUnit.MINUTES)), u.getId(), slug);
    }

    @Test
    @DisplayName("a caller who follows nothing gets an empty page, not a 404")
    void emptyByDefault() throws Exception {
        User u = user("9821200001");
        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0))
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    @DisplayName("a follow made through the toggle is readable through the list")
    void followThenRead() throws Exception {
        User u = user("9821200002");
        String slug = someSocieties(1).get(0);

        follow(u, slug);

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].slug").value(slug))
                .andExpect(jsonPath("$.content[0].name").isNotEmpty());
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

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(b)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    /**
     * The reason this is paged rather than a bare array: nothing caps how many societies one person
     * may follow, and {@code api-standards.md} §5.1 only permits an array where growth is bounded.
     */
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

    /**
     * A card here must be the card the directory renders. If this endpoint assembled its own,
     * thinner shape, the same society would show a different follower count or lose its star
     * depending on which screen you found it on — and the drift would be silent.
     */
    @Test
    @DisplayName("the cards carry the directory's aggregates, not a thinner shape")
    void cardsMatchTheDirectory() throws Exception {
        User a = user("9821200008");
        User b = user("9821200009");
        String slug = someSocieties(1).get(0);

        follow(a, slug);
        follow(b, slug);

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(a)))
                .andExpect(status().isOk())
                // Everyone's follows, not just the caller's — the same count the hub shows.
                .andExpect(jsonPath("$.content[0].followerCount").value(2))
                .andExpect(jsonPath("$.content[0].listingCount").exists())
                .andExpect(jsonPath("$.content[0].reviewCount").exists());
    }

    /**
     * Computed, not assumed. Hard-coding {@code true} here would make this the one endpoint that
     * cannot report a follow removed on another device — which is the exact bug the route exists to
     * fix.
     */
    @Test
    @DisplayName("followedByMe is computed, so it agrees with the row it is attached to")
    void followedByMeIsComputed() throws Exception {
        User u = user("9821200010");
        String slug = someSocieties(1).get(0);

        follow(u, slug);

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].followedByMe").value(true));
    }

    /**
     * {@code /me/societies/{slug}/follow} has a further segment after the variable, so the literal
     * cannot be swallowed by it. Proved from both directions.
     */
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
