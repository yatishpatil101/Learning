package com.draazy.api.catalog.society;

import java.util.List;

/** The society that already has the picked place, else up to three nearby ones it may be a second Place ID for. */
public record SocietyResolveResponse(SocietyResponse society, List<SocietyResponse> candidates) {
}
