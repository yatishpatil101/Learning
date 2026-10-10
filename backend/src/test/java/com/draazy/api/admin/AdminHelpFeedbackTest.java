package com.draazy.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;

@DisplayName("/admin/help-feedback — article verdicts and comments")
class AdminHelpFeedbackTest extends AbstractApiTest {

    private static final String FORMULA = "=HYPERLINK(\"http://evil.test\",\"click\")";

    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;

    private final String slug = "fb-it-" + System.nanoTime();

    private String bearer(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Feedback " + mobile.substring(6));
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
    }

    private void vote(String lang, boolean helpful, String comment) {
        jdbc.update("INSERT INTO help_article_feedback (slug, lang, helpful, comment) VALUES (?, ?, ?, ?)",
                slug, lang, helpful, comment);
    }

    @Test
    @DisplayName("verdicts and comments are counted apart, per language, and the comment is returned verbatim")
    void countsVerdictsAndCommentsApart() throws Exception {
        vote("en", true, null);
        vote("en", false, null);
        vote("en", false, FORMULA);
        vote("mr", false, "<b>not clear</b>");
        String admin = bearer("9877730001", Roles.Wire.ADMIN);

        mvc.perform(get(Routes.Admin.HELP_FEEDBACK).param("size", "100")
                        .header(HttpHeaders.AUTHORIZATION, admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.slug=='" + slug + "' && @.lang=='en')].helpful").value(1))
                .andExpect(jsonPath("$.content[?(@.slug=='" + slug + "' && @.lang=='en')].notHelpful").value(2))
                .andExpect(jsonPath("$.content[?(@.slug=='" + slug + "' && @.lang=='en')].comments").value(1))
                .andExpect(jsonPath("$.content[?(@.slug=='" + slug + "' && @.lang=='mr')].comments").value(1));

        mvc.perform(get(Routes.Admin.HELP_FEEDBACK_COMMENTS).param("slug", slug)
                        .header(HttpHeaders.AUTHORIZATION, admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", hasSize(2)))
                .andExpect(jsonPath("$.content[?(@.lang=='en')].comment").value(FORMULA))
                .andExpect(jsonPath("$.content[?(@.lang=='mr')].comment").value("<b>not clear</b>"))
                .andExpect(content().string(not(containsString("userId"))))
                .andExpect(content().string(not(containsString("ipHash"))));
    }

    @Test
    @DisplayName("articles with enough votes come first by share not helpful; a single early thumbs-down does not top the list")
    void ranksByShareWithAVoteFloor() throws Exception {
        String busy = slug + "-busy";
        String bad = slug + "-bad";
        String thin = slug + "-thin";
        for (int i = 0; i < 10; i++) {
            jdbc.update("INSERT INTO help_article_feedback (slug, lang, helpful) VALUES (?, 'en', ?)", busy, i >= 3);
        }
        for (int i = 0; i < 5; i++) {
            jdbc.update("INSERT INTO help_article_feedback (slug, lang, helpful) VALUES (?, 'en', ?)", bad, i == 0);
        }
        jdbc.update("INSERT INTO help_article_feedback (slug, lang, helpful) VALUES (?, 'en', false)", thin);

        String body = mvc.perform(get(Routes.Admin.HELP_FEEDBACK).param("size", "100")
                        .header(HttpHeaders.AUTHORIZATION, bearer("9877730005", Roles.Wire.ADMIN)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body.indexOf(bad)).isPositive().isLessThan(body.indexOf(busy));
        assertThat(body.indexOf(busy)).isLessThan(body.indexOf(thin));
    }

    @Test
    @DisplayName("a slug that is not an article key is a 400")
    void rejectsMalformedSlug() throws Exception {
        mvc.perform(get(Routes.Admin.HELP_FEEDBACK_COMMENTS).param("slug", "a/../b")
                        .header(HttpHeaders.AUTHORIZATION, bearer("9877730002", Roles.Wire.ADMIN)))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("managers and staff are refused: the comments are readers' own words")
    void adminOnly() throws Exception {
        String manager = bearer("9877730003", Roles.Wire.MANAGER);
        String staff = bearer("9877730004", Roles.Wire.STAFF);
        for (String path : new String[] {Routes.Admin.HELP_FEEDBACK, Routes.Admin.HELP_FEEDBACK_COMMENTS}) {
            mvc.perform(get(path).header(HttpHeaders.AUTHORIZATION, manager))
                    .andExpect(status().isForbidden());
            mvc.perform(get(path).header(HttpHeaders.AUTHORIZATION, staff))
                    .andExpect(status().isForbidden());
        }
        mvc.perform(get(Routes.Admin.HELP_FEEDBACK))
                .andExpect(status().isUnauthorized());
    }
}
