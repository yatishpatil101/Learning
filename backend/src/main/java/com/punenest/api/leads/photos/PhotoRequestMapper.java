package com.punenest.api.leads.photos;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.identity.user.User;
import org.springframework.stereotype.Component;

/**
 * Projects {@link PhotoRequest} rows onto the wire.
 *
 * <p>Takes the {@link Property} and {@link User} already resolved rather than looking them up: the
 * entity holds ids, not associations, so a mapper that fetched its own would issue two queries per
 * row and turn the owner's inbox into a textbook N+1. {@link PhotoRequestService} batch-loads both
 * sides once per page and hands them in.
 */
@Component
public class PhotoRequestMapper {

    /**
     * @param property  may be {@code null} only if a listing vanished between the page query and the
     *                  batch load; the row still renders, with nulls, rather than 500-ing an inbox
     * @param requester likewise
     */
    public PhotoRequestResponse toResponse(PhotoRequest row, Property property, User requester) {
        return new PhotoRequestResponse(
                row.getId().toString(),
                row.getPropertyId().toString(),
                property == null ? null : property.getSlug(),
                property == null ? null : property.getTitle(),
                toRequester(requester),
                row.getStatus(),
                row.getCreatedAt(),
                row.getDecidedAt());
    }

    /**
     * The masked party. There is no revealed variant and no {@code ContactVisibility} parameter —
     * unlike every other mapper in {@code leads} and {@code deals} — because this domain has no
     * reveal. See {@link PhotoRequestResponse} for why that is a security property rather than an
     * omission.
     */
    private PhotoRequestResponse.Requester toRequester(User requester) {
        if (requester == null) {
            return null;
        }
        return new PhotoRequestResponse.Requester(
                requester.getName(), MobileMask.mask(requester.getMobile()));
    }
}
