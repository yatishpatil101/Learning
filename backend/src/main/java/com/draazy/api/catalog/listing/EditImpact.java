package com.draazy.api.catalog.listing;

import java.util.List;

/**
 * What a PATCH earned. {@code remoderationRequired} is the off-search outcome, {@code recheckOnly}
 * the stays-live one, and {@code rechecked} names the fields behind the latter so the moderator's
 * work item can say what to look at.
 *
 * <p>Two flags rather than one enum because they are answers to two independent questions, and a
 * single PATCH can trip both — {@code ListingService.update} decides which wins.
 *
 * <p>Package-private and its own file: it is the return type {@link ListingEditRules#apply} hands
 * to {@link ListingService}, so it belongs to neither of them. It was a {@code private record}
 * nested in {@code ListingService} while {@code apply} lived there too; when the rules moved out,
 * leaving the type behind would have made the rules class return something owned by its caller.
 */
record EditImpact(boolean remoderationRequired, boolean recheckOnly, List<String> rechecked) {
}
