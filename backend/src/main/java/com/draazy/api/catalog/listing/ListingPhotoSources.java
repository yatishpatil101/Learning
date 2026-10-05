package com.draazy.api.catalog.listing;

import com.draazy.api.common.error.ValidationException;
import com.draazy.api.provider.FileStorage;
import java.util.Collection;
import java.util.Set;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

@Component
class ListingPhotoSources {

    private static final Pattern UPLOAD_KEY =
            Pattern.compile("photos/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/"
                    + "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-[0-9a-f]{16})?");

    private final FileStorage storage;

    ListingPhotoSources(FileStorage storage) {
        this.storage = storage;
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
        Set<String> allowedOwners = ownerIds == null ? Set.of()
                : ownerIds.stream().map(UUID::toString).collect(java.util.stream.Collectors.toSet());
        if (fresh.stream().anyMatch(url -> !belongsToOwnerUpload(url, prefix, allowedOwners))) {
            throw new ValidationException("Photos must be uploaded through Draazy, not linked from another site.");
        }
    }

    private static boolean belongsToOwnerUpload(String url, String prefix, Set<String> ownerIds) {
        if (!url.startsWith(prefix) || ownerIds.isEmpty()) {
            return false;
        }
        var match = UPLOAD_KEY.matcher(url.substring(prefix.length()));
        return match.matches() && ownerIds.contains(match.group(1));
    }
}
