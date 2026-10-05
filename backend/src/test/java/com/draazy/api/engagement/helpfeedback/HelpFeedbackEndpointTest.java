package com.draazy.api.engagement.helpfeedback;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.support.AbstractApiTest;
import java.time.Instant;
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

    private void send(String slug, String ip) throws Exception {
        mvc.perform(post("/help/feedback")
                        .with(request -> {
                            request.setRemoteAddr(ip);
                            return request;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"" + slug + "\",\"lang\":\"en\",\"helpful\":false}"))
                .andExpect(status().isAccepted());
    }
}
