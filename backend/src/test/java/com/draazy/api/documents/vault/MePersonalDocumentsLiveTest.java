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

/**
 * The private half of the public/private boundary (ADR-013), end to end through the server: a KYC
 * file POSTed to {@code /me/documents/personal} lands in the <em>private</em> bucket, the {@code
 * url} on the response opens because it is signed, and the same URL <em>without</em> its signature
 * is refused by Cloudflare.
 *
 * <p><strong>Why this exists alongside {@code R2FileStorageLiveTest}.</strong> That test proves
 * {@code R2FileStorage} can round-trip bytes; it constructs the class directly and knows the key it
 * used. It cannot say whether the endpoint the browser actually calls routes documents to the
 * private bucket, because it never calls it. The routing decision — {@code store} to private, {@code
 * storePublic} to public — is the entire boundary, and until now nothing exercised it above the
 * storage class. {@code MePhotosLiveTest} is the mirror of this for the public half.
 *
 * <p>The refusal is asserted as a 4xx that does not carry the file, not as a particular status: R2
 * rejects an unsigned S3-API GET with {@code 400} (no {@code Authorization} header) where AWS S3
 * would answer {@code 403}, and pinning either number would turn this into a test of Cloudflare's
 * error taxonomy rather than of our boundary.
 *
 * <p><strong>Why "unsigned is refused" and not "expired is refused".</strong> The presign window is
 * fifteen minutes and hard-coded, so a genuinely stale URL cannot be produced inside a test without
 * either waiting or making the window configurable to prove something about a value production does
 * not use. Stripping the signature tests the property that actually protects the documents: the
 * object is not world-readable at rest, so authority lives in the signature and nowhere else. A URL
 * copied out of one owner's dashboard is dangerous only for as long as its signature is valid; a
 * bucket that served the object unsigned would be dangerous forever, and that is the failure this
 * catches.
 *
 * <p>Gated on {@code STORAGE_ENABLED=true} plus the {@code R2_*} credentials, like its two
 * siblings, so an ordinary offline suite skips it.
 */
@EnabledIfEnvironmentVariable(named = "STORAGE_ENABLED", matches = "true")
class MePersonalDocumentsLiveTest extends AbstractApiTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    /**
     * The test-classpath {@code application.properties} shadows main's and omits the storage block,
     * so without this the flag would be off and the mock would wire. Same binding as {@code
     * MePhotosLiveTest}.
     */
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
                .andExpect(jsonPath("$.url").exists())
                .andReturn().getResponse().getContentAsString();

        String signed = JSON.readTree(body).get("url").asText();
        String key = null;

        try {
            // The object is in the PRIVATE bucket under the owner-scoped, server-minted key. Listing
            // by prefix rather than trusting the URL: the key is what the row persists, and the
            // prefix is the thing that makes one owner's documents unreachable from another's id.
            key = onlyKeyUnder("personal/" + owner.getId() + "/");
            assertThat(key).isNotNull();

            // Signed: opens, and the bytes are the ones uploaded.
            HttpResponse<byte[]> ok = get(signed);
            assertThat(ok.statusCode()).isEqualTo(200);
            assertThat(ok.body()).isEqualTo(pdf);

            // Unsigned: the identical object, addressed without the query-string signature, is
            // refused and the bytes are not served. Asserted as "4xx and not the file" rather than
            // a specific code — R2 answers a missing Authorization header with 400 where AWS S3
            // would say 403, and pinning either would make this an assertion about Cloudflare's
            // error taxonomy instead of about our documents staying unreadable.
            HttpResponse<byte[]> denied = get(stripQuery(signed));
            assertThat(denied.statusCode()).isBetween(400, 499);
            assertThat(denied.body()).isNotEqualTo(pdf);
        } finally {
            if (key != null) {
                deleteQuietly(props.privateBucket(), key);
            }
        }
    }

    /**
     * The one key under this owner's prefix. Returns {@code null} when the prefix is empty, so the
     * assertion above reports "nothing was stored" rather than an index-out-of-bounds.
     */
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

    /**
     * A file whose first bytes are a real PDF signature. {@code DocumentUploads} sniffs the content
     * rather than trusting the declared type or the extension, so a payload of arbitrary bytes would
     * be refused as "not a PDF" before storage is ever reached.
     */
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
