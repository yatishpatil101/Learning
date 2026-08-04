package com.punenest.api.foundation;

import com.punenest.api.support.AbstractApiTest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.RequestCorrelation;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.http.HttpHeaders;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * End-to-end proof of the web-facing cross-cutting layer through the real filter chain: default-deny
 * → 401 envelope, role guard allow/deny → 403 envelope, typed exception → 404 envelope, public route
 * open, and the correlation id echoed on every response. Uses a throwaway test controller so no
 * feature endpoint is needed.
 */
class SecurityWebTest extends AbstractApiTest {

    @Autowired
    UserRepository userRepository;

    private String bearerFor(String mobile, String role) {
        User u = new User(mobile, role);
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(userRepository.saveAndFlush(u));
    }

    @Test
    void protectedRouteWithoutTokenReturns401Envelope() throws Exception {
        mvc.perform(get("/test/secure"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("unauthorized"))
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(header().exists(RequestCorrelation.TRACE_ID_HEADER));
    }

    @Test
    void publicHealthRouteIsOpen() throws Exception {
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
    }

    @Test
    void authenticatedRequestPassesAndTraceHeaderIsEchoed() throws Exception {
        mvc.perform(get("/test/secure").header(HttpHeaders.AUTHORIZATION, bearerFor("9876500101", "buyer")))
                .andExpect(status().isOk())
                .andExpect(content().string("ok"))
                .andExpect(header().exists(RequestCorrelation.TRACE_ID_HEADER));
    }

    @Test
    void roleGuardDeniesWrongRoleWith403Envelope() throws Exception {
        mvc.perform(get("/test/admin").header(HttpHeaders.AUTHORIZATION, bearerFor("9876500102", "buyer")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("forbidden"))
                .andExpect(jsonPath("$.status").value(403));
    }

    @Test
    void roleGuardAllowsCorrectRole() throws Exception {
        mvc.perform(get("/test/admin").header(HttpHeaders.AUTHORIZATION, bearerFor("9876500103", "admin")))
                .andExpect(status().isOk());
    }

    @Test
    void typedNotFoundRendersContract404Envelope() throws Exception {
        mvc.perform(get("/test/notfound").header(HttpHeaders.AUTHORIZATION, bearerFor("9876500104", "buyer")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("not_found"))
                .andExpect(jsonPath("$.status").value(404));
    }

    @TestConfiguration
    static class TestEndpoints {

        @Bean
        TestController testController() {
            return new TestController();
        }
    }

    @RestController
    static class TestController {

        @GetMapping("/test/secure")
        String secure(@CurrentUser Object user) {
            return "ok";
        }

        @GetMapping("/test/admin")
        @PreAuthorize("hasRole('" + Roles.ADMIN + "')")
        String adminOnly() {
            return "ok";
        }

        @GetMapping("/test/notfound")
        String notFound() {
            throw new NotFoundException("nope");
        }
    }
}
