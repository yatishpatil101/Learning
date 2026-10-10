package com.draazy.api.moderation.user;

import java.util.List;

/** Contract schema {@code TeamAssignee}: who a ticket can be handed to, and the desks they work. No contact details. */
public record TeamAssignee(String id, String name, List<String> desks) {
}
