package com.punenest.api.catalog;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.support.AbstractApiTest;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * {@code GET /reels?locality=} — the feed filters on the locality slug, not the display caption
 * (open-questions Q5).
 *
 * <p>The seed carries two Magarpatta reels and one in Koregaon Park. Filtering by the slug returns
 * them; filtering by the display name no longer matches, which is the whole point of the change —
 * the frontend sends the slug it already holds.
 */
@DisplayName("Reels — the feed filters on the locality slug")
class ReelSlugFilterTest extends AbstractApiTest {

    @Test
    @DisplayName("a slug narrows the feed and the caption stays a display label")
    void slugFilters() throws Exception {
        mvc.perform(get("/reels").param("locality", "magarpatta"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[*].locality", Matchers.everyItem(Matchers.is("Magarpatta"))));

        mvc.perform(get("/reels").param("locality", "koregaon-park"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].locality").value("Koregaon Park"));
    }

    @Test
    @DisplayName("case-insensitive on the slug, so either casing returns the same feed")
    void slugIsCaseInsensitive() throws Exception {
        mvc.perform(get("/reels").param("locality", "KOREGAON-PARK"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    @DisplayName("the display name no longer matches — the filter moved to the slug")
    void displayNameNoLongerMatches() throws Exception {
        // "Koregaon Park" differs from the slug "koregaon-park" by more than case (the space), so it
        // no longer matches. (A single-word locality like Magarpatta would still match case-insensitively,
        // since its display label and slug differ only in case — which is exactly why the divergence
        // has to be shown with a multi-word name.)
        mvc.perform(get("/reels").param("locality", "Koregaon Park"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }
}
