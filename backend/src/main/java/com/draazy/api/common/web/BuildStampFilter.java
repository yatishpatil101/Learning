package com.draazy.api.common.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.info.BuildProperties;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Stamps every response with an opaque build id so an open tab notices the API was replaced
 * ({@code frontend/src/hooks/useAppUpdate.js}). Ordered first so 401s carry it too. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class BuildStampFilter extends OncePerRequestFilter {

    /** Response header carrying the build identifier. Mirrored by BUILD_HEADER in http.js. */
    public static final String BUILD_HEADER = "X-Draazy-Build";

    /** Long enough that a collision is not a practical concern, and a collision only costs a banner
     * that does not appear. */
    private static final int ID_LENGTH = 12;

    /** Null when the Maven lifecycle that writes build-info.properties did not run. */
    private final String buildId;

    BuildStampFilter(ObjectProvider<BuildProperties> build) {
        BuildProperties props = build.getIfAvailable();
        this.buildId = props == null ? null : digest(props);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        // Absent rather than a sentinel: the client reads "no header" as "this server does not
        // report builds", where a fixed value would read as a real id that never changes.
        if (buildId != null) {
            response.setHeader(BUILD_HEADER, buildId);
        }
        chain.doFilter(request, response);
    }

    private static String digest(BuildProperties build) {
        // Digested, not raw: the underlying value is the build timestamp, which would broadcast our
        // release cadence. The coordinates ride along so same-millisecond artifacts stay distinct.
        String source = build.getGroup() + ':' + build.getArtifact() + ':' + build.getVersion() + ':' + build.getTime();
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash).substring(0, ID_LENGTH);
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is mandated for every conforming JRE, so this is unreachable rather than
            // unlikely; a JVM missing it is not one to start up on and hope.
            throw new IllegalStateException("SHA-256 is unavailable on this JVM", e);
        }
    }
}
