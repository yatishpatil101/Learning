package com.draazy.api.engagement.flatmate;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.support.AbstractApiTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The flatmate feeds must answer 200 when no locality filter is supplied (tech-debt D117).
 *
 * <p><strong>What this does and does not guard.</strong> It pins the observable contract: the
 * unfiltered feed — the default page load, before a visitor touches a single filter — returns a
 * page envelope rather than an error. It does <em>not</em> pin the {@code cast(:locality as string)}
 * in the repositories, and that distinction was established by experiment rather than assumed.
 *
 * <p><strong>The cast could not be mutation-proven.</strong> The original defect was that a bare
 * {@code :locality} binds as {@code bytea} when null, and PostgreSQL has no {@code lower(bytea)},
 * so the unfiltered feed 500s. Removing the cast from {@code FlatmateRoomRepository} and running
 * both this class and the seeded {@code FlatmateSupplyEndpointsTest} (2026-08-08) left everything
 * green — the Hibernate version on the current Boot 4.1 line infers the type from the
 * {@code = lower(r.locality)} comparison by itself. The cast stays as documented defence, but no
 * test can go red on its removal, and pretending otherwise would be the exact failure this suite
 * warns about elsewhere: an assertion that reads like coverage and cannot fail.
 *
 * <p><strong>Why this class is separate from {@code FlatmateSupplyEndpointsTest}.</strong> That
 * suite seeds rows before it reads, so its feed calls always carry data — and it was green
 * throughout the period the original bug was live. Asserting against an empty table is the sharper
 * shape for a binding defect, and it keeps this class independent of anything the other suite seeds.
 */
@DisplayName("Flatmate feeds — an unfiltered feed must answer 200 (D117)")
class FlatmateNullFacetTest extends AbstractApiTest {

    /* Every list endpoint whose repository takes a nullable String facet. Named rather than
       discovered by reflection: a test that enumerates its own targets silently covers nothing on
       the day a route is renamed, which is the failure mode this whole class exists to prevent.

       The paged endpoints answer the `PageEnvelope` shape — `content`, not `items`. Asserting the
       array explicitly matters: `status().isOk()` alone would also pass against a handler that had
       been quietly changed to return something else entirely. */
    @Test
    @DisplayName("the rooms feed answers 200 with no locality parameter at all")
    void roomsFeedWithoutLocality() throws Exception {
        mvc.perform(get(Routes.Flatmates.ROOMS))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray());
    }

    @Test
    @DisplayName("the groups feed answers 200 with no locality parameter at all")
    void groupsFeedWithoutLocality() throws Exception {
        mvc.perform(get(Routes.Flatmates.GROUPS))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray());
    }

    @Test
    @DisplayName("the seeker posts feed answers 200 with no locality parameter at all")
    void postsFeedWithoutLocality() throws Exception {
        mvc.perform(get(Routes.Flatmates.POSTS))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray());
    }

    @Test
    @DisplayName("the mixed feed answers 200 with no locality parameter at all")
    void mixedFeedWithoutLocality() throws Exception {
        mvc.perform(get(Routes.Flatmates.FEED))
                .andExpect(status().isOk());
    }

    /**
     * An explicitly empty parameter is a distinct binding from an absent one.
     *
     * <p>{@code ?locality=} arrives as {@code ""}, not {@code null}, and reaches a different branch
     * of the same query. The browser produces it whenever a user clears the locality box rather than
     * navigating away, so it is at least as common as the absent case.
     */
    @Test
    @DisplayName("an empty locality parameter is treated as no filter, not as a 500")
    void roomsFeedWithBlankLocality() throws Exception {
        mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", ""))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray());
    }

    /** The filtered path must still work — otherwise "always 200" could be satisfied by ignoring it. */
    @Test
    @DisplayName("a real locality still filters rather than erroring")
    void roomsFeedWithLocality() throws Exception {
        mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "Baner"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray());
    }
}
