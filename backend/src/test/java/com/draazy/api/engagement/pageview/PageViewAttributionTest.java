package com.draazy.api.engagement.pageview;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@DisplayName("A page view names its viewer only with analytics consent, and always records sign-in")
class PageViewAttributionTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired EntityManager em;

    private User buyer(String mobile) {
        User u = new User(mobile, "buyer");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Map<String, Object> record(String sessionId, String attributedJson, User viewer) throws Exception {
        String attributed = attributedJson == null ? "" : ",\"attributed\":" + attributedJson;
        MockHttpServletRequestBuilder req = post(Routes.PageViews.BASE)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"sessionId\":\"" + sessionId + "\",\"events\":[{\"path\":\"/listings\","
                        + "\"device\":\"mobile\",\"agoMs\":0}]" + attributed + "}");
        if (viewer != null) req.header(HttpHeaders.AUTHORIZATION, bearer(viewer));
        mvc.perform(req).andExpect(status().isAccepted());
        em.flush();
        return jdbc.queryForMap("select user_id, signed_in from page_views where session_id = ?", sessionId);
    }

    @Test
    void aSignedInViewerWithoutConsentIsCountedButNotNamed() throws Exception {
        Map<String, Object> row = record("attr-test-noconsent", "false", buyer("9855519001"));
        assertThat(row.get("signed_in")).isEqualTo(true);
        assertThat(row.get("user_id")).isNull();
    }

    @Test
    void anOlderClientThatSendsNoChoiceIsTreatedAsNoConsent() throws Exception {
        Map<String, Object> row = record("attr-test-absent", null, buyer("9855519002"));
        assertThat(row.get("signed_in")).isEqualTo(true);
        assertThat(row.get("user_id")).isNull();
    }

    @Test
    void consentAttributesTheViewToTheSignedInViewer() throws Exception {
        User u = buyer("9855519003");
        Map<String, Object> row = record("attr-test-consent", "true", u);
        assertThat(row.get("signed_in")).isEqualTo(true);
        assertThat(row.get("user_id")).isEqualTo(u.getId());
    }

    @Test
    void aSignedOutViewerIsAnonymousWhateverTheClientClaims() throws Exception {
        Map<String, Object> row = record("attr-test-guest", "true", null);
        assertThat(row.get("signed_in")).isEqualTo(false);
        assertThat(row.get("user_id")).isNull();
    }
}
