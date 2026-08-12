package com.punenest.api.provider.storage;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.DevOnly;
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
 * The {@code dev} profile's stand-in for an object store's signed-URL endpoint (D120).
 *
 * <p><strong>What was broken.</strong> {@code MockFileStorage} has always written uploaded bytes to
 * a real local directory, but {@code signedDownloadUrl} answered
 * {@code https://mock.storage.local/<key>?op=get&sig=dev} — a host that does not exist. So every
 * document the API returned carried a {@code url} that could not be opened: the vault, the KYC
 * papers, the service request's draft and final agreement. The service tracker's document column
 * was therefore undemonstrable in dev, which is the register row this closes.
 *
 * <p><strong>What did not change.</strong> Production storage is untouched — neither
 * {@code ObjectStoreFileStorage} (the throwing stub) nor {@link R2FileStorage} knows this class
 * exists, and in a real deployment a download URL is R2's own and never reaches this server. No
 * authorisation check was relaxed to make the preview work: the routes that decide who may see a
 * document are unchanged, and this endpoint sits behind a credential of its own.
 *
 * <p><strong>Why the URL may be opened without a session.</strong> Because that is what a signed
 * URL <em>is</em>, and modelling it any other way would misrepresent production. A browser opening
 * a document in a new tab, or rendering it in an {@code <img>}, sends no {@code Authorization}
 * header; R2's signed URLs work because the signature in the query string is the credential. This
 * reproduces that property rather than papering over it: the URL is minted only by a server that
 * has already answered a document read, it is HMAC-signed with a secret generated fresh on every
 * boot, and it expires. A caller who guesses a storage key still cannot fetch it, and a URL that
 * leaks stops working — both of which are the real thing's behaviour, and neither of which was true
 * of {@code ?sig=dev}.
 */
@DevOnly
@Component
@ConditionalOnProperty(prefix = "punenest.providers.storage", name = "enabled",
        havingValue = "false", matchIfMissing = true)
public class DevObjectStore {

    /**
     * How long a minted URL stays good. Short enough that a link pasted into a chat is dead by the
     * time anyone follows it, long enough that a developer reading a document does not have the tab
     * expire underneath them. The bytes' real access control is the API call that minted the URL;
     * this is the blast radius if one escapes.
     */
    private static final Duration TTL = Duration.ofMinutes(30);

    /** Sidecar suffix for the stored content type. See {@link #store}. */
    private static final String TYPE_SUFFIX = ".contenttype";

    private static final String HMAC = "HmacSHA256";

    private final Path root;
    private final String baseUrl;

    /**
     * Generated per boot and never written anywhere. A restart invalidates every outstanding URL,
     * which is the correct behaviour for a credential nobody is meant to keep, and it removes the
     * only way this could become a fixed secret somebody later copies into a properties file.
     */
    private final byte[] secret = new byte[32];

    DevObjectStore(
            @Value("${punenest.storage.dir:${java.io.tmpdir}/punenest-storage}") String root,
            @Value("${punenest.storage.dev.base-url:http://localhost:${server.port:8080}"
                    + "${server.servlet.context-path:}}") String baseUrl) {
        this.root = Path.of(root).normalize();
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        new SecureRandom().nextBytes(secret);
    }

    /**
     * Write the bytes, and the content type beside them.
     *
     * <p>The sidecar exists because the on-disk key is a UUID with no extension, so there is
     * nothing for {@code Files.probeContentType} to work from — and serving every document as
     * {@code application/octet-stream} would make the browser download it instead of previewing it,
     * which is precisely the behaviour this row is about. A real object store keeps the content
     * type as object metadata; a directory does not have object metadata, so it gets a second file.
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

    /** An absolute, resolvable, expiring URL for {@code key}. */
    public String downloadUrl(String key) {
        long expiresAt = Instant.now().plus(TTL).getEpochSecond();
        return baseUrl + "/dev/storage/" + encodePath(key)
                + "?exp=" + expiresAt + "&sig=" + sign(key, expiresAt);
    }

    /**
     * The bytes behind a signed URL, or empty for any reason at all.
     *
     * <p>One empty answer for a bad signature, a lapsed deadline, a key that escapes the root and a
     * file that is not there, so the endpoint cannot be used to ask whether an object exists. The
     * signature is compared with {@link java.security.MessageDigest#isEqual}, which does not return
     * early on the first differing byte.
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
        Optional<Path> target = resolve(key).filter(Files::isRegularFile);
        if (target.isEmpty()) {
            return Optional.empty();
        }
        try {
            Path file = target.get();
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
     * The same traversal guard {@code MockFileStorage.store} has always had, on both halves of the
     * seam now. Empty rather than throwing, because on the read side the key is caller-supplied and
     * a distinct error for "escaped the root" would confirm the root's shape.
     */
    private Optional<Path> resolve(String key) {
        if (key == null || key.isBlank() || key.endsWith(TYPE_SUFFIX)) {
            return Optional.empty();
        }
        Path target = root.resolve(key).normalize();
        return target.startsWith(root) ? Optional.of(target) : Optional.empty();
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
 * Serves what {@link DevObjectStore#downloadUrl} points at. {@code @DevOnly}, so the route does not
 * exist outside the {@code dev} profile and {@code SpecCoverageTest} does not expect it in the
 * contract.
 */
@DevOnly
@RestController
@ConditionalOnProperty(prefix = "punenest.providers.storage", name = "enabled",
        havingValue = "false", matchIfMissing = true)
class DevStorageController {

    private final DevObjectStore store;

    DevStorageController(DevObjectStore store) {
        this.store = store;
    }

    /**
     * {@code GET /dev/storage/**} — the object, or 404.
     *
     * <p>404 for a bad signature as well as for a missing file. There is no useful distinction to
     * draw for a caller who is meant to be following a URL we minted, and drawing one would turn
     * this into an oracle for which storage keys exist.
     *
     * <p>{@code Content-Disposition: inline} so the browser previews rather than downloads —
     * the whole point of the row. {@code Cache-Control: no-store} because the URL is a credential
     * and a shared cache holding the response is a copy of the document nobody authorised.
     */
    @GetMapping(Routes.DevStorage.OBJECT)
    ResponseEntity<byte[]> object(
            @PathVariable String key,
            @RequestParam(name = "exp", required = false) String expiry,
            @RequestParam(name = "sig", required = false) String signature) {
        // {*key} captures the leading slash with the rest of the path; the stored key has none.
        String storageKey = key.startsWith("/") ? key.substring(1) : key;
        return store.open(storageKey, expiry, signature)
                .map(stored -> ResponseEntity.ok()
                        .header(HttpHeaders.CONTENT_TYPE, stored.contentType())
                        .header(HttpHeaders.CONTENT_DISPOSITION, "inline")
                        .header(HttpHeaders.CACHE_CONTROL, "no-store")
                        .body(stored.content()))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}

/**
 * Lets the signed URL be opened without a bearer token — and <strong>only</strong> that URL, and
 * only under {@code dev}.
 *
 * <p><strong>Why this is a separate chain rather than a line in {@code SecurityConfig}.</strong>
 * {@code SecurityConfig}'s allowlist is production's, and every entry on it is a considered
 * decision about the real API. Adding a profile-conditional entry there would mean the file that
 * documents what is public no longer says what is public — you would have to know which lines are
 * live. A whole chain that only exists when {@code dev} is named, in the same file as the thing it
 * fronts, cannot be misread and cannot be inherited by accident: {@code @DevOnly} keeps the bean
 * out of every other profile, {@code DevProfileGuard} refuses to finish booting if {@code dev} is
 * named on something that looks like a deployment, and the controller it opens is absent there too.
 * Three independent reasons this cannot reach production, none of which is a comment.
 *
 * <p>{@code securityMatcher} scopes it to the storage path, so it is not a chain that matches any
 * request and the main chain still handles everything else. It authenticates nobody — the signature
 * in the query string is the credential, checked in {@link DevObjectStore#open}.
 */
@DevOnly
@Configuration
@ConditionalOnProperty(prefix = "punenest.providers.storage", name = "enabled",
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
