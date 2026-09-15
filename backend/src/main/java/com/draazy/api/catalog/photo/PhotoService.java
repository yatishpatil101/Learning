package com.draazy.api.catalog.photo;

import com.draazy.api.common.error.PayloadTooLargeException;
import com.draazy.api.provider.FileStorage;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * Uploads a listing photo to the <strong>public</strong> bucket and hands back its CDN URL.
 * Stateless, server-minted keys: docs/system/cross-cutting.md#87-uploads.
 */
@Service
public class PhotoService {

    private final FileStorage storage;

    public PhotoService(FileStorage storage) {
        this.storage = storage;
    }

    public PhotoDto upload(UUID ownerId, MultipartFile file) {
        // Reject a known oversized upload before buffering; validation also checks the actual bytes.
        if (file.getSize() >= PhotoUploads.MAX_BYTES) {
            throw new PayloadTooLargeException("Photos must be smaller than 1,000,000 bytes (1 MB)");
        }
        byte[] bytes = readBytes(file);
        String type = PhotoUploads.validate(file.getContentType(), file.getSize(), bytes);

        String key = "photos/" + ownerId + "/" + UUID.randomUUID();
        return new PhotoDto(storage.storePublic(key, bytes, type));
    }

    private static byte[] readBytes(MultipartFile file) {
        try {
            return file.getBytes();
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException("cannot read uploaded photo", e);
        }
    }
}
