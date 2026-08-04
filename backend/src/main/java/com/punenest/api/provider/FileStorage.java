package com.punenest.api.provider;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Seam for object storage of documents/images (agreements, KYC docs, listing photos). Callers deal
 * only in opaque {@code key}s and signed URLs, never the storage vendor. Dev returns fake-but-shaped
 * URLs so the whole upload/download flow is demoable with no bucket and no keys.
 */
public interface FileStorage {

    /**
     * Persist the bytes of an upload under {@code key}, overwriting any previous object there.
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

    /** A time-limited URL the client can PUT to. */
    String signedUploadUrl(String key);

    /** A time-limited URL the client can GET from. */
    String signedDownloadUrl(String key);
}

/**
 * Dev/default: deterministic fake signed URLs, with the bytes written to a local directory so an
 * upload is a real side effect rather than a shape.
 */
@Component
@Profile("!prod")
class MockFileStorage implements FileStorage {

    private static final String BASE = "https://mock.storage.local/";

    private final Path root;

    MockFileStorage(@Value("${punenest.storage.dir:${java.io.tmpdir}/punenest-storage}") String root) {
        this.root = Path.of(root);
    }

    @Override
    public void store(String key, byte[] content, String contentType) {
        // The key is server-minted today, so traversal is not currently reachable. Checked rather
        // than trusted because this seam is one careless refactor — "just use the filename" — away
        // from writing wherever the caller asks.
        Path base = root.normalize();
        Path target = base.resolve(key).normalize();
        if (!target.startsWith(base)) {
            throw new IllegalArgumentException("storage key escapes the storage root: " + key);
        }
        try {
            Files.createDirectories(target.getParent());
            Files.write(target, content, StandardOpenOption.CREATE,
                    StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE);
        } catch (IOException e) {
            throw new UncheckedIOException("cannot store object " + key, e);
        }
    }

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
}
