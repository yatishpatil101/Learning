package com.draazy.api.catalog.society;

import java.time.Instant;

/** A row of the staff candidate queue. */
public record SocietyCandidateResponse(String slug, String name, String localitySlug, String mintOrigin, Instant createdAt) {
}