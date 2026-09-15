package com.draazy.api.moderation;

import com.draazy.api.support.AbstractApiTest;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import static org.assertj.core.api.Assertions.assertThat;

class LifecycleBackfillTest extends AbstractApiTest {
    @Test void migrationBackfillsOnlyKnownFactsAndKeepsExistingMessageIds() {
        // Temporary tables shadow the real ones only on this rollback-bound connection.
        jdbc.execute("create temporary table properties (id uuid primary key, posted_by_admin boolean, "
                + "status text, archived boolean, images jsonb)");
        jdbc.execute("create temporary table documents (property_id uuid, service_request_id uuid)");
        jdbc.execute("create temporary table review_messages (id uuid, review_id uuid, internal boolean, read_at timestamptz)");
        UUID owner = row(false, "pending", false, "[]");
        UUID staff = row(true, "pending", false, "[]");
        UUID live = row(true, "approved", false, "[]");
        UUID archived = row(false, "approved", true, "[]");
        UUID photographed = row(true, "pending", false, "[\"photo\"]");
        UUID documented = row(true, "pending", false, "[]");
        UUID sold = row(false, "sold", false, "[]");
        jdbc.update("insert into documents values (?,null)", documented);
        UUID message = UUID.randomUUID();
        jdbc.update("insert into review_messages values (?, ?, false, null)", message, UUID.randomUUID());
        jdbc.execute((ConnectionCallback<Void>) connection -> {
            ScriptUtils.executeSqlScript(connection,
                    new ClassPathResource("db/migration/V22__DDL_property_review_lifecycle.sql"));
            return null;
        });
        assertThat(stage(owner)).isEqualTo("submitted");
        assertThat(stage(staff)).isNull();
        assertThat(stage(live)).isEqualTo("live");
        assertThat(stage(archived)).isNull();
        assertThat(stage(photographed)).isEqualTo("photos_docs");
        assertThat(stage(documented)).isEqualTo("photos_docs");
        assertThat(stage(sold)).isNull();
        assertThat(jdbc.queryForObject("select lifecycle_track from properties where id=?", String.class, staff))
                .isEqualTo("staff");
        assertThat(jdbc.queryForObject("select id from review_messages", UUID.class)).isEqualTo(message);
        assertThat(jdbc.queryForObject("select clarification_requested from review_messages", Boolean.class)).isFalse();
        assertThat(jdbc.queryForObject("select count(*) from properties where lifecycle_verified_at is not null", Long.class))
                .isZero();
    }

    private UUID row(boolean staff, String status, boolean archived, String images) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into properties values (?,?,?,?,?::jsonb)", id, staff, status, archived, images);
        return id;
    }

    private String stage(UUID id) {
        return jdbc.queryForObject("select lifecycle_stage from properties where id=?", String.class, id);
    }
}