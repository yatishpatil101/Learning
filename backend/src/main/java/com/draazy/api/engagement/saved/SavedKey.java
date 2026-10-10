package com.draazy.api.engagement.saved;

import com.fasterxml.jackson.annotation.JsonInclude;

/** One shortlist entry as the app shell holds it: enough to light a heart ({@code slug}) and to write ({@code id}). */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SavedKey(String id, String slug) {
}
