package com.draazy.api.provider;

import com.draazy.api.provider.storage.DevObjectStore;
import com.draazy.api.security.DevOnly;
import com.draazy.api.security.DevProfileGuard;
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
     * <p><strong>Deployment requirement: the public bucket must send
     * {@code Access-Control-Allow-Origin}.</strong> A listing photo is not only rendered. The
     * create-listing wizard draws each one to a {@code <canvas>} to compute a perceptual hash, which
     * the duplicate probe compares across owners, and reading pixels back from a canvas that has
     * drawn a cross-origin image throws unless that image arrived with CORS headers. The failure is
     * silent by construction — the client degrades to no hashes, the listing posts normally, and the
     * only symptom is that duplicate listings sharing photographs stop being flagged. Nothing in
     * this repository can assert it: the URL is R2's, the header is bucket configuration, and the
     * dev stand-in is same-origin (see {@code DevObjectStore.publicUrl}), so no test here will ever
     * go red if the rule is missing. It is written down because that is the only control available.
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
 * <p>Also steps aside when {@code draazy.providers.storage.enabled=true}: a developer with real R2
 * sandbox keys exercises {@link com.draazy.api.provider.storage.R2FileStorage} instead, so the
 * flag wins over the profile.
 *
 * <p>The download URL used to point at {@code https://mock.storage.local/}, a host that does not
 * resolve, so every document read in dev returned a {@code url} nothing could open (D120). It now
 * delegates to {@link com.draazy.api.provider.storage.DevObjectStore}, which serves the bytes
 * this class already wrote. {@link #storePublic} had the same defect and kept it three years
 * longer; it was fixed the same way in D246, for a reason documented on the method. Signed
 * <em>uploads</em> remain on the fake host — nothing consumes {@code signedUploadUrl} yet, and
 * inventing a dev receiver for a flow no client uses would be shape without a caller.
 */
@Component
@DevOnly
@ConditionalOnProperty(prefix = "draazy.providers.storage", name = "enabled",
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
        // Same on-disk write as store(), under a public/ prefix, and the URL is deliberately
        // unsigned and non-expiring — mirroring the real public bucket, whose objects are
        // world-readable and whose URLs are persisted on the listing row.
        //
        // This used to answer on https://mock.storage.local/, a host that does not resolve, on the
        // reasoning that listing photos are persisted and changing the shape would rewrite what is
        // in the database. That reasoning held for the URL as a stored string and missed what the
        // browser does with it: no listing photo uploaded in dev had ever rendered, and — the
        // reason this changed (D246) — the create-listing wizard hashes each photo through a canvas
        // to detect duplicate listings, so the hash of an image that cannot load is nothing at all.
        // The whole photo arm of the duplicate probe was unreachable from a browser here, and no
        // test could see it, because the only URL dev ever produced was dead.
        store(DevObjectStore.PUBLIC_PREFIX + key, content, contentType);
        return objects.publicUrl(DevObjectStore.PUBLIC_PREFIX + key);
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
 * <p>Steps aside when {@code draazy.providers.storage.enabled=true}: a real deployment with R2
 * keys gets {@link com.draazy.api.provider.storage.R2FileStorage} rather than this stub.
 */
@Component
@Profile(DevProfileGuard.NOT_DEV)
@ConditionalOnProperty(prefix = "draazy.providers.storage", name = "enabled",
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
