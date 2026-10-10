package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.photo.PhotoKeys;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.provider.FileStorage;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
class ListingPhotoSources {

    private final FileStorage storage;
    private final PhotoKeys keys;

    ListingPhotoSources(FileStorage storage, PhotoKeys keys) {
        this.storage = storage;
        this.keys = keys;
    }

    void requireUploaded(Collection<String> urls, Collection<String> alreadyHeld, Collection<UUID> ownerIds) {
        if (urls == null) {
            return;
        }
        List<String> fresh = urls.stream()
                .filter(url -> url != null && !url.isBlank() && (alreadyHeld == null || !alreadyHeld.contains(url)))
                .toList();
        if (fresh.isEmpty()) {
            return;
        }
        String prefix = storage.publicUrlPrefix();
        Collection<UUID> owners = ownerIds == null ? List.of() : ownerIds;
        if (fresh.stream().anyMatch(url -> !url.startsWith(prefix)
                || !keys.uploadedBy(url.substring(prefix.length()), owners))) {
            throw new ValidationException("Photos must be uploaded through Draazy, not linked from another site.");
        }
    }
}
