package com.draazy.api.common.settings;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.support.AbstractApiTest;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.test.web.servlet.ResultActions;

/** Written as absences, because the mistake caught is widening a section into "the public settings". */
class PublicSettingsProjectionTest extends AbstractApiTest {

    @ParameterizedTest(name = "{0}")
    @MethodSource("projections")
    void nothingButItsOwnBlockIsPublished(String section, String[] absentKeys) throws Exception {
        ResultActions result = mvc.perform(get(Routes.Bootstrap.BASE)).andExpect(status().isOk());
        for (String key : absentKeys) {
            result.andExpect(jsonPath("$." + section + "." + key).doesNotExist());
        }
    }

    @Test
    void theAdminOnlyBlocksAreNotSectionsOfTheirOwn() throws Exception {
        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fees").doesNotExist())
                .andExpect(jsonPath("$.permissions").doesNotExist())
                .andExpect(jsonPath("$.adminFlags").doesNotExist())
                .andExpect(jsonPath("$.site").doesNotExist());
    }

    static Stream<Arguments> projections() {
        return Stream.of(
                Arguments.of("flags", new String[] {"fees", "permissions", "adminFlags", "site", "geo"}),
                Arguments.of("geo", new String[] {"fees", "permissions", "adminFlags", "flags", "site"}),
                Arguments.of("listingPolicy", new String[] {"fees", "permissions", "flags"}),
                Arguments.of("movePack",
                        new String[] {"fees", "permissions", "adminFlags", "flags", "site"}),
                Arguments.of("pricing",
                        new String[] {"permissions", "adminFlags", "geo", "movePack", "site"}));
    }
}
