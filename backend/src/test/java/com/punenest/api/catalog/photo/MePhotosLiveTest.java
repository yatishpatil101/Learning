package com.punenest.api.catalog.photo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.provider.storage.R2Properties;
import com.punenest.api.support.AbstractApiTest;
import java.net.URI;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;

/**
 * The real end-to-end: a live HTTP request through the whole server chain into a real Cloudflare R2
 * bucket. Unlike {@code R2FileStorageLiveTest} (which constructs {@link
 * com.punenest.api.provider.storage.R2FileStorage} directly), this boots the full Spring context and
 * POSTs a real image to {@code /me/photos}, so it proves the chain the browser actually walks:
 * security → {@code @CurrentUser} → {@link MePhotosController} → {@link PhotoService} → {@link
 * PhotoUploads} → {@code R2FileStorage.storePublic} → the public bucket.
 *
 * <p>Runs only when {@code STORAGE_ENABLED=true} and the {@code R2_*} credentials are in the
 * environment — the same gate as the storage-class live test — so an ordinary offline suite skips
 * it. With the flag set, the provider seam wires the real {@code R2FileStorage} even under the
 * {@code dev} profile (the condition is on the flag, not the profile), which is why {@code
 * MePhotosEndpointsTest} (asserting the mock URL) and this test are never run in the same pass.
 *
 * <p>The uploaded bytes are read back <em>from the public bucket via the S3 API</em>, not by
 * fetching the returned {@code r2.dev} URL: that dev domain is TLS-blocked by the corporate proxy
 * here, and production serves photos from a custom domain anyway. What the server owns — validating
 * the image, minting the key, putting the bytes in the public bucket and returning the CDN URL — is
 * exactly what this asserts.
 */
@EnabledIfEnvironmentVariable(named = "STORAGE_ENABLED", matches = "true")
class MePhotosLiveTest extends AbstractApiTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    /**
     * The test-classpath {@code application.properties} shadows main's and omits the {@code
     * punenest.providers.storage.*} block, so without this the flag would be off and the mock would
     * wire. Binding the block straight from the environment here turns the real {@link
     * com.punenest.api.provider.storage.R2FileStorage} on for this context only.
     */
    @DynamicPropertySource
    static void storage(DynamicPropertyRegistry registry) {
        registry.add("punenest.providers.storage.enabled", () -> "true");
        registry.add("punenest.providers.storage.endpoint", () -> env("R2_ENDPOINT"));
        registry.add("punenest.providers.storage.access-key-id", () -> env("R2_ACCESS_KEY_ID"));
        registry.add("punenest.providers.storage.secret-access-key", () -> env("R2_SECRET_ACCESS_KEY"));
        registry.add("punenest.providers.storage.public-bucket", () -> env("R2_BUCKET_PUBLIC"));
        registry.add("punenest.providers.storage.private-bucket", () -> env("R2_BUCKET_PRIVATE"));
        registry.add("punenest.providers.storage.public-base-url", () -> env("R2_PUBLIC_BASE_URL"));
    }

    private static String env(String name) {
        String v = System.getenv(name);
        if (v == null || v.isBlank()) {
            throw new IllegalStateException(name + " must be set for the live R2 endpoint test");
        }
        return v;
    }

    @Autowired
    UserRepository users;

    @Autowired
    R2Properties props;

    private User user(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Live Uploader");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    @Test
    void uploadsARealImageThroughTheEndpointIntoThePublicBucket() throws Exception {
        User owner = user("9820000199");
        byte[] png = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0};

        String body = mvc.perform(multipart(Routes.MePhotos.BASE)
                        .file(new MockMultipartFile("file", "live.png", "image/png", png))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.url").exists())
                .andReturn().getResponse().getContentAsString();

        String url = JSON.readTree(body).get("url").asText();

        // The URL is the public CDN URL for a server-minted, owner-scoped key.
        String base = stripTrailingSlash(props.publicBaseUrl());
        assertThat(url).startsWith(base + "/photos/" + owner.getId() + "/");

        // Prove the bytes actually landed in the PUBLIC bucket — read them back through the S3 API,
        // which is reachable here even though r2.dev is not.
        String key = url.substring(base.length() + 1);
        try {
            byte[] readBack = readFromBucket(props.publicBucket(), key);
            assertThat(readBack).isEqualTo(png);
        } finally {
            deleteQuietly(props.publicBucket(), key);
        }
    }

    private byte[] readFromBucket(String bucket, String key) {
        try (S3Client s3 = s3()) {
            return s3.getObjectAsBytes(
                    GetObjectRequest.builder().bucket(bucket).key(key).build()).asByteArray();
        }
    }

    private void deleteQuietly(String bucket, String key) {
        try (S3Client s3 = s3()) {
            s3.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
        } catch (RuntimeException ignored) {
            // best-effort cleanup; a leaked sandbox test object is harmless
        }
    }

    private S3Client s3() {
        return S3Client.builder()
                .endpointOverride(URI.create(props.endpoint()))
                .region(Region.of("auto"))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(props.accessKeyId(), props.secretAccessKey())))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
                .build();
    }

    private static String stripTrailingSlash(String s) {
        return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }
}
