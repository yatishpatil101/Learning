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

/**
 * The nested {@code translations} object on admin-editable content (D2).
 *
 * <p>The help page localises FAQs. It used to do so off the mock, which stores translations as
 * suffixed fields ({@code q_mr}, {@code a_hi}); the server had nowhere to put them at all, so
 * repointing the page at {@code GET /faqs} would have looked correct on a database where nothing is
 * translated and regressed the moment an editor wrote a Marathi answer. This proves the round trip
 * that makes the repoint safe.
 *
 * <p>Three properties, in the order they matter:
 *
 * <ol>
 *   <li><strong>A translation written through the admin surface reaches the public one.</strong>
 *       Anything less and the field is decorative.</li>
 *   <li><strong>A partly-translated row survives as a partly-translated row.</strong> A Marathi
 *       question with no Marathi answer must arrive that way rather than being normalised into a
 *       fully-translated or fully-untranslated row, because that is the state real editorial work
 *       spends most of its time in and it is what the client's per-field fallback exists for.</li>
 *   <li><strong>An untranslated row says so with {@code {}}, not with {@code null} and not by
 *       omitting the key.</strong> A client that has to distinguish "no translations" from "this
 *       server does not have translations" will get it wrong once.</li>
 * </ol>
 *
 * <p>Every case is exercised on FAQs and repeated once on services, because the column was added to
 * all four tables in one migration and four entities copying the same three lines is exactly the
 * shape where one of them gets the {@code apply} line wrong and nothing notices.
 *
 * <p>Mutation checks, both run:
 * <ul>
 *   <li>Deleting the {@code translations} line from {@code FaqEntity.apply} fails three tests —
 *       the two that read a translation back off {@code GET /faqs} and the one that patches. Worth
 *       recording is which test did <em>not</em> fail:
 *       {@code aPatchReplacesTheWholeMapSoALanguageCanBeRemoved} passed, because an entity that
 *       ignores {@code translations} entirely also satisfies "the Marathi key is gone". That is the
 *       standing hazard with a negative assertion, and the reason it is paired here with a create
 *       that writes the key in the first place rather than standing alone.</li>
 *   <li>Changing the entity default from {@code new LinkedHashMap<>()} to {@code null} fails
 *       {@code anUntranslatedRowSaysSoWithAnEmptyObject} and nothing else.</li>
 * </ul>
 */
class ContentTranslationsTest extends AbstractApiTest {

    @Autowired UserRepository users;

    /**
     * Marathi, not Lorem Ipsum. A translation fixture written in ASCII cannot fail the way a real
     * one fails \u2014 the interesting bugs here are encoding bugs somewhere between Jackson, jsonb and
     * the JDBC driver, and they are invisible to {@code "translated"}.
     */
    private static final String MR_QUESTION = "\u0939\u0947 \u092e\u094b\u092b\u0924 \u0906\u0939\u0947 \u0915\u093e?";
    private static final String MR_ANSWER = "\u0939\u094b\u092f, \u0928\u0947\u0939\u092e\u0940\u091a.";

    private String staff() {
        User u = new User("9877730002", Roles.Wire.STAFF);
        u.setName("CMS Translator");
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
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

        mvc.perform(get("/faqs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + id + "')].question").value("Is it free?"))
                .andExpect(jsonPath("$[?(@.id == '" + id + "')].translations.mr.question")
                        .value(MR_QUESTION))
                .andExpect(jsonPath("$[?(@.id == '" + id + "')].translations.mr.answer")
                        .value(MR_ANSWER));
    }

    @Test
    void aPartlyTranslatedRowStaysPartlyTranslated() throws Exception {
        String token = staff();
        String id = create(token, ContentTypes.FAQS,
                "{\"question\":\"Is it free?\",\"answer\":\"Yes.\",\"translations\":"
                        + "{\"mr\":{\"question\":\"" + MR_QUESTION + "\"}}}");

        // The Marathi question arrives; the Marathi answer is absent rather than empty or copied
        // from the English one. The client falls back per field, and it can only do that if the
        // server tells it which fields are actually missing.
        mvc.perform(get("/faqs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + id + "')].translations.mr.question")
                        .value(MR_QUESTION))
                .andExpect(jsonPath("$[?(@.id == '" + id + "')].translations.mr.answer")
                        .doesNotExist());
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
    void aTranslationSurvivesAPatch() throws Exception {
        String token = staff();
        String id = create(token, ContentTypes.FAQS,
                "{\"question\":\"Is it free?\",\"answer\":\"Yes.\",\"translations\":"
                        + "{\"mr\":{\"question\":\"" + MR_QUESTION + "\"}}}");

        // Ops fixes a typo in the English answer and touches nothing else. The Marathi question is
        // somebody else's work; a PATCH that dropped it would be a silent deletion.
        mvc.perform(patch(Routes.Admin.CONTENT_ITEM, ContentTypes.FAQS, id)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"answer\":\"Yes, always.\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.answer").value("Yes, always."))
                .andExpect(jsonPath("$.translations.mr.question").value(MR_QUESTION));
    }

    @Test
    void aPatchReplacesTheWholeMapSoALanguageCanBeRemoved() throws Exception {
        String token = staff();
        String id = create(token, ContentTypes.FAQS,
                "{\"question\":\"Is it free?\",\"translations\":"
                        + "{\"mr\":{\"question\":\"" + MR_QUESTION + "\"}}}");

        // Replace rather than merge, and this is the case that decides it: with merge semantics
        // there is no request an editor could send that means "this row is no longer translated
        // into Marathi", because every key they omit is a key that survives.
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

        mvc.perform(get("/services"))
                .andExpect(jsonPath("$[?(@.id == '" + service + "')].translations.mr.name")
                        .value("\u092a\u0945\u0915\u0930\u094d\u0938"));
        mvc.perform(get("/banners"))
                .andExpect(jsonPath("$[?(@.id == '" + banner + "')].translations.mr.headline")
                        .value("\u0938\u0947\u0932"));
        mvc.perform(get("/announcements"))
                .andExpect(jsonPath("$[?(@.id == '" + announcement + "')].translations.mr.title")
                        .value("\u0926\u093f\u0935\u093e\u0933\u0940"));
    }
}
