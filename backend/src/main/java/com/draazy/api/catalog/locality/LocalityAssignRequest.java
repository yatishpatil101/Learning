package com.draazy.api.catalog.locality;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Body of {@code PATCH /admin/locality-queue/{propertyId}} — file one listing under an area.
 *
 * <p><strong>One field, and no way to say "leave it unfiled".</strong> A dismiss action was
 * considered and left out: the queue exists because a listing with no locality is invisible to
 * locality search, its landing page, saved-search alerts and the society join, so "reviewed, still
 * has no locality" describes a listing in exactly the broken state the queue was opened to end.
 * The curator's two honest outs are already on the platform — create the missing area with
 * {@code POST /admin/localities} and file it here, or reject the listing, which the moderation
 * route still permits with no locality at all.
 *
 * @param slug the curated locality key to file this listing under; must already exist and be active
 */
public record LocalityAssignRequest(
        @NotBlank
        @Pattern(regexp = "[a-z0-9]+(-[a-z0-9]+)*",
                message = "slug must be lowercase words separated by single hyphens")
        @Size(max = 120) String slug) {
}
