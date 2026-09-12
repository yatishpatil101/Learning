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

/**
 * Contract + behaviour proof for {@code GET /move-pack}.
 *
 * <p><strong>Why this endpoint needed tests at all, when it is barely more than a row read.</strong>
 * It replaces a read that went to browser local storage, which meant an operator could publish the
 * Move-in Pack, be told it saved — it did save — and watch the page carry on saying "coming soon".
 * The write was real and the read was not. Every assertion here is aimed at that class of defect:
 * that the route is reachable without a token, that it publishes this block and no other, and that
 * a value an admin writes is the value an anonymous visitor subsequently reads.
 *
 * <p>The remaining tests are about the endpoint's one genuinely opinionated rule, which is the one
 * place it must <em>disagree</em> with its sibling {@code /flags}: absent means off here, where
 * absent means on there. Silence about a feature is a reasonable yes; silence about a price is
 * never one.
 */
class MovePackEndpointTest extends AbstractApiTest {

    @Autowired UserRepository users;

    private String adminToken() {
        User u = new User("9877720011", Roles.Wire.ADMIN);
        u.setName("Pack Admin");
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
    }

    /**
     * Reachable with no Authorization header, carrying the seeded prices.
     *
     * <p>The route-constant/security-matcher agreement check. A route mapped in the controller but
     * missed in {@code SecurityConfig} would 401 here, and the client-side symptom would be
     * indistinguishable from the pack simply not being launched — the page falls back to
     * coming-soon mode either way. That is precisely why it has to be asserted on the server.
     */
    @Test
    void anonymousCallersGetTheSeededPrices() throws Exception {
        mvc.perform(get(Routes.MovePack.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.movers").value(8000))
                .andExpect(jsonPath("$.items.clean").value(2500))
                .andExpect(jsonPath("$.items.verify").value(999));
    }

    /**
     * The pack ships switched off, with its prices already filled in.
     *
     * <p>Both halves matter and they pull in opposite directions. Shipping {@code enabled: false}
     * is the safe default for a thing that takes money. Shipping the prices anyway is what makes
     * launching it one boolean rather than a data-entry exercise — and a launch that requires
     * retyping six numbers is a launch that eventually happens with one of them wrong.
     */
    @Test
    void thePackShipsDisabledButPriced() throws Exception {
        mvc.perform(get(Routes.MovePack.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.items").isNotEmpty());
    }

    /**
     * The projection is the {@code movePack} row and nothing else.
     *
     * <p>Same justification as the flags endpoint, and the same failure to guard against. The whole
     * argument for a public route is that this one block is not sensitive while its neighbours are;
     * the fee table, the permission map and the back-office toggles live in the same document and
     * none of them may appear here. Written as absences, because the mistake this catches is
     * someone widening the endpoint into "the public settings endpoint".
     */
    @Test
    void nothingButThePackBlockIsPublished() throws Exception {
        mvc.perform(get(Routes.MovePack.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fees").doesNotExist())
                .andExpect(jsonPath("$.permissions").doesNotExist())
                .andExpect(jsonPath("$.adminFlags").doesNotExist())
                .andExpect(jsonPath("$.flags").doesNotExist())
                .andExpect(jsonPath("$.site").doesNotExist());
    }

    /**
     * Launching the pack, and repricing it, is visible to a visitor with no account.
     *
     * <p>The reason the route was built, asserted end to end. The deep merge (S60) is load-bearing
     * in the same breath: the admin sends only the two keys it changed, and the four prices it did
     * not mention have to survive. Under replace semantics a repricing panel would silently delete
     * every item it was not currently showing, and the page would render a half-empty pack.
     */
    @Test
    void aLaunchSavedByAnAdminIsVisibleToAnAnonymousClient() throws Exception {
        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"movePack\":{\"enabled\":true,\"items\":{\"movers\":9500}}}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.MovePack.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.items.movers").value(9500))
                .andExpect(jsonPath("$.items.clean").value(2500));
    }

    /**
     * A price that is not a whole non-negative number is dropped, not clamped or forwarded.
     *
     * <p>Three bad shapes at once, because they fail differently and all three have to be omitted.
     * A string would make the response disagree with its own schema. A negative would be a discount
     * nobody authorised. A fractional value would be the paise this platform does not have.
     *
     * <p>Dropping rather than clamping is the deliberate half. Clamping invents a number, and a
     * price the page shows that no operator chose is worse than a line item the page cannot sell
     * yet — the second is visibly incomplete, the first is confidently wrong.
     */
    @Test
    void pricesThatAreNotWholeNonNegativeNumbersAreOmitted() throws Exception {
        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"movePack\":{\"items\":"
                                + "{\"paint\":\"6000\",\"verify\":-1,\"internet\":12.5}}}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.MovePack.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.paint").doesNotExist())
                .andExpect(jsonPath("$.items.verify").doesNotExist())
                .andExpect(jsonPath("$.items.internet").doesNotExist())
                // The valid siblings in the same block are unaffected: one bad price must not
                // take the pack down with it.
                .andExpect(jsonPath("$.items.movers").value(8000));
    }

    /**
     * A malformed block answers coming-soon rather than failing.
     *
     * <p>Every consumer of this endpoint is a page render, so the alternative to defaulting is a
     * broken services page because somebody mistyped a config value. What makes this safe rather
     * than merely quiet is the <em>direction</em> of the default: coming-soon mode shows no numbers
     * and takes no payment, so the failure mode of bad configuration is a page that sells nothing,
     * never a page that sells at the wrong price.
     */
    @Test
    void aMalformedBlockFallsBackToComingSoon() throws Exception {
        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"movePack\":\"not an object\"}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.MovePack.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.items").isEmpty());
    }
}
