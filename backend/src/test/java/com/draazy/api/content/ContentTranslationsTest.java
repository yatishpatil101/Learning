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
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

// This proves the round trip that makes the repoint safe.
// Three properties, in the order they matter: A translation written through the admin surface reaches the public one.
class ContentTranslationsTest extends AbstractApiTest {

    @Autowired UserRepository users;

    private static final String MR_QUESTION = "\u0939\u0947 \u092e\u094b\u092b\u0924 \u0906\u0939\u0947 \u0915\u093e?";
    private static final String MR_ANSWER = "\u0939\u094b\u092f, \u0928\u0947\u0939\u092e\u0940\u091a.";

    private String staff() {
        User u = new User("9877730002", Roles.Wire.STAFF);
        u.setName("CMS Translator");
        u.setMobileVerified(true);
        return bearer(users.saveAndFlush(u));
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
                .andReturn().getResponse().getContentAsString());
    }

    @Test
    void aTranslationWrittenByOpsReachesThePublicList() throws Exception {
        String token = staff();
        String id = create(token, ContentTypes.FAQS,
                "{\"question\":\"Is it free?\",\"answer\":\"Yes.\",\"translations\":"
                        + "{\"mr\":{\"question\":\"" + MR_QUESTION + "\",\"answer\":\"" + MR_ANSWER + "\"}}}");

        // The client falls back per field, and it can only do that if the server tells it which fields are actually
        // missing.
        mvc.perform(get("/faqs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + id + "')].question").value("Is it free?"))
                .andExpect(jsonPath("$[?(@.id == '" + id + "')].translations.mr.question")
                        .value(MR_QUESTION))
                .andExpect(jsonPath("$[?(@.id == '" + id + "')].translations.mr.answer")
                        .value(MR_ANSWER));
    }

    @Test
    void aPartlyTranslatedRowStaysPartlyTranslatedAndSurvivesAPatch() throws Exception {
        String token = staff();
        String id = create(token, ContentTypes.FAQS,
                "{\"question\":\"Is it free?\",\"answer\":\"Yes.\",\"translations\":"
                        + "{\"mr\":{\"question\":\"" + MR_QUESTION + "\"}}}");

        mvc.perform(get("/faqs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + id + "')].translations.mr.question")
                        .value(MR_QUESTION))
                .andExpect(jsonPath("$[?(@.id == '" + id + "')].translations.mr.answer")
                        .doesNotExist());

        // Replace rather than merge, and this is the case that decides it.
        mvc.perform(patch(Routes.Admin.CONTENT_ITEM, ContentTypes.FAQS, id)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"answer\":\"Yes, always.\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.answer").value("Yes, always."))
                .andExpect(jsonPath("$.translations.mr.question").value(MR_QUESTION));
    }

    @Test
    void anUntranslatedRowSaysSoWithAnEmptyObject() throws Exception {
        String token = staff();
        String id = create(token, ContentTypes.FAQS,
                "{\"question\":\"Untranslated\",\"answer\":\"Still useful\"}");

        mvc.perform(get("/faqs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + id + "')].translations").exists())
                .andExpect(jsonPath("$[?(@.id == '" + id + "')].translations.mr").doesNotExist());
    }

    @Test
    void aPatchReplacesTheWholeMapSoALanguageCanBeRemoved() throws Exception {
        String token = staff();
        String id = create(token, ContentTypes.FAQS,
                "{\"question\":\"Is it free?\",\"translations\":"
                        + "{\"mr\":{\"question\":\"" + MR_QUESTION + "\"}}}");

        mvc.perform(patch(Routes.Admin.CONTENT_ITEM, ContentTypes.FAQS, id)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"translations\":{}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.translations.mr").doesNotExist());

        mvc.perform(get("/faqs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + id + "')].translations.mr").doesNotExist());
    }

    @Test
    void theOtherThreeTypesCarryItToo() throws Exception {
        String token = staff();
        String service = create(token, ContentTypes.SERVICES,
                "{\"name\":\"Packers\",\"icon\":\"truck\",\"translations\":"
                        + "{\"mr\":{\"name\":\"\u092a\u0945\u0915\u0930\u094d\u0938\"}}}");
        String banner = create(token, ContentTypes.BANNERS,
                "{\"image\":\"https://img.png\",\"headline\":\"Sale\",\"translations\":"
                        + "{\"mr\":{\"headline\":\"\u0938\u0947\u0932\"}}}");
        String announcement = create(token, ContentTypes.ANNOUNCEMENTS,
                "{\"title\":\"Diwali\",\"translations\":{\"mr\":{\"title\":\"\u0926\u093f\u0935\u093e\u0933\u0940\"}}}");

        mvc.perform(get(Routes.Admin.CONTENT, ContentTypes.SERVICES)
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(jsonPath("$[?(@.id == '" + service + "')].translations.mr.name")
                        .value("\u092a\u0945\u0915\u0930\u094d\u0938"));
        mvc.perform(get(Routes.Admin.CONTENT, ContentTypes.BANNERS)
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(jsonPath("$[?(@.id == '" + banner + "')].translations.mr.headline")
                        .value("\u0938\u0947\u0932"));
        mvc.perform(get(Routes.Admin.CONTENT, ContentTypes.ANNOUNCEMENTS)
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(jsonPath("$[?(@.id == '" + announcement + "')].translations.mr.title")
                        .value("\u0926\u093f\u0935\u093e\u0933\u0940"));
    }
}
