package com.draazy.api.common.settings;

import com.draazy.api.support.AbstractApiTest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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

/** Absent means off here, unlike {@code /flags}: silence about a price is never a yes. Round trips are admin write then anonymous read. */
class MovePackEndpointTest extends AbstractApiTest {

    @Autowired UserRepository users;

    private String adminToken() {
        User u = new User("9877720011", Roles.Wire.ADMIN);
        u.setName("Pack Admin");
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
    }

    /** Anonymous: a route missed in {@code SecurityConfig} would 401 and look like an unlaunched pack. */
    @Test
    void anonymousCallersGetTheSeededPrices() throws Exception {
        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.movePack.items.movers").value(8000))
                .andExpect(jsonPath("$.movePack.items.clean").value(2500))
                .andExpect(jsonPath("$.movePack.items.verify").value(999));
    }

    /** Ships {@code enabled: false} (safe for a thing that takes money) with prices filled in, so launching is one boolean, not retyping six numbers. */
    @Test
    void thePackShipsDisabledButPriced() throws Exception {
        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.movePack.enabled").value(false))
                .andExpect(jsonPath("$.movePack.items").isNotEmpty());
    }

    /** Launching or repricing the pack reaches a visitor with no account; the deep merge keeps the prices the admin did not send, as replace would empty the pack. */
    @Test
    void aLaunchSavedByAnAdminIsVisibleToAnAnonymousClient() throws Exception {
        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"movePack\":{\"enabled\":true,\"items\":{\"movers\":9500}}}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.movePack.enabled").value(true))
                .andExpect(jsonPath("$.movePack.items.movers").value(9500))
                .andExpect(jsonPath("$.movePack.items.clean").value(2500));
    }

    /** A string, a negative and a fractional price are each dropped, not clamped: a number no operator chose is worse than a line item that cannot sell yet. */
    @Test
    void pricesThatAreNotWholeNonNegativeNumbersAreOmitted() throws Exception {
        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"movePack\":{\"items\":"
                                + "{\"paint\":\"6000\",\"verify\":-1,\"internet\":12.5}}}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.movePack.items.paint").doesNotExist())
                .andExpect(jsonPath("$.movePack.items.verify").doesNotExist())
                .andExpect(jsonPath("$.movePack.items.internet").doesNotExist())
                // The valid siblings in the same block are unaffected: one bad price must not
                // take the pack down with it.
                .andExpect(jsonPath("$.movePack.items.movers").value(8000));
    }

    /** A malformed block answers coming-soon, which shows no numbers and takes no payment, so bad configuration never sells at a wrong price. */
    @Test
    void aMalformedBlockFallsBackToComingSoon() throws Exception {
        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"movePack\":\"not an object\"}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.movePack.enabled").value(false))
                .andExpect(jsonPath("$.movePack.items").isEmpty());
    }
}
