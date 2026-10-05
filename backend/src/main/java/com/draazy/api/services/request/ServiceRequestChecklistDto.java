package com.draazy.api.services.request;

import java.util.List;

public record ServiceRequestChecklistDto(int ready, int total, List<Item> items) {

    public record Item(String id, String name, boolean done, String documentId, String review,
            String reason, boolean canUpload) {}
}
