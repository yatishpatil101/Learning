package com.draazy.api.engagement.helpfeedback;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.support.AbstractApiTest;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

@DisplayName("Help feedback")
class HelpFeedbackEndpointTest extends AbstractApiTest {

    @Autowired
    private HelpFeedbackRepository repository;

    @Test
    @DisplayName("past the per-IP, per-article daily cap a verdict is accepted but not stored")
    void excessFeedbackIsAcceptedButNotStored() throws Exception {
        String slug = "cap-probe-" + System.nanoTime();
        Instant start = Instant.now().minusSeconds(60);

        for (int i = 0; i <= HelpFeedbackService.DAILY_IP_SLUG_LIMIT; i++) {
            send(slug, "203.0.113.55");
        }
        send(slug, "203.0.113.56");

        assertThat(repository.countBySlugAndIpHashAndCreatedAtAfter(
                slug, HelpFeedbackService.hashIp("203.0.113.55"), start))
                .isEqualTo(HelpFeedbackService.DAILY_IP_SLUG_LIMIT);
        assertThat(repository.countBySlugAndIpHashAndCreatedAtAfter(
                slug, HelpFeedbackService.hashIp("203.0.113.56"), start))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("the same reader voting again replaces their verdict and comment instead of adding a row")
    void sameVoterCountsOnce() throws Exception {
        String slug = "once-probe-" + System.nanoTime();
        String voter = UUID.randomUUID().toString();

        send(slug, "203.0.113.70", voter, "{\"helpful\":false}");
        send(slug, "203.0.113.70", voter, "{\"helpful\":false,\"comment\":\"no fee table\"}");
        send(slug, "203.0.113.70", UUID.randomUUID().toString(), "{\"helpful\":true}");

        assertThat(jdbc.queryForList(
                "select helpful, comment from help_article_feedback where slug = ? order by helpful",
                slug)).hasSize(2)
                .first().satisfies(row -> {
                    assertThat(row.get("helpful")).isEqualTo(false);
                    assertThat(row.get("comment")).isEqualTo("no fee table");
                });
    }

    private void send(String slug, String ip) throws Exception {
        send(slug, ip, UUID.randomUUID().toString(), "{\"helpful\":false}");
    }

    private void send(String slug, String ip, String voter, String verdict) throws Exception {
        mvc.perform(post("/help/feedback")
                        .with(request -> {
                            request.setRemoteAddr(ip);
                            return request;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"" + slug + "\",\"lang\":\"en\",\"voter\":\"" + voter + "\","
                                + verdict.substring(1)))
                .andExpect(status().isAccepted());
    }
}
