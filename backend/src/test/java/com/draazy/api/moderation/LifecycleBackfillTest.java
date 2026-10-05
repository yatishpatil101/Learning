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

    @Test void progressMigrationBackfillsFactsFromTheDroppedColumns() {
        jdbc.execute("create temporary table properties (id uuid primary key, posted_by_admin boolean, status text, "
                + "archived boolean, updated_at timestamptz, claim_link_opened_at timestamptz, lifecycle_track text, "
                + "lifecycle_stage text, lifecycle_verified_at timestamptz, pipeline_stage text, handback_milestone text)");
        jdbc.execute("create temporary table property_reviews (id uuid, property_id uuid, status text, "
                + "needs_info_at timestamptz, decided_at timestamptz, reason_code text)");
        jdbc.execute("create temporary table property_review_checklist (review_id uuid, pass boolean, "
                + "checked_by uuid, checked_at timestamptz)");
        UUID submitted = fact(false, "pending", "submitted", null);
        UUID reviewing = fact(false, "pending", "in_review", null);
        UUID asked = fact(false, "pending", "clarification", null);
        UUID sent = fact(true, "pending", "link_sent", null);
        UUID claimed = fact(true, "pending", null, "claimed");
        UUID liveStaff = fact(true, "approved", "live", null);
        UUID flaggedStaff = fact(true, "flagged", "live", null);
        UUID legacyAsk = fact(false, "pending", "clarification", null);
        UUID relisted = fact(false, "pending", "submitted", null);
        review(asked, "needs_info", null);
        review(legacyAsk, "pending", null);
        UUID stale = review(relisted, "approved", "other");
        jdbc.update("insert into property_review_checklist values (?, true, ?, now())", stale, UUID.randomUUID());
        jdbc.execute((ConnectionCallback<Void>) connection -> {
            ScriptUtils.executeSqlScript(connection,
                    new ClassPathResource("db/migration/V81__DDL_listing_progress_facts.sql"));
            return null;
        });
        assertThat(column("review_started_at", submitted)).isNull();
        assertThat(column("review_started_at", reviewing)).isNotNull();
        assertThat(column("info_requested_at", asked)).isNotNull();
        assertThat(column("claim_link_sent_at", sent)).isNotNull();
        assertThat(column("owner_confirmed_at", sent)).isNull();
        assertThat(column("owner_confirmed_at", claimed)).isNotNull();
        assertThat(column("owner_confirmed_at", liveStaff)).isNotNull();
        assertThat(column("owner_confirmed_at", flaggedStaff)).isNotNull();
        assertThat(column("info_requested_at", legacyAsk)).isNotNull();
        assertThat(reviewStatus(legacyAsk)).isEqualTo("needs_info");
        assertThat(reviewStatus(relisted)).isEqualTo("pending");
        assertThat(jdbc.queryForObject("select pass from property_review_checklist", Boolean.class)).isFalse();
    }

    private UUID review(UUID property, String status, String reason) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into property_reviews (id, property_id, status, needs_info_at, decided_at, reason_code) "
                + "values (?, ?, ?, now(), now(), ?)", id, property, status, reason);
        return id;
    }

    private String reviewStatus(UUID property) {
        return jdbc.queryForObject("select status from property_reviews where property_id= ?", String.class, property);
    }

    private UUID fact(boolean staff, String status, String stage, String milestone) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into properties (id, posted_by_admin, status, archived, updated_at, lifecycle_stage, "
                + "handback_milestone) values (?,?,?,false,now(),?,?)", id, staff, status, stage, milestone);
        return id;
    }

    private Object column(String name, UUID id) {
        return jdbc.queryForObject("select " + name + " from properties where id= ?", Object.class, id);
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
