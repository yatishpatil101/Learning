package com.draazy.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.support.AbstractApiTest;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("Manager role migration")
class ManagerRoleMigrationTest extends AbstractApiTest {

    @Test
    void managerIsAcceptedByEveryRoleCheckConstraint() {
        assertThat(constraint("users_role_check")).contains("'manager'");
        assertThat(constraint("audit_log_actor_role_check")).contains("'manager'");
        assertThat(constraint("messages_author_role_check")).contains("'manager'");
        assertThat(constraint("service_request_messages_author_role_check")).contains("'manager'");
        assertThat(constraint("support_ticket_messages_author_role_check")).contains("'manager'");
    }

    @Test
    void functionMigrationNeverWidensStoredAccess() throws Exception {
        jdbc.update("""
                INSERT INTO users (id, mobile, role, team, status, archived) VALUES
                  ('00000000-0000-0000-0000-00000000a901', '9866090001', 'admin', NULL, 'active', false),
                  ('00000000-0000-0000-0000-00000000a902', '9866090002', 'staff', 'legal', 'active', false),
                  ('00000000-0000-0000-0000-00000000a903', '9866090003', 'staff', 'loans', 'active', false),
                  ('00000000-0000-0000-0000-00000000a904', '9866090004', 'staff', 'rental', 'active', false)
                """);
        jdbc.update("""
                INSERT INTO back_office_permissions (user_id, permissions) VALUES
                  ('00000000-0000-0000-0000-00000000a901', '["settings:read","users:write"]'),
                  ('00000000-0000-0000-0000-00000000a902',
                   '["services:read","identity:read","identity:write","properties:read","properties:write"]'),
                  ('00000000-0000-0000-0000-00000000a904', '["services:read","services:write","tickets:read"]')
                """);
        jdbc.execute(new String(getClass()
                .getResourceAsStream("/db/migration/V90__DML_back_office_permission_functions.sql")
                .readAllBytes(), StandardCharsets.UTF_8));

        assertThat(functions("a901")).as("admin documents are dropped, never narrowed").isNull();
        assertThat(functions("a902")).as("a function needs every one of its atoms; read-only stays out")
                .isEqualTo("[\"propertyVerification\", \"listingModeration\"]");
        assertThat(functions("a904")).isEqualTo("[\"desk:rental\"]");
        assertThat(functions("a903")).as("undocumented staff keep their old reach: own desk, never kyc")
                .contains("\"desk:loans\"", "\"support\"")
                .doesNotContain("desk:rental", "desk:legal", "kyc");
    }

    private String functions(String suffix) {
        return jdbc.query("SELECT permissions::text FROM back_office_permissions WHERE user_id = ?::uuid",
                rs -> rs.next() ? rs.getString(1) : null, "00000000-0000-0000-0000-00000000" + suffix);
    }

    private String constraint(String name) {
        return jdbc.queryForObject(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = ?",
                String.class, name);
    }
}
