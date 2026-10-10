package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.moderation.report.Report;
import com.draazy.api.moderation.report.ReportRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import com.draazy.api.support.AbstractApiTest;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("An upheld report against a flatmate post takes it down")
class FlatmateReportEnforcementTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired FlatmateSeekerPostRepository posts;
    @Autowired FlatmateGroupRepository groups;
    @Autowired ReportRepository reports;

    private UUID staffId;

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        if (staffId != null) {
            jdbc.update("delete from audit_log where actor = ?", staffId.toString());
        }
    }

    @Test
    @DisplayName("hide_content marks a reported seeker post removed and tells its author")
    void seekerPost() throws Exception {
        User author = saveUser("9800000251", Roles.Wire.BUYER);
        User staff = saveStaff("9800000252");
        UUID postId = posts.saveAndFlush(new FlatmateSeekerPost(author.getId(), "Seeker", 15_000L)).getId();
        Report filed = file(author, postId);

        triage(staff, filed).andExpect(status().isOk());

        assertThat(jdbc.queryForObject("select mod_status from flatmate_seeker_posts where id = ?",
                String.class, postId)).isEqualTo("removed");
        assertThat(jdbc.queryForObject(
                "select count(*) from notifications where user_id = ? and type = 'flatmate.moderated.removed'",
                Integer.class, author.getId())).isEqualTo(1);
    }

    @Test
    @DisplayName("the same verb reaches a reported group, whose id is not a post id")
    void group() throws Exception {
        User host = saveUser("9800000253", Roles.Wire.BUYER);
        User staff = saveStaff("9800000254");
        FlatmateGroup group = new FlatmateGroup(host.getId(), "Two seats in Baner", "Baner", 12_000L);
        group.addMember(new FlatmateGroupMember("Host", host.getId(), true));
        UUID groupId = groups.saveAndFlush(group).getId();
        Report filed = file(host, groupId);

        triage(staff, filed).andExpect(status().isOk());

        assertThat(jdbc.queryForObject("select mod_status from flatmate_groups where id = ?",
                String.class, groupId)).isEqualTo("removed");
    }

    private Report file(User reporter, UUID targetId) {
        return reports.saveAndFlush(
                new Report("post", targetId.toString(), reporter.getId(), "fake", "details"));
    }

    private org.springframework.test.web.servlet.ResultActions triage(User staff, Report filed)
            throws Exception {
        return mvc.perform(patch("/reports/{id}", filed.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"actioned\",\"note\":\"upheld\",\"enforcement\":\"hide_content\"}"));
    }

    private User saveUser(String mobile, String role) {
        User user = new User(mobile, role);
        user.setName("Tester");
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private User saveStaff(String mobile) {
        User staff = saveUser(mobile, Roles.Wire.STAFF);
        staff.setTeam(Teams.RENTAL);
        users.saveAndFlush(staff);
        jdbc.update("""
                INSERT INTO back_office_permissions (user_id, permissions)
                VALUES (?::uuid, ?::jsonb)
                ON CONFLICT (user_id) DO UPDATE SET permissions = EXCLUDED.permissions
                """, staff.getId().toString(), "[\"reports\",\"flatmates\",\"desk:rental\"]");
        staffId = staff.getId();
        return staff;
    }
}
