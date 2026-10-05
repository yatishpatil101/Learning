package com.draazy.api.catalog.photo;

import com.draazy.api.catalog.property.PhotoHash;
import com.draazy.api.common.error.PayloadTooLargeException;
import com.draazy.api.common.validation.MediaSignatures;
import com.draazy.api.provider.FileStorage;
import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class PhotoService {

    private static final Logger log = LoggerFactory.getLogger(PhotoService.class);

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
        bytes = ImageMetadataStripper.strip(type, bytes);
        PhotoUploads.validate(type, bytes.length, bytes);

        String key = "photos/" + ownerId + "/" + UUID.randomUUID();
        Long hash = PhotoHash.compute(bytes);
        if (hash != null) {
            key += "-" + PhotoHash.toHex(hash);
        }
        storeVariants(key, bytes);
        return new PhotoDto(storage.storePublic(key, bytes, type));
    }

    // Copies first, so a URL this returns never has a missing copy. Best effort: a card whose copy is
    // missing (an older or undecodable photo) falls back to the original in PropertyImage.jsx.
    private void storeVariants(String key, byte[] bytes) {
        Map<Integer, byte[]> variants;
        try {
            variants = PhotoVariants.of(bytes);
        } catch (IOException | RuntimeException e) {
            log.warn("No card-size copies for {}: {}", key, e.toString());
            return;
        }
        variants.forEach((width, jpeg) ->
                storage.storePublic(PhotoVariants.key(key, width), jpeg, MediaSignatures.JPEG));
    }

    private static byte[] readBytes(MultipartFile file) {
        try {
            return file.getBytes();
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException("cannot read uploaded photo", e);
        }
    }
}
