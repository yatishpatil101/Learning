package com.punenest.api.provider;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Seam for object storage of documents/images (agreements, KYC docs, listing photos). Callers deal
 * only in opaque {@code key}s and signed URLs, never the storage vendor. Dev returns fake-but-shaped
 * URLs so the whole upload/download flow is demoable with no bucket and no keys.
 */
public interface FileStorage {

    /** A time-limited URL the client can PUT to. */
    String signedUploadUrl(String key);

    /** A time-limited URL the client can GET from. */
    String signedDownloadUrl(String key);
}

/** Dev/default: deterministic fake signed URLs. */
@Component
@Profile("!prod")
class MockFileStorage implements FileStorage {

    private static final String BASE = "https://mock.storage.local/";

    @Override
    public String signedUploadUrl(String key) {
        return BASE + key + "?op=put&sig=dev";
    }

    @Override
    public String signedDownloadUrl(String key) {
        return BASE + key + "?op=get&sig=dev";
    }
}

/** Prod stub: fail until a real object store (e.g. S3-compatible) is wired in. */
@Component
@Profile("prod")
class ObjectStoreFileStorage implements FileStorage {

    @Override
    public String signedUploadUrl(String key) {
        throw new UnsupportedOperationException("Object storage not configured for prod yet");
    }

    @Override
    public String signedDownloadUrl(String key) {
        throw new UnsupportedOperationException("Object storage not configured for prod yet");
    }
}
