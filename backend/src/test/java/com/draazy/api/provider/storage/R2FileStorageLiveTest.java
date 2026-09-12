package com.draazy.api.provider.storage;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;

/**
 * Live round-trip against the real Cloudflare R2 sandbox buckets. Runs only when {@code
 * STORAGE_ENABLED=true} and the {@code R2_*} credentials are present in the environment, so a normal
 * offline suite skips it. No {@code @SpringBootTest} and no database: it constructs {@link
 * R2FileStorage} directly from the environment.
 *
 * <p>Exercises <strong>both</strong> halves of the public/private boundary (ADR-013):
 * <ul>
 *   <li>private — {@code store} then a short-lived signed GET reads the bytes back;</li>
 *   <li>public — {@code storePublic} then a read back <em>from the public bucket</em> (via the S3
 *       API) confirms the bytes landed in the public bucket, not the private one, and that the
 *       returned URL is the public CDN URL.</li>
 * </ul>
 *
 * <p>The public leg deliberately reads back through the S3 API rather than fetching the returned
 * {@code r2.dev} URL directly: that dev domain is TLS-blocked by the corporate proxy here, and in
 * production photos are served from a custom domain rather than {@code r2.dev} anyway. Whether the
 * object is <em>world-readable</em> is a Cloudflare bucket setting, not something this code decides;
 * what the code owns — putting the bytes in the public bucket and returning the CDN URL — is what
 * this asserts.
 */
@EnabledIfEnvironmentVariable(named = "STORAGE_ENABLED", matches = "true")
class R2FileStorageLiveTest {

    @Test
    void privateBucketStoresAndReadsBackViaSignedUrl() throws Exception {
        R2Properties props = props();
        R2FileStorage storage = new R2FileStorage(props);
        String key = "it/" + UUID.randomUUID() + ".txt";
        byte[] body = ("draazy-r2-private-" + UUID.randomUUID()).getBytes(StandardCharsets.UTF_8);

        try {
            storage.store(key, body, "text/plain");

            HttpResponse<byte[]> res = get(storage.signedDownloadUrl(key));

            assertThat(res.statusCode()).isEqualTo(200);
            assertThat(res.body()).isEqualTo(body);
        } finally {
            deleteQuietly(props, props.privateBucket(), key);
            storage.destroy();
        }
    }

    @Test
    void publicBucketStoresObjectAndReturnsCdnUrl() throws Exception {
        R2Properties props = props();
        R2FileStorage storage = new R2FileStorage(props);
        String key = "it/" + UUID.randomUUID() + ".txt";
        byte[] body = ("draazy-r2-public-" + UUID.randomUUID()).getBytes(StandardCharsets.UTF_8);

        try {
            String url = storage.storePublic(key, body, "text/plain");

            // The returned URL must be the public CDN URL for this key.
            assertThat(url).isEqualTo(stripTrailingSlash(props.publicBaseUrl()) + "/" + key);

            // Read the bytes back from the PUBLIC bucket (via the S3 API, which is reachable) to
            // prove the object landed in the public bucket specifically — not the private one, and
            // not merely that putObject did not throw. The unsigned r2.dev serving is a Cloudflare
            // bucket setting exercised in prod via a custom domain, and r2.dev is proxy-blocked here.
            byte[] readBack = readFromBucket(props, props.publicBucket(), key);
            assertThat(readBack).isEqualTo(body);
        } finally {
            deleteQuietly(props, props.publicBucket(), key);
            storage.destroy();
        }
    }

    private static byte[] readFromBucket(R2Properties props, String bucket, String key) {
        try (S3Client s3 = s3(props)) {
            return s3.getObjectAsBytes(
                    GetObjectRequest.builder().bucket(bucket).key(key).build()).asByteArray();
        }
    }

    private static HttpResponse<byte[]> get(String url) throws Exception {
        return HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create(url)).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray());
    }

    private static R2Properties props() {
        return new R2Properties(
                true,
                require("R2_ENDPOINT"),
                require("R2_ACCESS_KEY_ID"),
                require("R2_SECRET_ACCESS_KEY"),
                require("R2_BUCKET_PUBLIC"),
                require("R2_BUCKET_PRIVATE"),
                require("R2_PUBLIC_BASE_URL"));
    }

    private static void deleteQuietly(R2Properties props, String bucket, String key) {
        try (S3Client s3 = s3(props)) {
            s3.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
        } catch (RuntimeException ignored) {
            // best-effort cleanup; a leaked sandbox test object is harmless
        }
    }

    private static S3Client s3(R2Properties props) {
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

    private static String require(String name) {
        String v = System.getenv(name);
        if (v == null || v.isBlank()) {
            throw new IllegalStateException("env var " + name + " must be set for the live R2 test");
        }
        return v;
    }
}
