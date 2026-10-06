package com.draazy.api.admin;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/** A section the caller holds no atom for is absent, not empty, so the console can tell "nothing waiting" from "not yours". */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AdminBell(Listings pendingListings, Tickets openTickets, Replies ownerReplies) {

    public record Listings(long total, List<Listing> items) {
    }

    public record Listing(String id, String title, String locality, String owner) {
    }

    public record Tickets(long total, List<Ticket> items) {
    }

    public record Ticket(String id, String team, String service, String customer, String mobile) {
    }

    public record Replies(long total, List<Reply> items) {
    }

    public record Reply(String propertyId, String propertyTitle, String lastMessage) {
    }
}