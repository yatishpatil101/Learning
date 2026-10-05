package com.draazy.api.common.error;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.config.JsonBodyLimitsConfig;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

// Why these cannot be unit tests. {@link GlobalExceptionHandlerTest} already proves each handler maps its exception
// to the right envelope.
@DisplayName("Error envelope — protocol refusals are the caller's fault, not a 500")
class ErrorEnvelopeWebTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    // The regression this pins is not the status — a malformed body was always a 400 — but the body.
    @Test
    @DisplayName("a wrong verb on a real route is 405 with an Allow header, not 500")
    void wrongVerbIs405() throws Exception {
        User u = new User("9876500001", "buyer");
        u.setMobileVerified(true);
        users.saveAndFlush(u);

        mvc.perform(delete("/properties").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(header().exists("Allow"))
                .andExpect(jsonPath("$.error").value(ErrorCodes.METHOD_NOT_ALLOWED))
                .andExpect(jsonPath("$.status").value(405));
    }

    @Test
    @DisplayName("a content type outside consumes is 415, not 500")
    void unsupportedContentTypeIs415() throws Exception {
        mvc.perform(post("/auth/login")
                        .contentType(MediaType.TEXT_PLAIN)
                        .content("mobile=9876543210"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.error").value(ErrorCodes.UNSUPPORTED_MEDIA_TYPE))
                .andExpect(jsonPath("$.status").value(415));
    }

    @Test
    @DisplayName("an unmapped path is 404, not 500")
    void unmappedPathIs404() throws Exception {
        User u = new User("9876500002", "buyer");
        u.setMobileVerified(true);
        users.saveAndFlush(u);

        mvc.perform(get("/me").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value(ErrorCodes.NOT_FOUND))
                .andExpect(jsonPath("$.status").value(404));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("badBodies")
    @DisplayName("a malformed or oversized body is 400 and names no internal type")
    void malformedBodyIs400WithoutInternals(String label, String body) throws Exception {
        mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value(ErrorCodes.BAD_REQUEST))
                .andExpect(jsonPath("$.message").value(ErrorCodes.Messages.MALFORMED_BODY));
    }

    static Stream<Arguments> badBodies() {
        String oversized = "9".repeat(JsonBodyLimitsConfig.MAX_JSON_STRING_CHARS + 1);
        return Stream.of(
                Arguments.of("malformed JSON", "{\"mobile\": "),
                Arguments.of("oversized JSON string", "{\"mobile\":\"" + oversized + "\"}"));
    }
}
