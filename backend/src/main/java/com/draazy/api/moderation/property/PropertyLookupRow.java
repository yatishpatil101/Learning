package com.draazy.api.moderation.property;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record PropertyLookupRow(String id, String slug, String title, String locality, String owner, String status) {
}
