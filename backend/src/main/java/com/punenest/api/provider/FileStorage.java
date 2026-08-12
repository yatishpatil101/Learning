package com.punenest.api.provider;

import com.punenest.api.provider.storage.DevObjectStore;
import com.punenest.api.security.DevOnly;
import com.punenest.api.security.DevProfileGuard;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Seam for object storage of documents and images. Callers deal only in opaque {@code key}s, signed
 * URLs and (for public assets) permanent CDN URLs — never the storage vendor. Dev returns
 * fake-but-shaped URLs so the whole upload/download flow is demoable with no bucket and no keys.
 *
 * <p><strong>Two access models, two buckets (ADR-013).</strong>
 * <ul>
 *   <li><em>Private</em> — {@link #store} plus {@link #signedDownloadUrl}: the object is
 *       world-unreadable and every read is a fresh, expiring signed GET. This is the vault model
 *       for KYC and property documents.</li>
 *   <li><em>Public</em> — {@link #storePublic}: the object is world-readable at a permanent CDN URL
 *       that needs no signature. This is the model for listing photos.</li>
 * </ul>
 * The two are separate methods, routed to separate buckets, precisely so a document can never take
 * the public path by mistake — a KYC file answered with an unsigned, non-expiring URL would be a
 * data leak, not a bug in the caller.
 */
public interface FileStorage {

    /**
     * Persist the bytes of an upload under {@code key} in the <strong>private</strong> bucket,
     * overwriting any previous object there. The stored object is only ever readable through
     * {@link #signedDownloadUrl}.
     *
     * <p>Added in slice 10. Before it, this interface could only <em>describe</em> where a file
     * would live; {@code POST /me/documents/{propId}} would have written a row naming an object
     * that was never stored, and the failure would surface much later, when someone followed the
     * URL. Taking {@code byte[]} rather than a {@code MultipartFile} keeps Spring's web types out
     * of the provider layer, which is the boundary that lets this be swapped for S3.
     *
     * @throws UncheckedIOException if the bytes cannot be written — an upload that did not store is
     *                              a failed upload, never a 201
     */
    void store(String key, byte[] content, String contentType);

    /** A time-limited URL the client can PUT to (private bucket). */
    String signedUploadUrl(String key);

    /** A time-limited URL the client can GET from (private bucket). */
    String signedDownloadUrl(String key);

    /**
     * Persist the bytes under {@code key} in the <strong>public</strong> bucket and return the
     * permanent, world-readable CDN URL for the object. For assets that are meant to be public —
     * listing photos — and <strong>never</strong> for documents: the returned URL carries no
     * signature and does not expire, so persist it directly on the listing.
     *
     * @return the CDN URL at which the object is now served, with no signing required
     * @throws UncheckedIOException if the bytes cannot be written
     */
    String storePublic(String key, byte[] content, String contentType);
}


/**
 * Dev only: bytes written to a local directory, and signed URLs that actually resolve to them.
 *
 * <p>Opt-in under the {@code dev} profile rather than excluded from {@code prod} (D147). The bytes
 * go to a container filesystem that vanishes with the container — a deployment that inherited this
 * by mistake would accept KYC documents and agreements, answer 201, and lose them.
 *
 * <p>Also steps aside when {@code punenest.providers.storage.enabled=true}: a developer with real R2
 * sandbox keys exercises {@link com.punenest.api.provider.storage.R2FileStorage} instead, so the
 * flag wins over the profile.
 *
 * <p>The download URL used to point at {@code https://mock.storage.local/}, a host that does not
 * resolve, so every document read in dev returned a {@code url} nothing could open (D120). It now
 * delegates to {@link com.punenest.api.provider.storage.DevObjectStore}, which serves the bytes
 * this class already wrote. Uploads are untouched — nothing consumes {@code signedUploadUrl} yet,
 * and inventing a dev receiver for a flow no client uses would be shape without a caller.
 */
@Component
@DevOnly
@ConditionalOnProperty(prefix = "punenest.providers.storage", name = "enabled",
        havingValue = "false", matchIfMissing = true)
class MockFileStorage implements FileStorage {

    private static final String BASE = "https://mock.storage.local/";

    private final DevObjectStore objects;

    MockFileStorage(DevObjectStore objects) {
        this.objects = objects;
    }

    @Override
    public void store(String key, byte[] content, String contentType) {
        objects.store(key, content, contentType);
    }

    @Override
    public String signedUploadUrl(String key) {
        return BASE + key + "?op=put&sig=dev";
    }

    @Override
    public String signedDownloadUrl(String key) {
        return objects.downloadUrl(key);
    }

    @Override
    public String storePublic(String key, byte[] content, String contentType) {
        // Same on-disk write as store(), under a public/ prefix, but the URL is deliberately
        // unsigned — mirroring the real public bucket, whose objects are world-readable. Left on
        // the fake host: listing photos are persisted on the listing row, so changing this shape
        // would rewrite what is already in the database rather than what is served today.
        store("public/" + key, content, contentType);
        return BASE + "public/" + key;
    }
}

/**
 * Everywhere but dev: fail until a real object store is wired in (ADR-013 chose Cloudflare R2; no
 * client is written yet). Failing on use is the intended behaviour — an unconfigured deployment must
 * not quietly accept documents it cannot keep.
 *
 * <p>Deliberately <strong>not</strong> {@link DevOnly} — this is the safe default, so it must
 * survive exactly where the dev beans are refused. A deploy that never chose a storage vendor lands
 * here and fails loudly on the first upload, rather than on the mock, which would answer 201 and
 * write the bytes to a container filesystem that disappears with the container.
 *
 * <p>Steps aside when {@code punenest.providers.storage.enabled=true}: a real deployment with R2
 * keys gets {@link com.punenest.api.provider.storage.R2FileStorage} rather than this stub.
 */
@Component
@Profile(DevProfileGuard.NOT_DEV)
@ConditionalOnProperty(prefix = "punenest.providers.storage", name = "enabled",
        havingValue = "false", matchIfMissing = true)
class ObjectStoreFileStorage implements FileStorage {

    @Override
    public void store(String key, byte[] content, String contentType) {
        throw new UnsupportedOperationException("Object storage not configured for prod yet");
    }

    @Override
    public String signedUploadUrl(String key) {
        throw new UnsupportedOperationException("Object storage not configured for prod yet");
    }

    @Override
    public String signedDownloadUrl(String key) {
        throw new UnsupportedOperationException("Object storage not configured for prod yet");
    }

    @Override
    public String storePublic(String key, byte[] content, String contentType) {
        throw new UnsupportedOperationException("Object storage not configured for prod yet");
    }
}
