package com.draazy.api.common.settings;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.support.AbstractApiTest;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Each public settings route projects one block of a document whose other blocks (fee table,
 * permission map, back-office toggles) are not public. Written as absences, because the mistake
 * this catches is someone widening a route into "the public settings endpoint".
 */
class PublicSettingsProjectionTest extends AbstractApiTest {

    @ParameterizedTest(name = "{0}")
    @MethodSource("projections")
    void nothingButItsOwnBlockIsPublished(String label, String route, String[] absentKeys)
            throws Exception {
        ResultActions result = mvc.perform(get(route)).andExpect(status().isOk());
        for (String key : absentKeys) {
            result.andExpect(jsonPath("$." + key).doesNotExist());
        }
    }

    static Stream<Arguments> projections() {
        return Stream.of(
                Arguments.of("/flags", Routes.Flags.BASE,
                        new String[] {"fees", "permissions", "adminFlags", "site", "geo"}),
                Arguments.of("/geo", Routes.Geo.BASE,
                        new String[] {"fees", "permissions", "adminFlags", "flags", "site"}),
                Arguments.of("/listing-policy", Routes.ListingPolicy.BASE,
                        new String[] {"fees", "permissions", "flags"}),
                Arguments.of("/move-pack", Routes.MovePack.BASE,
                        new String[] {"fees", "permissions", "adminFlags", "flags", "site"}),
                Arguments.of("/pricing", Routes.Pricing.BASE,
                        new String[] {"permissions", "adminFlags", "geo", "movePack", "site"}));
    }
}
