package com.punenest.api.content;

import com.punenest.api.support.AbstractApiTest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.Test;

/**
 * Contract + behaviour proof for the CMS / editorial content endpoints (slice 8f):
 * announcements, services, FAQs, and banners.
 *
 * <p>Invariant 6: all four answer without any Authorization header (200), and exclude archived rows.
 * {@code /announcements} additionally excludes inactive and out-of-window rows.
 */
class ContentEndpointsTest extends AbstractApiTest {


    // ========================= Announcements =========================

    @Test
    void announcements_publicNoAuth() throws Exception {
        mvc.perform(get("/announcements"))
                .andExpect(status().isOk());
    }

    @Test
    void announcements_excludesArchived() throws Exception {
        jdbc.update("insert into announcements (title, active, archived) values ('Visible', true, false)");
        jdbc.update("insert into announcements (title, active, archived) values ('Archived', true, true)");

        mvc.perform(get("/announcements"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.title == 'Archived')]").doesNotExist());
    }

    @Test
    void announcements_excludesInactive() throws Exception {
        jdbc.update("insert into announcements (title, active, archived) values ('Active', true, false)");
        jdbc.update("insert into announcements (title, active, archived) values ('Inactive', false, false)");

        mvc.perform(get("/announcements"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.title == 'Inactive')]").doesNotExist());
    }

    @Test
    void announcements_excludesOutOfWindow() throws Exception {
        Instant past = Instant.now().minus(2, ChronoUnit.DAYS);
        Instant future = Instant.now().plus(2, ChronoUnit.DAYS);
        Instant farPast = Instant.now().minus(10, ChronoUnit.DAYS);
        Instant nearPast = Instant.now().minus(1, ChronoUnit.DAYS);

        // In window
        jdbc.update("insert into announcements (title, active, archived, starts_at, ends_at) values ('InWindow', true, false, ?, ?)",
                java.sql.Timestamp.from(past), java.sql.Timestamp.from(future));
        // Ended
        jdbc.update("insert into announcements (title, active, archived, starts_at, ends_at) values ('Ended', true, false, ?, ?)",
                java.sql.Timestamp.from(farPast), java.sql.Timestamp.from(nearPast));
        // Not started
        jdbc.update("insert into announcements (title, active, archived, starts_at, ends_at) values ('NotStarted', true, false, ?, ?)",
                java.sql.Timestamp.from(future), java.sql.Timestamp.from(future.plus(5, ChronoUnit.DAYS)));

        mvc.perform(get("/announcements"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.title == 'InWindow')]").exists())
                .andExpect(jsonPath("$[?(@.title == 'Ended')]").doesNotExist())
                .andExpect(jsonPath("$[?(@.title == 'NotStarted')]").doesNotExist());
    }

    @Test
    void announcements_contractShape() throws Exception {
        jdbc.update("insert into announcements (title, body, severity, active, archived) values ('Test', 'Body', 'info', true, false)");

        mvc.perform(get("/announcements"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.title == 'Test')].id").exists())
                .andExpect(jsonPath("$[?(@.title == 'Test')].body").value("Body"))
                .andExpect(jsonPath("$[?(@.title == 'Test')].severity").value("info"));
    }

    // ========================= Services =========================

    @Test
    void services_publicNoAuth() throws Exception {
        mvc.perform(get("/services"))
                .andExpect(status().isOk());
    }

    @Test
    void services_excludesArchived() throws Exception {
        jdbc.update("insert into cms_services (name, archived) values ('Active Svc', false)");
        jdbc.update("insert into cms_services (name, archived) values ('Archived Svc', true)");

        mvc.perform(get("/services"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.name == 'Active Svc')]").exists())
                .andExpect(jsonPath("$[?(@.name == 'Archived Svc')]").doesNotExist());
    }

    @Test
    void services_contractShape() throws Exception {
        jdbc.update("insert into cms_services (name, icon, description, link, archived) values ('Packers', 'truck', 'Move stuff', '/packers', false)");

        mvc.perform(get("/services"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.name == 'Packers')].id").exists())
                .andExpect(jsonPath("$[?(@.name == 'Packers')].icon").value("truck"))
                .andExpect(jsonPath("$[?(@.name == 'Packers')].description").value("Move stuff"))
                .andExpect(jsonPath("$[?(@.name == 'Packers')].link").value("/packers"));
    }

    // ========================= FAQs =========================

    @Test
    void faqs_publicNoAuth() throws Exception {
        mvc.perform(get("/faqs"))
                .andExpect(status().isOk());
    }

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

    // ========================= Banners =========================

    @Test
    void banners_publicNoAuth() throws Exception {
        mvc.perform(get("/banners"))
                .andExpect(status().isOk());
    }

    @Test
    void banners_excludesArchived() throws Exception {
        jdbc.update("insert into banners (headline, position, archived) values ('Live', 1, false)");
        jdbc.update("insert into banners (headline, position, archived) values ('Gone', 2, true)");

        mvc.perform(get("/banners"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.headline == 'Live')]").exists())
                .andExpect(jsonPath("$[?(@.headline == 'Gone')]").doesNotExist());
    }

    @Test
    void banners_orderedByPosition() throws Exception {
        jdbc.update("insert into banners (headline, position, archived) values ('Second', 2, false)");
        jdbc.update("insert into banners (headline, position, archived) values ('First', 1, false)");

        mvc.perform(get("/banners"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].headline").value("First"))
                .andExpect(jsonPath("$[1].headline").value("Second"));
    }

    @Test
    void banners_contractShape() throws Exception {
        jdbc.update("insert into banners (image, link, headline, position, archived) values ('https://img.png', '/promo', 'Sale', 0, false)");

        mvc.perform(get("/banners"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.headline == 'Sale')].id").exists())
                .andExpect(jsonPath("$[?(@.headline == 'Sale')].image").value("https://img.png"))
                .andExpect(jsonPath("$[?(@.headline == 'Sale')].link").value("/promo"))
                .andExpect(jsonPath("$[?(@.headline == 'Sale')].position").value(0));
    }
}
