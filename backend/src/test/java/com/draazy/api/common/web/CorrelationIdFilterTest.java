package com.draazy.api.common.web;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class CorrelationIdFilterTest {

    private final CorrelationIdFilter filter = new CorrelationIdFilter();

    @Test
    void echoesSafeInboundTraceId() throws Exception {
        var request = new MockHttpServletRequest();
        request.addHeader(RequestCorrelation.TRACE_ID_HEADER, "trace-123_ABC");
        var response = new MockHttpServletResponse();
        FilterChain chain = (req, res) -> {};

        filter.doFilter(request, response, chain);

        assertThat(response.getHeader(RequestCorrelation.TRACE_ID_HEADER)).isEqualTo("trace-123_ABC");
    }

    @Test
    void replacesUnsafeTraceIdToBlockResponseSplitting() throws Exception {
        var request = new MockHttpServletRequest();
        request.addHeader(RequestCorrelation.TRACE_ID_HEADER, "evil\r\nSet-Cookie: pwn=1");
        var response = new MockHttpServletResponse();
        FilterChain chain = (req, res) -> {};

        filter.doFilter(request, response, chain);

        String echoed = response.getHeader(RequestCorrelation.TRACE_ID_HEADER);
        assertThat(echoed).doesNotContain("\r").doesNotContain("\n").doesNotContain("Set-Cookie");
        assertThat(echoed).matches("^[A-Za-z0-9-]{36}$");
    }
}
