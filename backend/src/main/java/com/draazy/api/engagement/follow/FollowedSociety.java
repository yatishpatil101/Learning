package com.draazy.api.engagement.follow;

/** A dashboard "Followed Societies" row: what it draws and the slug the follow toggle keys on. */
public record FollowedSociety(String slug, String name, String localitySlug, long listingCount) {
}
