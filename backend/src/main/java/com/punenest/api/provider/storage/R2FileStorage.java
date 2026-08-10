package com.punenest.api.provider.storage;

import com.punenest.api.provider.FileStorage;
import java.net.URI;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

/**
 * Cloudflare R2 {@link FileStorage}, wired only when {@code punenest.providers.storage.enabled=true}
 * (ADR-013). R2 speaks the S3 API, so the AWS SDK v2 client points at the account endpoint with the
 * pseudo-region {@code auto} and path-style addressing (R2 does not do virtual-host buckets).
 *
 * <p>With the flag off this bean does not exist at all, which is stronger than a runtime {@code if}:
 * there is no code path, live or accidental, that reaches R2. The mock/stub storage is wired in its
 * place.
 *
 * <p><strong>Two buckets (ADR-013).</strong> Documents go to the private bucket ({@link #store},
 * read back through short-lived signed GETs); listing photos go to the public bucket ({@link
 * #storePublic}, served world-readable at a permanent CDN URL). Routing them to different buckets
 * here is what makes the interface's public/private boundary real at the vendor — a KYC file can
 * never come back as an unsigned, non-expiring URL because it never reaches the public bucket.
 */
@Component
@ConditionalOnProperty(prefix = "punenest.providers.storage", name = "enabled", havingValue = "true")
class R2FileStorage implements FileStorage, DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(R2FileStorage.class);

    /** Signed URLs are single-request handoffs; fifteen minutes is generous for one PUT or GET. */
    private static final Duration URL_TTL = Duration.ofMinutes(15);

    private final S3Client s3;
    private final S3Presigner presigner;
    private final String privateBucket;
    private final String publicBucket;
    private final String publicBaseUrl;

    R2FileStorage(R2Properties props) {
        if (isBlank(props.endpoint()) || isBlank(props.accessKeyId())
                || isBlank(props.secretAccessKey()) || isBlank(props.privateBucket())
                || isBlank(props.publicBucket()) || isBlank(props.publicBaseUrl())) {
            throw new IllegalStateException(
                    "punenest.providers.storage.enabled=true but endpoint/access-key-id/"
                            + "secret-access-key/private-bucket/public-bucket/public-base-url are "
                            + "not all set — refusing to start rather than accept objects R2 cannot "
                            + "keep or serve");
        }
        this.privateBucket = props.privateBucket();
        this.publicBucket = props.publicBucket();
        // Trim a trailing slash so the public URL joins cleanly however the base URL was configured.
        this.publicBaseUrl = stripTrailingSlash(props.publicBaseUrl());
        StaticCredentialsProvider creds = StaticCredentialsProvider.create(
                AwsBasicCredentials.create(props.accessKeyId(), props.secretAccessKey()));
        URI endpoint = URI.create(props.endpoint());
        S3Configuration cfg = S3Configuration.builder().pathStyleAccessEnabled(true).build();
        this.s3 = S3Client.builder()
                .endpointOverride(endpoint)
                .region(Region.of("auto"))
                .credentialsProvider(creds)
                .serviceConfiguration(cfg)
                .build();
        this.presigner = S3Presigner.builder()
                .endpointOverride(endpoint)
                .region(Region.of("auto"))
                .credentialsProvider(creds)
                .serviceConfiguration(cfg)
                .build();
        log.info("R2 object storage enabled (private bucket '{}', public bucket '{}')",
                privateBucket, publicBucket);
    }

    @Override
    public void store(String key, byte[] content, String contentType) {
        s3.putObject(
                PutObjectRequest.builder()
                        .bucket(privateBucket)
                        .key(key)
                        .contentType(contentType)
                        .build(),
                RequestBody.fromBytes(content));
    }

    @Override
    public String signedUploadUrl(String key) {
        PutObjectPresignRequest req = PutObjectPresignRequest.builder()
                .signatureDuration(URL_TTL)
                .putObjectRequest(PutObjectRequest.builder().bucket(privateBucket).key(key).build())
                .build();
        return presigner.presignPutObject(req).url().toString();
    }

    @Override
    public String signedDownloadUrl(String key) {
        GetObjectPresignRequest req = GetObjectPresignRequest.builder()
                .signatureDuration(URL_TTL)
                .getObjectRequest(GetObjectRequest.builder().bucket(privateBucket).key(key).build())
                .build();
        return presigner.presignGetObject(req).url().toString();
    }

    @Override
    public String storePublic(String key, byte[] content, String contentType) {
        s3.putObject(
                PutObjectRequest.builder()
                        .bucket(publicBucket)
                        .key(key)
                        .contentType(contentType)
                        .build(),
                RequestBody.fromBytes(content));
        return publicBaseUrl + "/" + key;
    }

    @Override
    public void destroy() {
        s3.close();
        presigner.close();
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static String stripTrailingSlash(String s) {
        return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }
}
