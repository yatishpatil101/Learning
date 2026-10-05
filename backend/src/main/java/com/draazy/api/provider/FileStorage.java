package com.draazy.api.provider;

import com.draazy.api.provider.storage.DevObjectStore;
import com.draazy.api.security.LocalOnly;
import com.draazy.api.security.LocalProfileGuard;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

// Private and public are separate methods on separate buckets, so a KYC file cannot take the unsigned path.
public interface FileStorage {

    void store(String key, byte[] content, String contentType);

    /** A time-limited URL the client can PUT to (private bucket). */
    String signedUploadUrl(String key);

    /** A time-limited URL the client can GET from (private bucket). */
    String signedDownloadUrl(String key);

    void delete(String key);

    String storePublic(String key, byte[] content, String contentType);

    String publicUrlPrefix();
    }

// Dev only: bytes written to a local directory, and signed URLs that resolve to them.
// Opted into by the `dev` profile, and stands aside when real R2 sandbox keys are configured.
@Component
@LocalOnly
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
    public void delete(String key) {
        objects.delete(key);
    }

    @Override
    public String storePublic(String key, byte[] content, String contentType) {

        // Unsigned and non-expiring, mirroring the real public bucket, and relative so the wizard's
        // canvas hash sees a same-origin image rather than a tainted one.
        store(DevObjectStore.PUBLIC_PREFIX + key, content, contentType);
        return objects.publicUrl(DevObjectStore.PUBLIC_PREFIX + key);
    }

    @Override
    public String publicUrlPrefix() {
        return objects.publicUrl(DevObjectStore.PUBLIC_PREFIX);
    }
    }

// Everywhere but dev: fail on use until a real object store is wired in.
// Deliberately not `LocalOnly` — it is the safe default, so an unconfigured deploy fails loudly, not silently.
@Component
@Profile(LocalProfileGuard.NOT_LOCAL)
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
    public void delete(String key) {
        throw new UnsupportedOperationException("Object storage not configured for prod yet");
    }

    @Override
    public String storePublic(String key, byte[] content, String contentType) {
        throw new UnsupportedOperationException("Object storage not configured for prod yet");
    }

    @Override
    public String publicUrlPrefix() {
        throw new UnsupportedOperationException("Object storage not configured for prod yet");
    }
    }
