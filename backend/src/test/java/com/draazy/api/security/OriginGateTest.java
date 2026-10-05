package com.draazy.api.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "draazy.security.origin-secret=" + OriginGateTest.SECRET)
@AutoConfigureMockMvc
@DisplayName("Origin gate — only our edge proxy may call the API")
class OriginGateTest {

    static final String SECRET = "test-only-origin-secret-at-least-32-chars";

    @Autowired
    MockMvc mvc;

    @Test
    void aRequestWithoutTheSecretIsRefusedEvenOnAPublicRoute() throws Exception {
        mvc.perform(get(Routes.Cities.BASE))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("forbidden"));
    }

    @Test
    void aWrongSecretIsRefused() throws Exception {
        mvc.perform(get(Routes.Cities.BASE).header(OriginGateFilter.HEADER, SECRET + "x"))
                .andExpect(status().isForbidden());
    }

    @Test
    void theProxysSecretIsLetThrough() throws Exception {
        mvc.perform(get(Routes.Cities.BASE).header(OriginGateFilter.HEADER, SECRET))
                .andExpect(status().isOk());
    }

    @Test
    void healthProbesNeedNoSecret() throws Exception {
        mvc.perform(get("/actuator/health/readiness"))
                .andExpect(status().is(Matchers.not(403)));
    }

    @Test
    void writesToAProbePathStillNeedTheSecret() throws Exception {
        mvc.perform(post("/actuator/health")).andExpect(status().isForbidden());
        mvc.perform(put("/actuator/health/liveness")).andExpect(status().isForbidden());
        mvc.perform(delete("/actuator/health/readiness")).andExpect(status().isForbidden());
    }

    @Test
    void aBlankSettingFailsTheBootRatherThanTurningTheGateOff() {
        assertThatThrownBy(() -> OriginGateFilter.fromSetting(" "))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("draazy.security.origin-secret");
    }

    @Test
    void aGuessableSecretFailsTheBoot() {
        assertThatThrownBy(() -> OriginGateFilter.fromSetting("short"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("at least");
    }

    @Test
    void noneTurnsTheGateOff() {
        assertThat(OriginGateFilter.fromSetting("NONE")).isEmpty();
    }
}
