package com.draazy.api.catalog.photo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.storage.R2Properties;
import com.draazy.api.support.AbstractApiTest;
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

// The real end-to-end: a live HTTP request through the whole server chain into a real Cloudflare R2 bucket.
// Runs only with `STORAGE_ENABLED=true` and `R2_*`, so offline suites skip it.
@EnabledIfEnvironmentVariable(named = "STORAGE_ENABLED", matches = "true")
class MePhotosLiveTest extends AbstractApiTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    // Test properties shadow main's storage block, so bind environment values here.
    // That wires real R2 storage for this context only.
    @DynamicPropertySource
    static void storage(DynamicPropertyRegistry registry) {
        registry.add("draazy.providers.storage.enabled", () -> "true");
        registry.add("draazy.providers.storage.endpoint", () -> env("R2_ENDPOINT"));
        registry.add("draazy.providers.storage.access-key-id", () -> env("R2_ACCESS_KEY_ID"));
        registry.add("draazy.providers.storage.secret-access-key", () -> env("R2_SECRET_ACCESS_KEY"));
        registry.add("draazy.providers.storage.public-bucket", () -> env("R2_BUCKET_PUBLIC"));
        registry.add("draazy.providers.storage.private-bucket", () -> env("R2_BUCKET_PRIVATE"));
        registry.add("draazy.providers.storage.public-base-url", () -> env("R2_PUBLIC_BASE_URL"));
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
        byte[] png = TinyImages.png();

        String body = mvc.perform(multipart(Routes.MePhotos.BASE)
                        .file(new MockMultipartFile("file", "live.png", "image/png", png))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.url").exists())
                .andReturn().getResponse().getContentAsString();

        String url = JSON.readTree(body).get("url").asText();

        String base = stripTrailingSlash(props.publicBaseUrl());
        assertThat(url).startsWith(base + "/photos/" + owner.getId() + "/");

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
