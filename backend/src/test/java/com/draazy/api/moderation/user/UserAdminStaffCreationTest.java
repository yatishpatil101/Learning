package com.draazy.api.moderation.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import com.draazy.api.support.AbstractApiTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

@DisplayName("Back-office staff creation")
@ExtendWith(OutputCaptureExtension.class)
class UserAdminStaffCreationTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    private User admin(String mobile, String email) {
        User user = new User(mobile, Roles.Wire.ADMIN);
        user.setName("Staff create probe " + mobile);
        user.setEmail(email);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private User manager(String mobile, String email) {
        User user = new User(mobile, Roles.Wire.MANAGER);
        user.setName("Manager probe " + mobile);
        user.setEmail(email);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private String field(String json, String name) {
        return json.replaceAll("(?s).*\"" + name + "\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    private String inviteToken(String inviteUrl) {
        return inviteUrl.substring(inviteUrl.indexOf('#') + 1);
    }

    @Test
    @DisplayName("new administrators are refused; the singleton is bootstrapped")
    void adminCreationIsRefused() throws Exception {
        User actor = admin("9866042001", "staff-maker@example.com");

        mvc.perform(post(Routes.Users.STAFF)
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Second Admin","mobile":"9866042002",
                                 "email":"second-admin@example.com","role":"admin"}"""))
                .andExpect(status().isForbidden());

        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM users WHERE email = 'second-admin@example.com'",
                Integer.class)).isZero();
    }

    @Test
    @DisplayName("staff creation still creates an open invite")
    void staffCreationIssuesInvite(CapturedOutput output) throws Exception {
        User actor = admin("9866042003", "staff-maker2@example.com");

        MvcResult result = mvc.perform(post(Routes.Users.STAFF)
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Ops Hire","mobile":"9866042004",
                                 "email":"ops-hire@example.com","role":"staff","functions":["desk:%s"]}"""
                                .formatted(Teams.RENTAL)))
                .andExpect(status().isCreated())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andReturn();
        String body = result.getResponse().getContentAsString();

        String id = body.replaceAll("(?s).*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
        String inviteUrl = field(body, "inviteUrl");
        String token = inviteToken(inviteUrl);
        assertThat(inviteUrl).startsWith("http://localhost:5173/staff-invite#");
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM staff_invites WHERE user_id = ?::uuid AND redeemed_at IS NULL",
                Integer.class, id)).isOne();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_log WHERE metadata::text LIKE ?",
                Integer.class, "%" + token + "%")).isZero();
        assertThat(output.getAll()).doesNotContain(token).doesNotContain("/staff-invite#");
        assertThat(mvc.perform(post(Routes.Auth.STAFF_INVITE_REDEEM)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"%s\",\"password\":\"Holder-chose-this!\"}".formatted(token)))
                .andReturn().getResponse().getStatus()).isEqualTo(204);
    }

    @Test
    @DisplayName("reissue returns a no-store invite link")
    void reissueReturnsInviteLink() throws Exception {
        User actor = admin("9866042015", "staff-maker4@example.com");
        String created = mvc.perform(post(Routes.Users.STAFF)
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Ops Reissue","mobile":"9866042016",
                                 "email":"ops-reissue@example.com","role":"staff","functions":["desk:%s"]}"""
                                .formatted(Teams.RENTAL)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = created.replaceAll("(?s).*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");

        String body = mvc.perform(post(Routes.Users.REISSUE_INVITE.replace("{id}", id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andReturn().getResponse().getContentAsString();

        String token = inviteToken(field(body, "inviteUrl"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_log WHERE metadata::text LIKE ?",
                Integer.class, "%" + token + "%")).isZero();
        assertThat(mvc.perform(post(Routes.Auth.STAFF_INVITE_REDEEM)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"%s\",\"password\":\"Holder-chose-this!\"}".formatted(token)))
                .andReturn().getResponse().getStatus()).isEqualTo(204);
    }

    @Test
    @DisplayName("manager actions notify the administrator but administrator actions do not")
    void managerActionsNotifyAdministratorOnly() throws Exception {
        User owner = admin("9866042017", "notification-admin@example.com");
        User manager = manager("9866042018", "notification-manager@example.com");

        String created = mvc.perform(post(Routes.Users.STAFF)
                        .header(HttpHeaders.AUTHORIZATION, bearer(manager))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Managed Staff","mobile":"9866042019",
                                 "email":"managed-staff@example.com","role":"staff","functions":["desk:%s"]}"""
                                .formatted(Teams.RENTAL)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = created.replaceAll("(?s).*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
        mvc.perform(post(Routes.Users.REISSUE_INVITE.replace("{id}", id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(manager)))
                .andExpect(status().isOk());
        mvc.perform(patch(Routes.Users.ARCHIVE.replace("{id}", id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(manager))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"manager cleanup\"}"))
                .andExpect(status().isOk());
        mvc.perform(patch(Routes.Users.RESTORE.replace("{id}", id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(manager)))
                .andExpect(status().isOk());
        mvc.perform(post(Routes.Users.RESET_TWO_FACTOR.replace("{id}", id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(manager)))
                .andExpect(status().isOk());

        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM notifications
                WHERE user_id = ?::uuid AND type = 'team.manager-action'
                """, Integer.class, owner.getId())).isEqualTo(5);

        mvc.perform(post(Routes.Users.STAFF)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Admin Staff","mobile":"9866042020",
                                 "email":"admin-staff@example.com","role":"staff","functions":["desk:%s"]}"""
                                .formatted(Teams.RENTAL)))
                .andExpect(status().isCreated());

        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM notifications
                WHERE user_id = ?::uuid AND type = 'team.manager-action'
                """, Integer.class, owner.getId())).isEqualTo(5);
    }

    @Test
    @DisplayName("admins can create managers")
    void adminCreatesManager() throws Exception {
        User actor = admin("9866042005", "staff-maker3@example.com");

        mvc.perform(post(Routes.Users.STAFF)
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Team Manager","mobile":"9866042006",
                                 "email":"team-manager@example.com","role":"manager"}"""))
                .andExpect(status().isCreated());

        assertThat(users.findByEmailIgnoreCaseAndArchivedFalse("team-manager@example.com").orElseThrow()
                .getRole()).isEqualTo(Roles.Wire.MANAGER);
    }

    @Test
    @DisplayName("managers can create staff but not managers")
    void managerCreatesStaffOnly() throws Exception {
        User actor = manager("9866042007", "manager-maker@example.com");

        mvc.perform(post(Routes.Users.STAFF)
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Ops Hire","mobile":"9866042008",
                                 "email":"ops-hire-2@example.com","role":"staff","functions":["desk:%s"]}"""
                                .formatted(Teams.LEGAL)))
                .andExpect(status().isCreated());

        mvc.perform(post(Routes.Users.STAFF)
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Other Manager","mobile":"9866042009",
                                 "email":"other-manager@example.com","role":"manager"}"""))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("managers cannot act on admin or manager accounts")
    void managerCannotTouchAdminOrManagerAccounts() throws Exception {
        User actor = manager("9866042010", "manager-actor@example.com");
        User admin = admin("9866042011", "admin-target@example.com");
        User peer = manager("9866042012", "manager-target@example.com");

        mvc.perform(post(Routes.Users.RESET_TWO_FACTOR.replace("{id}", admin.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                .andExpect(status().isForbidden());
        mvc.perform(post(Routes.Users.REISSUE_INVITE.replace("{id}", peer.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                .andExpect(status().isForbidden());
        mvc.perform(patch(Routes.Users.ARCHIVE.replace("{id}", admin.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"probe\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("managers read the directory like staff but write only to staff")
    void managerReadsAnyoneButWritesOnlyStaff() throws Exception {
        User actor = manager("9866042013", "manager-reader@example.com");
        User buyer = users.saveAndFlush(new User("9866042014", Roles.Wire.BUYER));

        mvc.perform(get(Routes.Users.BASE).param("q", buyer.getMobile())
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                .andExpect(status().isOk());
        mvc.perform(patch(Routes.Users.SUSPEND.replace("{id}", buyer.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"probe\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a narrowed manager sees its own functions and cannot take over staff holding more")
    void narrowedManagerIsCappedByItsOwnFunctions() throws Exception {
        User actor = manager("9866042015", "manager-narrowed@example.com");
        User staff = new User("9866042016", Roles.Wire.STAFF);
        staff.setEmail("kyc-staff@example.com");
        staff = users.saveAndFlush(staff);
        jdbc.update("INSERT INTO back_office_permissions (user_id, permissions) VALUES (?, '[\"support\"]'::jsonb), "
                + "(?, '[\"kyc\"]'::jsonb)", actor.getId(), staff.getId());
        String token = bearer(actor);
        String staffId = staff.getId().toString();

        mvc.perform(get(Routes.Users.PERMISSIONS.replace("{id}", actor.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("\"functions\":[\"support\"]")));
        mvc.perform(post(Routes.Users.RESET_TWO_FACTOR.replace("{id}", staffId))
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isForbidden());
        mvc.perform(post(Routes.Users.REISSUE_INVITE.replace("{id}", staffId))
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isForbidden());
        mvc.perform(patch(Routes.Users.BY_ID.replace("{id}", staffId))
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"manager-controlled@example.com\"}"))
                .andExpect(status().isForbidden());
        assertThat(users.findById(staff.getId()).orElseThrow().getEmail()).isEqualTo("kyc-staff@example.com");
        mvc.perform(put(Routes.Users.PERMISSIONS.replace("{id}", staffId))
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"functions\":[\"kyc\",\"support\"]}"))
                .andExpect(status().isOk());
        mvc.perform(put(Routes.Users.PERMISSIONS.replace("{id}", staffId))
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"functions\":[\"kyc\",\"reports\"]}"))
                .andExpect(status().isForbidden());
    }
}
