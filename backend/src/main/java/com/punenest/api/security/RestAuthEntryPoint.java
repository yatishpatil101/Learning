package com.punenest.api.security;

import com.punenest.api.common.error.ErrorCodes;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

/**
 * 401 for requests that reach a protected route with no/invalid token.
 *
 * <p>Shares the code and message constants with the global advice so the filter-chain 401 and the
 * controller-layer 401 are indistinguishable to the client.
 */
@Component
public class RestAuthEntryPoint implements AuthenticationEntryPoint {

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
            AuthenticationException authException) throws IOException {
        SecurityErrors.write(response, 401, ErrorCodes.UNAUTHORIZED,
                ErrorCodes.Messages.AUTH_REQUIRED);
    }
}
