package com.draazy.api.content;

import com.draazy.api.support.AbstractApiTest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/** FAQs are the only list authored here, so a retired type must answer 404 rather than land in the FAQ table. */
class AdminContentEndpointsTest extends AbstractApiTest {

    @Autowired UserRepository users;

    private String bearer(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("CMS " + mobile.substring(6));
        u.setMobileVerified(true);
        return bearer(users.saveAndFlush(u));
    }

    private String staff() {
        return bearer("9877720001", Roles.Wire.STAFF);
    }

    private static String idOf(String body) {
        int at = body.indexOf("\"id\":\"") + 6;
        return body.substring(at, body.indexOf('"', at));
    }

    private String create(String token, String body) throws Exception {
        return idOf(mvc.perform(post(Routes.Admin.CONTENT, ContentTypes.FAQS)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.type").value(ContentTypes.FAQS))
                .andExpect(jsonPath("$.archived").value(false))
                .andReturn().getResponse().getContentAsString());
    }

    @Test
    void createReadArchiveRestoreWorks() throws Exception {
        String token = staff();
        String id = create(token, "{\"question\":\"How?\",\"answer\":\"Like this\"}");

        mvc.perform(get(Routes.Admin.CONTENT, ContentTypes.FAQS).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + id + "')]").exists());

        mvc.perform(post(Routes.Admin.CONTENT_ARCHIVE, ContentTypes.FAQS, id)
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archived").value(true));

        mvc.perform(get(Routes.Admin.CONTENT, ContentTypes.FAQS).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + id + "')]").exists());

        mvc.perform(post(Routes.Admin.CONTENT_RESTORE, ContentTypes.FAQS, id)
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archived").value(false));
    }

    /** The connection between the ops screen and the public site. */
    @Test
    void archivingHidesARowFromThePublicList() throws Exception {
        String token = staff();
        String id = create(token, "{\"question\":\"Is this public?\",\"answer\":\"Until archived\"}");

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
        String id = create(token, "{\"question\":\"Legal?\",\"answer\":\"Agreements\",\"category\":\"legal\"}");

        mvc.perform(patch(Routes.Admin.CONTENT_ITEM, ContentTypes.FAQS, id)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"answer\":\"Rent agreements\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.answer").value("Rent agreements"))
                .andExpect(jsonPath("$.question").value("Legal?"))
                .andExpect(jsonPath("$.category").value("legal"));
    }

    @Test
    void archiveAndRestoreAreIdempotent() throws Exception {
        String token = staff();
        String id = create(token, "{\"question\":\"Twice?\"}");

        for (int i = 0; i < 2; i++) {
            mvc.perform(post(Routes.Admin.CONTENT_ARCHIVE, ContentTypes.FAQS, id)
                            .header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.archived").value(true));
        }
        for (int i = 0; i < 2; i++) {
            mvc.perform(post(Routes.Admin.CONTENT_RESTORE, ContentTypes.FAQS, id)
                            .header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.archived").value(false));
        }
    }

    @Test
    void theRetiredAndUnknownTypesAreNotFound() throws Exception {
        String token = staff();
        for (String type : new String[] {"announcements", "services", "banners", "testimonials"}) {
            mvc.perform(get(Routes.Admin.CONTENT, type).header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isNotFound());
            mvc.perform(post(Routes.Admin.CONTENT, type)
                            .header(HttpHeaders.AUTHORIZATION, token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"question\":\"Q\"}"))
                    .andExpect(status().isNotFound());
        }
    }

    @Test
    void aFaqRefusesToBeCreatedWithoutAQuestion() throws Exception {
        mvc.perform(post(Routes.Admin.CONTENT, ContentTypes.FAQS)
                        .header(HttpHeaders.AUTHORIZATION, staff())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());
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

    @Test
    void adminMayAuthorToo() throws Exception {
        create(bearer("9877720002", Roles.Wire.ADMIN), "{\"question\":\"From admin?\"}");
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