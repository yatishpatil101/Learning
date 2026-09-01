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
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * <strong>Proof that {@code settings.customRoles} is gone rather than quietly tolerated</strong>
 * (tech debt D67/D13, migration {@code V61}).
 *
 * <p>The key described named module bundles for scoped back-office accounts. The admin console
 * composed them, {@code PUT /admin/settings} stored them verbatim, the contract advertised them —
 * and no server code has ever read them. That is worse than an unimplemented feature: it is an
 * access-control document that an operator was invited to fill in, and that a later commit could
 * have started honouring, granting whatever had accumulated in it while everyone involved believed
 * it granted nothing.
 *
 * <p><strong>Why the assertions are shaped this way.</strong> A test that only checked for a 422
 * would pass against an implementation that rejected the request <em>after</em> writing the other
 * keys, and one that only checked the stored document would pass against a silent drop — which is
 * the failure mode this slice exists to end, because a silent drop still answers 200 and still
 * leaves the administrator believing the control worked. So refusal and non-persistence are asserted
 * together, on a body that carries a legitimate key alongside the dead one.
 *
 * <p>Everything runs inside the rolled-back transaction from {@link AbstractApiTest}. The one place
 * that would escape it is the audit row — {@code AuditService.record} is {@code REQUIRES_NEW} — so
 * {@link #aRefusedWriteRecordsNoAuditRow()} measures a delta rather than an absolute count, which is
 * both leak-free and immune to whatever else the suite has already audited.
 */
@DisplayName("D67/D13 — the dead customRoles key is refused, not stored")
class AdminSettingsDeadKeyTest extends AbstractApiTest {

    private static final String CUSTOM_ROLES =
            "[{\"id\":\"CR_evil\",\"name\":\"Ops\",\"modules\":[\"settings\",\"team\"]}]";

    @Autowired
    UserRepository users;

    private String admin(String mobile) {
        User u = new User(mobile, Roles.Wire.ADMIN);
        u.setName("Dead key " + mobile.substring(6));
        u.setMobileVerified(true);
        return bearer(users.saveAndFlush(u));
    }

    /** The status of a {@code PUT /admin/settings} carrying {@code body}. */
    private int save(String token, String body) throws Exception {
        return mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn().getResponse().getStatus();
    }

    private Integer storedCustomRoleRows() {
        return jdbc.queryForObject(
                "select count(*) from settings where key = 'customRoles'", Integer.class);
    }

    private Integer auditRows() {
        return jdbc.queryForObject(
                "select count(*) from audit_log where action = 'settings.update'", Integer.class);
    }

    /**
     * {@code V61} plus the absence of any seed. Asserted rather than assumed because the migration is
     * the only thing that clears a document a deployment may already have been carrying, and a
     * deleted row is exactly the kind of change that looks fine in review and never ran.
     */
    @Test
    @DisplayName("no customRoles document is stored")
    void theKeyIsNotStoredAtAll() {
        assertThat(storedCustomRoleRows()).isZero();
    }

    @Test
    @DisplayName("writing it is refused with 422")
    void writingItIsRefused() throws Exception {
        assertThat(save(admin("9877720001"), "{\"customRoles\":" + CUSTOM_ROLES + "}"))
                .isEqualTo(422);
    }

    /**
     * The refusal must not be a partial success. A body that carries a real key beside the dead one
     * is the shape an admin form actually sends, and storing half of it would leave the caller unable
     * to say what the platform is now configured to do.
     */
    @Test
    @DisplayName("a refused write stores nothing at all, not even its valid keys")
    void aRefusedWriteIsAtomic() throws Exception {
        String token = admin("9877720002");

        assertThat(save(token, "{\"flags\":{\"deadKeyProbe\":true},\"customRoles\":" + CUSTOM_ROLES + "}"))
                .isEqualTo(422);

        mvc.perform(get(Routes.Admin.SETTINGS).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flags.deadKeyProbe").doesNotExist())
                .andExpect(jsonPath("$.customRoles").doesNotExist());
        assertThat(storedCustomRoleRows()).isZero();
    }

    /**
     * An empty list is refused too. It is the body a console sends on the save after an operator
     * deletes their last custom role, and answering 200 to it would confirm a feature that does not
     * exist at the one moment the operator is most likely to believe the confirmation.
     */
    @Test
    @DisplayName("an empty list is refused as firmly as a populated one")
    void anEmptyListIsRefusedToo() throws Exception {
        assertThat(save(admin("9877720003"), "{\"customRoles\":[]}")).isEqualTo(422);
    }

    /** Audit is the record of what changed; a write that changed nothing must not appear in it. */
    @Test
    @DisplayName("a refused write records no audit row")
    void aRefusedWriteRecordsNoAuditRow() throws Exception {
        int before = auditRows();

        assertThat(save(admin("9877720004"), "{\"customRoles\":" + CUSTOM_ROLES + "}"))
                .isEqualTo(422);

        assertThat(auditRows()).isEqualTo(before);
    }

    /**
     * The counterweight. Every assertion above is equally satisfied by an endpoint that has stopped
     * accepting writes altogether, and a settings endpoint that refuses everything is a far worse
     * bug than the one being fixed.
     */
    @Test
    @DisplayName("an ordinary write is untouched by the refusal")
    void anOrdinaryWriteStillSucceeds() throws Exception {
        String token = admin("9877720005");

        assertThat(save(token, "{\"flags\":{\"deadKeyControl\":true}}")).isEqualTo(200);

        mvc.perform(get(Routes.Admin.SETTINGS).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flags.deadKeyControl").value(true))
                .andExpect(jsonPath("$.fees").exists());
    }

    /**
     * The refusal is a property of the document, not of the caller's rank, so it is checked from the
     * only role that can reach the endpoint at all — and the route stays admin-only, meaning a
     * non-admin is stopped one layer earlier and never gets to be told about the key.
     */
    @Test
    @DisplayName("staff are still refused before the key is even considered")
    void staffAreRefusedByTheRoleGuardFirst() throws Exception {
        User staff = new User("9877720006", Roles.Wire.STAFF);
        staff.setName("Dead key staff");
        staff.setMobileVerified(true);
        String token = bearer(users.saveAndFlush(staff));

        assertThat(save(token, "{\"customRoles\":" + CUSTOM_ROLES + "}")).isEqualTo(403);
    }

    // -----------------------------------------------------------------------------------------
    // The second dead key: geo.cities.*.live, retired to PATCH /admin/cities/{slug}
    // -----------------------------------------------------------------------------------------

    /**
     * City launch state moved to the {@code cities} table, because a value that decides what a
     * <em>logged-out</em> visitor sees cannot have an administrator-only reader. The old key is now
     * read by nothing, which puts it in exactly the same category as {@code customRoles}: accepting
     * it would store a launch decision that launches nothing, and answer 200 while doing it.
     */
    @Test
    @DisplayName("geo.cities.*.live is refused, and points at the route that replaced it")
    void theRetiredCityLiveKeyIsRefused() throws Exception {
        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, admin("9877720007"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"geo\":{\"cities\":{\"Mumbai\":{\"live\":true}}}}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.message").value(
                        org.hamcrest.Matchers.containsString("/admin/cities/{slug}")));
    }

    /**
     * The counterweight, and the one that matters most here: {@code geo} is not dead. Bounds and the
     * blacklist are still written through this endpoint, and a nested check that over-reached would
     * take the Maps panel down with it.
     */
    @Test
    @DisplayName("the rest of the geo block still saves normally")
    void geoBoundsAndBlacklistStillSave() throws Exception {
        String token = admin("9877720008");

        assertThat(save(token, """
                {"geo":{"enforceCityLimit":true,"cities":{"Mumbai":{"center":{"lat":19.076,\
                "lng":72.8777}}},"blacklist":[{"id":"bl1","term":"Camp"}]}}"""))
                .isEqualTo(200);

        mvc.perform(get(Routes.Admin.SETTINGS).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.geo.cities.Mumbai.center.lat").value(19.076))
                .andExpect(jsonPath("$.geo.blacklist[0].term").value("Camp"));
    }
}
