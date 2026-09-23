package com.draazy.api.common.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import jakarta.servlet.FilterChain;
import java.time.Instant;
import java.util.Properties;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.info.BuildProperties;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** A stamp that drifted between requests would prompt a reload on every page; one that survived a
 *  deploy would never prompt at all. Both failures are invisible from the server, hence not e2e. */
class BuildStampFilterTest {

    private static final FilterChain PASS_THROUGH = (req, res) -> {};

    @Test
    void stampsEveryResponseWithTheSameValue() throws Exception {
        // Two filters, not two calls on one: a process-scoped id would satisfy a single instance
        // and still flip as a client bounced between the four `maxScale` allows.
        String here = stampOf(filterFor(buildAt("2026-09-19T12:00:00Z")));
        String elsewhere = stampOf(filterFor(buildAt("2026-09-19T12:00:00Z")));

        assertThat(here).isNotNull().isEqualTo(elsewhere);
    }

    @Test
    void neverPublishesTheBuildTimestampItself() throws Exception {
        // Twelve hex characters are wide enough to hold an epoch-millis value, so the format alone
        // proves nothing — look for the number as well.
        long millis = Instant.parse("2026-09-19T12:00:00Z").toEpochMilli();

        String stamp = stampOf(filterFor(buildAt("2026-09-19T12:00:00Z")));

        assertThat(stamp)
                .matches("^[0-9a-f]{12}$")
                .doesNotContain(Long.toHexString(millis))
                .doesNotContain(String.valueOf(millis));
    }

    @Test
    void aDifferentBuildProducesADifferentStamp() throws Exception {
        String before = stampOf(filterFor(buildAt("2026-09-19T12:00:00Z")));
        String after = stampOf(filterFor(buildAt("2026-09-19T12:00:01Z")));

        assertThat(after).isNotEqualTo(before);
    }

    @Test
    void omitsTheHeaderWhenTheBuildIsUnknown() throws Exception {
        // An IDE run that drives javac directly writes no build-info.properties. Why absent rather
        // than a placeholder is argued where the decision lives, in BuildStampFilter itself.
        assertThat(stampOf(filterFor(null))).isNull();
    }

    private static String stampOf(BuildStampFilter filter) throws Exception {
        var response = new MockHttpServletResponse();
        filter.doFilter(new MockHttpServletRequest(), response, PASS_THROUGH);
        return response.getHeader(BuildStampFilter.BUILD_HEADER);
    }

    @SuppressWarnings("unchecked")
    private static BuildStampFilter filterFor(BuildProperties build) {
        ObjectProvider<BuildProperties> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(build);
        return new BuildStampFilter(provider);
    }

    private static BuildProperties buildAt(String instant) {
        var props = new Properties();
        props.setProperty("group", "com.draazy");
        props.setProperty("artifact", "draazy-api");
        props.setProperty("version", "0.0.1-SNAPSHOT");
        props.setProperty("time", String.valueOf(Instant.parse(instant).toEpochMilli()));
        return new BuildProperties(props);
    }
}
