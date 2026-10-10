package com.draazy.api.leads.photos;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.identity.user.User;
import org.springframework.stereotype.Component;

/** Takes {@link Property} and {@link User} already resolved: {@link PhotoRequestService} batch-loads both
 * per page, so the mapper never issues two queries per row. */
@Component
public class PhotoRequestMapper {

    /** Either may be {@code null} if a row vanished between the page query and the batch load;
     * the inbox still renders it with nulls rather than 500-ing. */
    public PhotoRequestResponse toResponse(PhotoRequest row, Property property, User requester) {
        return new PhotoRequestResponse(
                row.getId().toString(),
                row.getPropertyId().toString(),
                property == null ? null : property.getSlug(),
                property == null ? null : property.getTitle(),
                toRequester(requester),
                row.getStatus(),
                row.getCreatedAt());
    }

    /** No reveal variant: photo requests move no PII, see {@link PhotoRequestResponse}. */
    private PhotoRequestResponse.Requester toRequester(User requester) {
        if (requester == null) {
            return null;
        }
        return new PhotoRequestResponse.Requester(
                requester.getName(), MobileMask.mask(requester.getMobile()));
    }
}
