package com.draazy.api.provider.storage;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Cloudflare R2 credentials, endpoint and bucket names, plus the master on/off switch for the
 * R2-backed {@code FileStorage} implementation.
 *
 * <p><strong>Why a flag rather than the {@code prod} profile.</strong> The storage seam was
 * originally split {@code @DevOnly} (mock) / {@code @Profile(NOT_DEV)} (throwing stub), which
 * conflates two independent questions: <em>which environment is this</em> and <em>do we have an
 * object store wired</em>. That is wrong in both directions — a production deployment could not run
 * on the local-disk mock during a soft launch, and a developer holding real sandbox keys could
 * never exercise the real client without pretending to be production. This flag lets the two come
 * apart: R2 is used wherever {@code enabled=true}, on any profile.
 *
 * <p>Default is <strong>off</strong>, deliberately. A missing configuration value should land on the
 * behaviour that cannot leak documents or point at a bucket that is not ours, so turning R2 on
 * requires saying so explicitly.
 *
 * <p>Credentials are environment-supplied and have <strong>no committed default</strong>: a blank
 * key would produce confusing 403s from R2 rather than an obvious local misconfiguration. {@link
 * R2FileStorage} therefore refuses to construct when the flag is on and any of the endpoint, keys,
 * buckets or public base URL are missing, so boot fails at startup rather than at the first user's
 * upload.
 *
 * <p><strong>Two buckets (ADR-013).</strong> A public bucket (listing photos, served world-readable
 * via the R2 CDN at {@code publicBaseUrl}) and a private bucket (KYC and property documents,
 * reachable only through short-lived signed GETs). Both are wired: {@link R2FileStorage} routes
 * documents to the private bucket and photos to the public bucket, which is what makes the
 * public/private boundary real at the vendor rather than only in the interface.
 *
 * @param enabled         when {@code false} (the default) the mock/stub storage is wired and no R2
 *                        call is ever made
 * @param endpoint        the account-scoped S3 API endpoint,
 *                        {@code https://<accountId>.r2.cloudflarestorage.com}
 * @param publicBaseUrl   the CDN base URL for objects in the public bucket (photos)
 */
@ConfigurationProperties("draazy.providers.storage")
public record R2Properties(
        boolean enabled,
        String endpoint,
        String accessKeyId,
        String secretAccessKey,
        String publicBucket,
        String privateBucket,
        String publicBaseUrl) {

    /**
     * Redacts the credentials. The compiler-generated {@code toString()} would render both the
     * access key and secret in plaintext, so any stray {@code log.debug("{}", props)} or exception
     * carrying this record would leak them; overriding it removes that footgun at the source.
     */
    @Override
    public String toString() {
        return "R2Properties[enabled=" + enabled
                + ", endpoint=" + endpoint
                + ", accessKeyId=***, secretAccessKey=***"
                + ", publicBucket=" + publicBucket
                + ", privateBucket=" + privateBucket
                + ", publicBaseUrl=" + publicBaseUrl + "]";
    }
}
