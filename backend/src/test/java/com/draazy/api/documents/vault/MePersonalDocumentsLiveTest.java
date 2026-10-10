package com.draazy.api.documents.vault;

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
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
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
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.S3Object;

/** Proves the endpoint routes KYC files to the private bucket: the signed URL opens, the unsigned one is refused
 * (any 4xx; R2 answers 400 where AWS S3 says 403). Gated on {@code STORAGE_ENABLED} and R2 credentials. */
@EnabledIfEnvironmentVariable(named = "STORAGE_ENABLED", matches = "true")
class MePersonalDocumentsLiveTest extends AbstractApiTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    /** The test-classpath properties shadow main's and omit the storage block,
     * so without this the flag would be off and the mock would wire. */
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
            throw new IllegalStateException(name + " must be set for the live R2 document test");
        }
        return v;
    }

    @Autowired
    UserRepository users;

    @Autowired
    R2Properties props;

    @Test
    void uploadsAKycFileIntoThePrivateBucketAndServesItOnlyWhenSigned() throws Exception {
        User owner = user("9820000198");
        byte[] pdf = pdfBytes("draazy-r2-personal-doc");

        String body = mvc.perform(multipart(Routes.MeDocuments.PERSONAL)
                        .file(new MockMultipartFile("file", "aadhaar.pdf", "application/pdf", pdf))
                        .param("category", "aadhaar")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.url").doesNotExist())
                .andReturn().getResponse().getContentAsString();

        String docId = JSON.readTree(body).get("id").asText();
        String signed = JSON.readTree(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(Routes.MeDocuments.URL, docId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()).get("url").asText();
        String key = null;

        try {
            // Listed by prefix rather than trusting the URL: the key is what the row persists, and the prefix
            // is what makes one owner's documents unreachable from another's id.
            key = onlyKeyUnder("personal/" + owner.getId() + "/");
            assertThat(key).isNotNull();

            // Signed: opens, and the bytes are the ones uploaded.
            HttpResponse<byte[]> ok = get(signed);
            assertThat(ok.statusCode()).isEqualTo(200);
            assertThat(ok.body()).isEqualTo(pdf);

            // Asserted as "4xx and not the file": R2 answers a missing Authorization header with 400, S3 with 403;
            // pinning either would test Cloudflare's error taxonomy, not our documents staying unreadable.
            HttpResponse<byte[]> denied = get(stripQuery(signed));
            assertThat(denied.statusCode()).isBetween(400, 499);
            assertThat(denied.body()).isNotEqualTo(pdf);
        } finally {
            if (key != null) {
                deleteQuietly(props.privateBucket(), key);
            }
        }
    }

    /** Returns {@code null} for an empty prefix so the assertion says "nothing was stored", not an index error. */
    private String onlyKeyUnder(String prefix) {
        try (S3Client s3 = s3()) {
            ListObjectsV2Response res = s3.listObjectsV2(ListObjectsV2Request.builder()
                    .bucket(props.privateBucket()).prefix(prefix).build());
            return res.contents().stream().map(S3Object::key).findFirst().orElse(null);
        }
    }

    private void deleteQuietly(String bucket, String key) {
        try (S3Client s3 = s3()) {
            s3.deleteObject(b -> b.bucket(bucket).key(key));
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

    private static HttpResponse<byte[]> get(String url) throws Exception {
        return HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create(url)).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray());
    }

    private static String stripQuery(String url) {
        int q = url.indexOf('?');
        return q < 0 ? url : url.substring(0, q);
    }

    /** Starts with a real PDF signature: {@code DocumentUploads} sniffs content, so arbitrary bytes
     * would be refused as "not a PDF" before storage is reached. */
    private static byte[] pdfBytes(String marker) {
        return ("%PDF-1.4\n" + marker + "\n%%EOF\n").getBytes(StandardCharsets.UTF_8);
    }

    private User user(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Live Document Uploader");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }
}
