package com.draazy.api.services.request;

public record ServiceQueueSummary(long toPickUp, long mine, long inProgress, long withCustomer,
        long closed, long overdue) {
}
