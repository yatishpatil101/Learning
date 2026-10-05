package com.draazy.api.common.settings;

import com.draazy.api.common.error.ValidationException;
import java.util.Collection;
import org.springframework.stereotype.Component;

@Component
public class PhotoLimit {

    private final PlatformSettings settings;

    public PhotoLimit(PlatformSettings settings) {
        this.settings = settings;
    }

    public void require(String subject, Collection<?> photos) {
        if (photos == null) {
            return;
        }
        int max = settings.maxListingPhotos();
        if (photos.size() > max) {
            throw new ValidationException(subject + " can have at most " + max + " photos; this one has "
                    + photos.size() + ". Remove " + (photos.size() - max) + " and save again.");
        }
    }
}
