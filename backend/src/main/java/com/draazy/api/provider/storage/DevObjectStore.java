package com.draazy.api.provider.storage;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.LocalOnly;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.Optional;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The {@code dev} profile's stand-in for an object store's signed-URL endpoint; production storage
 * does not know it exists. See docs/system/profiles.md#the-dev-object-store.
 */
@LocalOnly
@Component
@ConditionalOnProperty(prefix = "draazy.providers.storage", name = "enabled",
        havingValue = "false", matchIfMissing = true)
public class DevObjectStore {

    /**
     * How long a minted URL stays good. The bytes' real access control is the API call that minted
     * it; this is the blast radius if one escapes.
     */
    private static final Duration TTL = Duration.ofMinutes(30);

    /** Sidecar suffix for the stored content type. See {@link #store}. */
    private static final String TYPE_SUFFIX = ".contenttype";

    private static final String HMAC = "HmacSHA256";

    /**
     * The only canonical directory {@link #openPublic} will serve: the whole authorisation rule for
     * the unsigned read, decided by the server at write time and never by a caller.
     */
    public static final String PUBLIC_PREFIX = "public/";

    private final Path root;
    private final String baseUrl;
    private final String contextPath;

    /**
     * Generated per boot and never written anywhere, so a restart invalidates every outstanding URL
     * and this cannot become a fixed secret somebody copies into a properties file.
     */
    private final byte[] secret = new byte[32];

    DevObjectStore(
            @Value("${draazy.storage.dir:${java.io.tmpdir}/draazy-storage}") String root,
            @Value("${draazy.storage.dev.base-url:http://localhost:${server.port:8080}"
                    + "${server.servlet.context-path:}}") String baseUrl,
            @Value("${server.servlet.context-path:}") String contextPath) {
        this.root = Path.of(root).normalize();
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.contextPath = contextPath.endsWith("/")
                ? contextPath.substring(0, contextPath.length() - 1) : contextPath;
        new SecureRandom().nextBytes(secret);
    }

    /**
     * Write the bytes, and the content type beside them: the key is an extensionless UUID, so
     * nothing can probe the type, and octet-stream would download rather than preview.
     */
    public void store(String key, byte[] content, String contentType) {
        Path target = resolve(key).orElseThrow(
                () -> new IllegalArgumentException("storage key escapes the storage root: " + key));
        try {
            Files.createDirectories(target.getParent());
            Files.write(target, content, StandardOpenOption.CREATE,
                    StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE);
            Files.writeString(
                    target.resolveSibling(target.getFileName() + TYPE_SUFFIX),
                    contentType == null || contentType.isBlank()
                            ? MediaType.APPLICATION_OCTET_STREAM_VALUE : contentType,
                    StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING,
                    StandardOpenOption.WRITE);
        } catch (IOException e) {
            throw new UncheckedIOException("cannot store object " + key, e);
        }
    }

    /** Remove the object and its content-type sidecar; a missing object is not an error. */
    public void delete(String key) {
        Path target = resolve(key).orElseThrow(
                () -> new IllegalArgumentException("storage key escapes the storage root: " + key));
        try {
            Files.deleteIfExists(target);
            Files.deleteIfExists(target.resolveSibling(target.getFileName() + TYPE_SUFFIX));
        } catch (IOException e) {
            throw new UncheckedIOException("cannot delete object " + key, e);
        }
    }

    /** An absolute, resolvable, expiring URL for {@code key}. */
    public String downloadUrl(String key) {
        long expiresAt = Instant.now().plus(TTL).getEpochSecond();
        return baseUrl + "/dev/storage/" + encodePath(key)
                + "?exp=" + expiresAt + "&sig=" + sign(key, expiresAt);
    }

    /**
     * A permanent, unsigned, <strong>relative</strong> URL for a world-readable object — relative so
     * the CSP and the canvas hash both see same-origin. docs/system/profiles.md#the-dev-object-store.
     */
    public String publicUrl(String key) {
        return contextPath + "/dev/storage/" + encodePath(key);
    }

    /**
     * The bytes behind a signed URL, or empty for every reason alike, so this cannot answer whether
     * an object exists. The signature compare does not return early on a differing byte.
     */
    Optional<Stored> open(String key, String expiry, String signature) {
        long expiresAt;
        try {
            expiresAt = Long.parseLong(expiry);
        } catch (NumberFormatException e) {
            return Optional.empty();
        }
        if (Instant.now().getEpochSecond() > expiresAt) {
            return Optional.empty();
        }
        if (signature == null || !java.security.MessageDigest.isEqual(
                signature.getBytes(StandardCharsets.UTF_8),
                sign(key, expiresAt).getBytes(StandardCharsets.UTF_8))) {
            return Optional.empty();
        }
        return resolve(key).filter(Files::isRegularFile).flatMap(DevObjectStore::read);
    }

    /**
     * The bytes of a world-readable object — no signature, no expiry. Authorised by the canonical
     * public-directory check, so {@code public/../documents/...} cannot expose a private document.
     */
    Optional<Stored> openPublic(String key) {
        return resolvePublic(key).filter(Files::isRegularFile).flatMap(DevObjectStore::read);
    }

    /** Whether {@code key} canonically names an object inside the public directory. */
    boolean isPublic(String key) {
        return resolvePublic(key).isPresent();
    }

    /** One object and its sidecar content type, or empty if either cannot be read. */
    private static Optional<Stored> read(Path file) {
        try {
            Path sidecar = file.resolveSibling(file.getFileName() + TYPE_SUFFIX);
            String contentType = Files.isRegularFile(sidecar)
                    ? Files.readString(sidecar, StandardCharsets.UTF_8).trim()
                    : MediaType.APPLICATION_OCTET_STREAM_VALUE;
            return Optional.of(new Stored(Files.readAllBytes(file), contentType));
        } catch (IOException e) {
            return Optional.empty();
        }
    }

    /** One object read off disk. */
    record Stored(byte[] content, String contentType) {}

    /**
     * Traversal guard on both halves of the seam. Empty rather than throwing, because a distinct
     * "escaped the root" error would confirm the root's shape to a caller supplying the key.
     */
    private Optional<Path> resolve(String key) {
        if (key == null || key.isBlank() || key.endsWith(TYPE_SUFFIX)) {
            return Optional.empty();
        }
        Path target = root.resolve(key).normalize();
        return target.startsWith(root) ? Optional.of(target) : Optional.empty();
    }

    /** Resolve an unsigned key only when its normalised path remains inside {@link #PUBLIC_PREFIX}. */
    private Optional<Path> resolvePublic(String key) {
        Path publicRoot = root.resolve(PUBLIC_PREFIX).normalize();
        return resolve(key).filter(path -> path.startsWith(publicRoot));
    }

    private String sign(String key, long expiresAt) {
        try {
            Mac mac = Mac.getInstance(HMAC);
            mac.init(new SecretKeySpec(secret, HMAC));
            return HexFormat.of().formatHex(
                    mac.doFinal((key + "\n" + expiresAt).getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException("cannot sign dev storage URL", e);
        }
    }

    /** Percent-encode each segment, leaving the separators alone. */
    private static String encodePath(String key) {
        return Arrays.stream(key.split("/", -1))
                .map(segment -> URLEncoder.encode(segment, StandardCharsets.UTF_8))
                .reduce((a, b) -> a + "/" + b)
                .orElse("");
    }
}

/**
 * Serves what {@link DevObjectStore#downloadUrl} points at. {@code @LocalOnly}, so the route does not
 * exist outside the {@code dev} profile and {@code SpecCoverageTest} does not expect it in the contract.
 */
@LocalOnly
@RestController
@ConditionalOnProperty(prefix = "draazy.providers.storage", name = "enabled",
        havingValue = "false", matchIfMissing = true)
class DevStorageController {

    private final DevObjectStore store;

    DevStorageController(DevObjectStore store) {
        this.store = store;
    }

    /**
     * {@code GET /dev/storage/**} — the object, or 404. One mapping for both policies, told apart by
     * the canonical path; see docs/system/profiles.md#the-dev-object-store.
     */
    @GetMapping(Routes.DevStorage.OBJECT)
    ResponseEntity<byte[]> object(
            @PathVariable String key,
            @RequestParam(name = "exp", required = false) String expiry,
            @RequestParam(name = "sig", required = false) String signature) {
        // {*key} captures the leading slash with the rest of the path; the stored key has none.
        String storageKey = key.startsWith("/") ? key.substring(1) : key;
        boolean isPublic = store.isPublic(storageKey);
        return (isPublic ? store.openPublic(storageKey) : store.open(storageKey, expiry, signature))
                .map(stored -> ResponseEntity.ok()
                        .header(HttpHeaders.CONTENT_TYPE, stored.contentType())
                        .header(HttpHeaders.CONTENT_DISPOSITION, "inline")
                        .header(HttpHeaders.CACHE_CONTROL,
                                isPublic ? "public, max-age=3600" : "no-store")
                        .body(stored.content()))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}

/**
 * Lets the signed URL be opened without a bearer token — and <strong>only</strong> that URL, under
 * {@code dev} only. Why a separate chain: docs/system/profiles.md#the-dev-object-store.
 */
@LocalOnly
@Configuration
@ConditionalOnProperty(prefix = "draazy.providers.storage", name = "enabled",
        havingValue = "false", matchIfMissing = true)
class DevStorageSecurityConfig {

    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE)
    SecurityFilterChain devStorageFilterChain(HttpSecurity http) throws Exception {
        return http
                .securityMatcher(Routes.DevStorage.ANY)
                .csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth.anyRequest().permitAll())
                .build();
    }
}
