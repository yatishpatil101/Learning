package com.punenest.api.content;

import com.punenest.api.support.AbstractApiTest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Contract + behaviour proof for CMS authoring — {@code /admin/content/{type}} (slice 14, S55/S56).
 *
 * <p>One polymorphic controller serves four tables, so the tests are written to catch the failure
 * mode that shape invites: a type that quietly falls through to the wrong table. Every operation is
 * exercised against all four types, and an unknown type is proved to 404 rather than land in
 * banners.
 *
 * <p>The other properties proved are the ones that connect the ops screen to the public site:
 *
 * <ol>
 *   <li><strong>Archive hides a row from the public read but not from ops.</strong> That asymmetry
 *       is the entire reason this surface exists rather than reusing the public endpoints.</li>
 *   <li><strong>PATCH leaves absent fields alone.</strong> The form only renders the fields for its
 *       type; replace semantics would blank everything it did not happen to show.</li>
 *   <li><strong>Archive and restore are idempotent</strong> — two ops clicking the same button is
 *       not a conflict.</li>
 * </ol>
 */
class AdminContentEndpointsTest extends AbstractApiTest {

    @Autowired UserRepository users;

    /** The four types and a create body that satisfies each one's required field. */
    private static final String[][] TYPES = {
        {ContentTypes.ANNOUNCEMENTS, "{\"title\":\"Diwali offer\",\"body\":\"Free listings\"}", "title", "Diwali offer"},
        {ContentTypes.SERVICES, "{\"name\":\"Packers\",\"icon\":\"truck\"}", "name", "Packers"},
        {ContentTypes.FAQS, "{\"question\":\"How?\",\"answer\":\"Like this\"}", "question", "How?"},
        {ContentTypes.BANNERS, "{\"image\":\"https://img.png\",\"headline\":\"Sale\"}", "image", "https://img.png"},
    };

    private String bearer(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("CMS " + mobile.substring(6));
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
    }

    private String staff() {
        return bearer("9877720001", Roles.Wire.STAFF);
    }

    private static String idOf(String body) {
        int at = body.indexOf("\"id\":\"") + 6;
        return body.substring(at, body.indexOf('"', at));
    }

    private String create(String token, String type, String body) throws Exception {
        return idOf(mvc.perform(post(Routes.Admin.CONTENT, type)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.type").value(type))
                .andExpect(jsonPath("$.archived").value(false))
                .andReturn().getResponse().getContentAsString());
    }

    // ---- the full lifecycle, on every type ----

    @Test
    void createReadArchiveRestoreWorksForEveryType() throws Exception {
        String token = staff();
        for (String[] type : TYPES) {
            String kind = type[0];
            String id = create(token, kind, type[1]);

            mvc.perform(get(Routes.Admin.CONTENT, kind).header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$[?(@.id == '" + id + "')]").exists());

            mvc.perform(post(Routes.Admin.CONTENT_ARCHIVE, kind, id)
                            .header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.archived").value(true));

            // Still on the ops list — that is what the Archived tab reads.
            mvc.perform(get(Routes.Admin.CONTENT, kind).header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$[?(@.id == '" + id + "')]").exists());

            mvc.perform(post(Routes.Admin.CONTENT_RESTORE, kind, id)
                            .header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.archived").value(false));
        }
    }

    /** The connection between the ops screen and the public site. */
    @Test
    void archivingHidesARowFromThePublicList() throws Exception {
        String token = staff();
        String id = create(token, ContentTypes.FAQS,
                "{\"question\":\"Is this public?\",\"answer\":\"Until archived\"}");

        mvc.perform(get("/faqs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + id + "')]").exists());

        mvc.perform(post(Routes.Admin.CONTENT_ARCHIVE, ContentTypes.FAQS, id)
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk());

        mvc.perform(get("/faqs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + id + "')]").doesNotExist());
    }

    @Test
    void patchLeavesAbsentFieldsAlone() throws Exception {
        String token = staff();
        String id = create(token, ContentTypes.SERVICES,
                "{\"name\":\"Legal\",\"icon\":\"scales\",\"description\":\"Agreements\"}");

        mvc.perform(patch(Routes.Admin.CONTENT_ITEM, ContentTypes.SERVICES, id)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"icon\":\"gavel\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.icon").value("gavel"))
                .andExpect(jsonPath("$.name").value("Legal"))
                .andExpect(jsonPath("$.description").value("Agreements"));
    }

    @Test
    void archiveAndRestoreAreIdempotent() throws Exception {
        String token = staff();
        String id = create(token, ContentTypes.BANNERS,
                "{\"image\":\"https://a.png\",\"headline\":\"Twice\"}");

        for (int i = 0; i < 2; i++) {
            mvc.perform(post(Routes.Admin.CONTENT_ARCHIVE, ContentTypes.BANNERS, id)
                            .header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.archived").value(true));
        }
        for (int i = 0; i < 2; i++) {
            mvc.perform(post(Routes.Admin.CONTENT_RESTORE, ContentTypes.BANNERS, id)
                            .header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.archived").value(false));
        }
    }

    // ---- the failure modes a polymorphic route invites ----

    @Test
    void anUnknownTypeIsNotSilentlyTreatedAsBanners() throws Exception {
        String token = staff();
        mvc.perform(get(Routes.Admin.CONTENT, "testimonials")
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isNotFound());
        mvc.perform(post(Routes.Admin.CONTENT, "testimonials")
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"image\":\"https://x.png\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void eachTypeRefusesToBeCreatedWithoutItsRequiredField() throws Exception {
        String token = staff();
        for (String[] type : TYPES) {
            mvc.perform(post(Routes.Admin.CONTENT, type[0])
                            .header(HttpHeaders.AUTHORIZATION, token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{}"))
                    .andExpect(status().isBadRequest());
        }
    }

    /**
     * A severity the column will not store is a 400 naming the allowed values, not a 500.
     *
     * <p>This is a regression test with a specific history. {@code ContentItemWrite} advertised
     * {@code [info, warning, critical]}, but {@code announcements.severity} has carried a
     * {@code CHECK (severity IN ('info','success','warning'))} since V8. A client doing exactly
     * what the published contract told it to do was answered with a constraint violation. The
     * contract and the service now both describe the constraint.
     */
    @Test
    void anUnstorableSeverityIsRejectedBeforeItReachesTheColumn() throws Exception {
        String token = staff();
        mvc.perform(post(Routes.Admin.CONTENT, ContentTypes.ANNOUNCEMENTS)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Outage\",\"severity\":\"critical\"}"))
                .andExpect(status().isBadRequest());

        // The three the column does accept, on create and on patch alike.
        for (String severity : new String[] {"info", "success", "warning"}) {
            String id = create(token, ContentTypes.ANNOUNCEMENTS,
                    "{\"title\":\"Notice\",\"severity\":\"" + severity + "\"}");
            mvc.perform(patch(Routes.Admin.CONTENT_ITEM, ContentTypes.ANNOUNCEMENTS, id)
                            .header(HttpHeaders.AUTHORIZATION, token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"severity\":\"" + severity + "\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.severity").value(severity));
        }

        // A patch is checked too, or the create-side guard would only be half a guard.
        String id = create(token, ContentTypes.ANNOUNCEMENTS, "{\"title\":\"Notice\"}");
        mvc.perform(patch(Routes.Admin.CONTENT_ITEM, ContentTypes.ANNOUNCEMENTS, id)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"severity\":\"critical\"}"))
                .andExpect(status().isBadRequest());

        // Severity means nothing to the other three types and is ignored rather than rejected,
        // consistent with every other cross-type field on the shared write schema.
        mvc.perform(post(Routes.Admin.CONTENT, ContentTypes.FAQS)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"question\":\"How?\",\"severity\":\"critical\"}"))
                .andExpect(status().isCreated());
    }

    /** An id from the wrong table must be a 404, not somebody else's row. */
    @Test
    void anIdFromAnotherTypeIsNotFound() throws Exception {
        String token = staff();
        String faqId = create(token, ContentTypes.FAQS, "{\"question\":\"Q\",\"answer\":\"A\"}");

        mvc.perform(patch(Routes.Admin.CONTENT_ITEM, ContentTypes.BANNERS, faqId)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"headline\":\"Hijacked\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void aNonUuidIdIsNotFoundRatherThanAServerError() throws Exception {
        mvc.perform(patch(Routes.Admin.CONTENT_ITEM, ContentTypes.FAQS, "not-a-uuid")
                        .header(HttpHeaders.AUTHORIZATION, staff())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"answer\":\"x\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void anUnknownIdIsNotFound() throws Exception {
        mvc.perform(post(Routes.Admin.CONTENT_ARCHIVE, ContentTypes.FAQS, UUID.randomUUID())
                        .header(HttpHeaders.AUTHORIZATION, staff()))
                .andExpect(status().isNotFound());
    }

    // ---- who may author ----

    @Test
    void adminMayAuthorToo() throws Exception {
        create(bearer("9877720002", Roles.Wire.ADMIN), ContentTypes.ANNOUNCEMENTS,
                "{\"title\":\"From admin\"}");
    }

    @Test
    void aPlainUserMayNotAuthor() throws Exception {
        String owner = bearer("9877720003", Roles.Wire.OWNER);
        mvc.perform(get(Routes.Admin.CONTENT, ContentTypes.FAQS)
                        .header(HttpHeaders.AUTHORIZATION, owner))
                .andExpect(status().isForbidden());
        mvc.perform(post(Routes.Admin.CONTENT, ContentTypes.FAQS)
                        .header(HttpHeaders.AUTHORIZATION, owner)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"question\":\"Can I?\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void authoringIsNotPublic() throws Exception {
        mvc.perform(get(Routes.Admin.CONTENT, ContentTypes.FAQS))
                .andExpect(status().isUnauthorized());
    }
}
