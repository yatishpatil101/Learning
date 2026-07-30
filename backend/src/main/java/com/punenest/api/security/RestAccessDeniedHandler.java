package com.punenest.api.security;

import com.punenest.api.common.error.ErrorCodes;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

/**
 * 403 for an authenticated caller who lacks the required role/permission.
 *
 * <p>Shares the code and message constants with the global advice so the filter-chain 403 and the
 * controller-layer 403 are indistinguishable to the client.
 */
@Component
public class RestAccessDeniedHandler implements AccessDeniedHandler {

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response,
            AccessDeniedException ex) throws IOException {
        SecurityErrors.write(response, 403, ErrorCodes.FORBIDDEN,
                ErrorCodes.Messages.ACCESS_DENIED);
    }
}
