package com.punenest.api.common.error;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Protocol-level refusals, asserted through the dispatcher rather than against the advice.
 *
 * <p><strong>Why these cannot be unit tests.</strong> {@link GlobalExceptionHandlerTest} already
 * proves each handler maps its exception to the right envelope. It cannot prove the handler is ever
 * <em>reached</em>, and that was the actual defect: {@link GlobalExceptionHandler} carries an
 * {@code @ExceptionHandler(Exception.class)} catch-all and does not extend
 * {@code ResponseEntityExceptionHandler}, so for any exception without a more specific handler the
 * catch-all outranked Spring's own {@code DefaultHandlerExceptionResolver}. A wrong verb and an
 * unsupported content type — both entirely the caller's doing — were answered with 500
 * {@code internal} and a logged stack trace, as though the server had broken.
 *
 * <p>The multipart controllers assert in their Javadoc that "the wrong content type is refused as a
 * 415 by Spring before any of our code runs". Every existing 415 test exercises the vault's own
 * byte-sniffing refusal instead, so that claim had no coverage at all. It does now.
 *
 * <p>The two public cases use unauthenticated routes deliberately: they must reach the dispatcher,
 * and a 401 would short-circuit in the filter chain first. The 405 case is the opposite — it has to
 * be authenticated, because {@code permitAll} on {@code /properties} is scoped to {@code GET}, so an
 * unauthenticated {@code DELETE} is refused by the security chain (a correct 401) and never reaches
 * the layer under test.
 */
@DisplayName("Error envelope — protocol refusals are the caller's fault, not a 500")
class ErrorEnvelopeWebTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

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

    /**
     * Same family as the two above, and the one that hid the longest: an unmapped path reached the
     * catch-all and was reported as 500 {@code internal}. It has to be authenticated for the same
     * reason the 405 case does — an anonymous request is refused by the security chain and never
     * reaches the dispatcher, which is precisely why nobody noticed until they were holding a token.
     */
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

    /**
     * The regression this pins is not the status — a malformed body was always a 400 — but the
     * body. The handler used to return Jackson's message verbatim, which names the target Java
     * class and quotes the submitted payload back to whoever sent it.
     */
    @Test
    @DisplayName("a malformed body is 400 and names no internal type")
    void malformedBodyIs400WithoutInternals() throws Exception {
        mvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\": "))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value(ErrorCodes.BAD_REQUEST))
                .andExpect(jsonPath("$.message").value(ErrorCodes.Messages.MALFORMED_BODY));
    }
}
