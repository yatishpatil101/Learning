package com.draazy.api.services.request;

import com.fasterxml.jackson.annotation.JsonInclude;

// openTickets rides along so a desk page needs one read; absent when the caller cannot read tickets.
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ServiceQueueSummary(long toPickUp, long mine, long inProgress, long withCustomer,
        long closed, long overdue, Long openTickets) {
}
