package com.punenest.api.catalog.photo;

import com.punenest.api.common.error.PayloadTooLargeException;
import com.punenest.api.provider.FileStorage;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * Uploads a listing photo to the <strong>public</strong> bucket and hands back its CDN URL.
 *
 * <p><strong>Stateless by design.</strong> Unlike the document vault, this writes no row and touches
 * no {@link com.punenest.api.catalog.property.Property}. In the create-listing wizard the photos are
 * chosen before the property exists, so there is nothing to attach them to yet; and the listing
 * create/update contract already persists whatever image URLs it is given. This service's whole job
 * is to turn bytes into a hosted URL — the URL then rides along with the listing like any other.
 *
 * <p><strong>The key is server-minted.</strong> {@code photos/{ownerId}/{uuid}} — the client's
 * filename decides nothing, so a traversal or an overwrite of someone else's object is impossible by
 * construction rather than by sanitising. Scoping the prefix by {@code ownerId} keeps one owner's
 * uploads from colliding with another's even before a listing ties them together.
 *
 * <p><strong>The stored content type is the one the bytes prove.</strong> {@link PhotoUploads}
 * sniffs the file and returns the type its signature actually describes; that is what reaches the
 * bucket, so the CDN can never be coaxed into serving a mislabelled file as active content.
 */
@Service
public class PhotoService {

    private final FileStorage storage;

    public PhotoService(FileStorage storage) {
        this.storage = storage;
    }

    /**
     * Validate an uploaded image and store it world-readable, returning its CDN URL.
     *
     * @param ownerId the authenticated uploader; scopes the storage key
     * @param file    the multipart image
     * @return the public CDN URL of the stored photo
     * @throws com.punenest.api.common.error.UnsupportedMediaTypeException for a non-image (or SVG/HTML)
     * @throws com.punenest.api.common.error.PayloadTooLargeException      for an oversized file
     */
    public PhotoDto upload(UUID ownerId, MultipartFile file) {
        // Reject oversize before pulling the whole upload into the heap. The container's multipart cap
        // still bounds the request, but this keeps a 5-6 MB file from being fully buffered only to be
        // thrown away — the declared size is trustworthy enough for a cheap early-out, and PhotoUploads
        // re-checks against the real byte count once the bytes are in hand.
        if (file.getSize() > PhotoUploads.MAX_BYTES) {
            throw new PayloadTooLargeException("That photo is too large to upload (max 5 MB)");
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
