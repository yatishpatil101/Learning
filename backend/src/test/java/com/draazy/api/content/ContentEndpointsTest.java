package com.draazy.api.content;

import com.draazy.api.support.AbstractApiTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.junit.jupiter.api.Test;

// Contract + behaviour proof for the CMS / editorial content endpoints (slice 8f): announcements, services, FAQs, and
// Invariant 6: all four answer without any Authorization header (200), and exclude archived rows.
class ContentEndpointsTest extends AbstractApiTest {

    @Test
    void faqs_excludesArchived() throws Exception {
        jdbc.update("insert into faqs (question, answer, archived) values ('Q1', 'A1', false)");
        jdbc.update("insert into faqs (question, answer, archived) values ('Q2', 'A2', true)");

        mvc.perform(get("/faqs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.question == 'Q1')]").exists())
                .andExpect(jsonPath("$[?(@.question == 'Q2')]").doesNotExist());
    }

    @Test
    void faqs_contractShape() throws Exception {
        jdbc.update("insert into faqs (question, answer, category, archived) values ('How?', 'Like this', 'general', false)");

        mvc.perform(get("/faqs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.question == 'How?')].id").exists())
                .andExpect(jsonPath("$[?(@.question == 'How?')].answer").value("Like this"))
                .andExpect(jsonPath("$[?(@.question == 'How?')].category").value("general"));
    }

    @Test
    void faqs_orderedByCategoryThenCreation() throws Exception {
        jdbc.update("insert into faqs (question, answer, category, archived, created_at) "
                + "values ('FAQ order second', 'A2', 'zz-test-order', false, ?)",
                java.sql.Timestamp.from(Instant.now().minus(1, ChronoUnit.HOURS)));
        jdbc.update("insert into faqs (question, answer, category, archived, created_at) "
                + "values ('FAQ order first', 'A1', 'yy-test-order', false, ?)",
                java.sql.Timestamp.from(Instant.now()));

        String json = mvc.perform(get("/faqs"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<String> questions = JsonPath.read(json, "$[*].question");
        assertThat(questions.indexOf("FAQ order first"))
                .isLessThan(questions.indexOf("FAQ order second"));
    }
}
