package com.draazy.api.admin;

import com.draazy.api.support.AbstractApiTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Contract + behaviour proof for {@code /admin/settings} (slice 14).
 *
 * <p>This is the platform's most dangerous endpoint: it is the only one whose output changes what
 * every other endpoint charges. The properties proved here are the ones that make it safe to hand
 * to a human with a form:
 *
 * <ol>
 *   <li><strong>PUT merges (S60).</strong> Every field of {@code AdminSettings} is optional, so a
 *       flags-only body is a complete document. Under replace semantics, saving the feature-flag
 *       panel would delete the fee table and the platform would silently start charging its
 *       compiled-in defaults.</li>
 *   <li><strong>Merging is deep.</strong> Sending one fee must not drop the other six.</li>
 *   <li><strong>Both verbs are admin-only.</strong> The fee table and permission map are as
 *       sensitive to read as to write.</li>
 *   <li><strong>Every write is audited</strong>, naming the keys touched.</li>
 * </ol>
 */
class AdminSettingsEndpointsTest extends AbstractApiTest {

    @Autowired UserRepository users;

    private String bearer(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Settings " + mobile.substring(6));
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
    }

    private void save(String token, String body) throws Exception {
        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    @Test
    void readReturnsTheStoredDocument() throws Exception {
        mvc.perform(get(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, bearer("9877710001", Roles.Wire.ADMIN)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fees").exists());
    }

    /** The S60 invariant, at top-level-key granularity. */
    @Test
    void savingOneBlockDoesNotWipeTheOthers() throws Exception {
        String token = bearer("9877710002", Roles.Wire.ADMIN);
        save(token, "{\"flags\":{\"betaSearch\":true}}");

        mvc.perform(get(Routes.Admin.SETTINGS).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flags.betaSearch").value(true))
                .andExpect(jsonPath("$.fees").exists());
    }

    /** The same invariant one level down, which is where a shallow merge would still lose data. */
    @Test
    void changingOneFeeKeepsTheRest() throws Exception {
        String token = bearer("9877710003", Roles.Wire.ADMIN);
        save(token, "{\"fees\":{\"gstPercent\":18,\"seekerPlusTopup\":299,\"featuredListing\":499}}");
        save(token, "{\"fees\":{\"featuredListing\":999}}");

        mvc.perform(get(Routes.Admin.SETTINGS).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fees.featuredListing").value(999))
                .andExpect(jsonPath("$.fees.gstPercent").value(18))
                .andExpect(jsonPath("$.fees.seekerPlusTopup").value(299));
    }

    /**
     * An array replaces rather than merges, and it does so <em>inside</em> a merged object, which is
     * the only place the distinction can be observed: a top-level array key would be replaced by any
     * implementation, including one with no merge at all. {@code geo.blacklist} is an ordered list
     * of localities the admin console excludes from Places search, and merging two lists positionally
     * would re-admit a locality nobody re-admitted.
     *
     * <p>Was written against {@code customRoles} until that key was refused outright (D67/D13,
     * {@code V61}); the property under test is the merge, not the key it was demonstrated on.
     */
    @Test
    void arraysAreReplacedWholesale() throws Exception {
        String token = bearer("9877710004", Roles.Wire.ADMIN);
        save(token, "{\"geo\":{\"city\":\"Pune\",\"blacklist\":[\"a\",\"b\"]}}");
        save(token, "{\"geo\":{\"blacklist\":[\"c\"]}}");

        mvc.perform(get(Routes.Admin.SETTINGS).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.geo.blacklist.length()").value(1))
                .andExpect(jsonPath("$.geo.blacklist[0]").value("c"))
                // the sibling scalar survives, so this is a merge that replaced an array rather
                // than a replace that happened to look right.
                .andExpect(jsonPath("$.geo.city").value("Pune"));
    }

    @Test
    void theResponseIsTheStoredDocumentNotThePatch() throws Exception {
        String token = bearer("9877710005", Roles.Wire.ADMIN);
        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flags\":{\"x\":true}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flags.x").value(true))
                .andExpect(jsonPath("$.fees").exists());
    }

    @Test
    void everyWriteIsAudited() throws Exception {
        String token = bearer("9877710006", Roles.Wire.ADMIN);
        save(token, "{\"flags\":{\"audited\":true}}");

        Integer rows = jdbc.queryForObject(
                "select count(*) from audit_log where action = 'settings.update'", Integer.class);
        org.assertj.core.api.Assertions.assertThat(rows).isPositive();
    }

    @Test
    void staffCannotReadOrWrite() throws Exception {
        String staff = bearer("9877710007", Roles.Wire.STAFF);
        mvc.perform(get(Routes.Admin.SETTINGS).header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isForbidden());
        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flags\":{\"x\":true}}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void settingsAreNotPublic() throws Exception {
        mvc.perform(get(Routes.Admin.SETTINGS)).andExpect(status().isUnauthorized());
    }

    // ---- Conditional writes (S68, tech debt D66) ------------------------------------------------

    /**
     * The lost update this feature exists to prevent, written out in full: two admins open the same
     * block, both save, and before S68 the second silently discarded the first with both seeing 200.
     */
    @Test
    void aSecondAdminEditingTheSameBlockIsRefusedRatherThanWinningSilently() throws Exception {
        String first = bearer("9877710010", Roles.Wire.ADMIN);
        String second = bearer("9877710011", Roles.Wire.ADMIN);

        String openedByBoth = etag(first);
        save(second, "{\"fees\":{\"featuredListing\":999}}");

        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, first)
                        .header(HttpHeaders.IF_MATCH, openedByBoth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fees\":{\"featuredListing\":499}}"))
                .andExpect(status().isPreconditionFailed())
                .andExpect(jsonPath("$.error").value("precondition_failed"));

        // Nothing was written: the loser's number must not be anywhere in the stored document.
        mvc.perform(get(Routes.Admin.SETTINGS).header(HttpHeaders.AUTHORIZATION, first))
                .andExpect(jsonPath("$.fees.featuredListing").value(999));
    }

    @Test
    void aCurrentEtagIsAcceptedAndTheNextOneMovesOn() throws Exception {
        String token = bearer("9877710012", Roles.Wire.ADMIN);
        String before = etag(token);

        String after = mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .header(HttpHeaders.IF_MATCH, before)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flags\":{\"conditional\":true}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flags.conditional").value(true))
                .andReturn().getResponse().getHeader(HttpHeaders.ETAG);

        assertThat(after).isNotNull().isNotEqualTo(before);
        assertThat(etag(token)).isEqualTo(after);
    }

    /**
     * The tag describes content, not write count. A save that changes nothing must leave it alone —
     * otherwise an admin who pressed Save twice would invalidate a colleague's open editor for no
     * reason, and people learn to ignore warnings that fire without cause.
     */
    @Test
    void aWriteThatChangesNothingLeavesTheTagAlone() throws Exception {
        String token = bearer("9877710013", Roles.Wire.ADMIN);
        save(token, "{\"flags\":{\"idempotent\":true}}");
        String tag = etag(token);

        save(token, "{\"flags\":{\"idempotent\":true}}");

        assertThat(etag(token)).isEqualTo(tag);
    }

    /** An omitted header keeps the pre-S68 behaviour — the reason this could ship without a flag. */
    @Test
    void withoutIfMatchTheWriteIsUnconditional() throws Exception {
        String token = bearer("9877710014", Roles.Wire.ADMIN);
        save(token, "{\"fees\":{\"featuredListing\":111}}");
        save(token, "{\"fees\":{\"featuredListing\":222}}");

        mvc.perform(get(Routes.Admin.SETTINGS).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(jsonPath("$.fees.featuredListing").value(222));
    }

    /** {@code *} means "any current representation", and the settings document always exists. */
    @Test
    void ifMatchStarAlwaysPasses() throws Exception {
        String token = bearer("9877710015", Roles.Wire.ADMIN);

        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .header(HttpHeaders.IF_MATCH, "*")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flags\":{\"star\":true}}"))
                .andExpect(status().isOk());
    }

    /** A stale tag among several current ones still passes — {@code If-Match} is a list. */
    @Test
    void anyEntryInTheListMatching_isEnough() throws Exception {
        String token = bearer("9877710016", Roles.Wire.ADMIN);
        String current = etag(token);

        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .header(HttpHeaders.IF_MATCH, "\"deadbeef\", " + current)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flags\":{\"listed\":true}}"))
                .andExpect(status().isOk());
    }

    /** A refused precondition must not leave an audit row claiming a change nobody made. */
    @Test
    void aRefusedWriteIsNotAudited() throws Exception {
        String token = bearer("9877710017", Roles.Wire.ADMIN);
        Integer before = auditRows();

        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .header(HttpHeaders.IF_MATCH, "\"0123456789abcdef0123456789abcdef\"")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flags\":{\"never\":true}}"))
                .andExpect(status().isPreconditionFailed());

        assertThat(auditRows()).isEqualTo(before);
    }

    private String etag(String token) throws Exception {
        return mvc.perform(get(Routes.Admin.SETTINGS).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getHeader(HttpHeaders.ETAG);
    }

    private Integer auditRows() {
        return jdbc.queryForObject(
                "select count(*) from audit_log where action = 'settings.update'", Integer.class);
    }
}
