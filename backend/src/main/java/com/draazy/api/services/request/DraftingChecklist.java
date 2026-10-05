package com.draazy.api.services.request;

import com.draazy.api.common.error.ValidationException;
import java.util.List;

// What the drafter attests before a rent-agreement draft reaches the customer.
// The keys must match DRAFT_CHECKS in the desk's StaffWorkflowActions.jsx; the labels are for the 422.
final class DraftingChecklist {

    private record Item(String key, String label) {
    }

    private static final List<Item> ITEMS = List.of(
            new Item("identity", "ID numbers match the scans"),
            new Item("title", "ownership proof names the licensors"),
            new Item("poa", "power of attorney checked"),
            new Item("address", "flat address matches the ownership proof"),
            new Item("terms", "draft terms match the particulars"));

    private DraftingChecklist() {
    }

    static List<String> require(ServiceRequest request, List<String> checks) {
        if (!ServiceRequestTypes.RENT_AGREEMENT.equals(request.getType())) {
            return List.of();
        }
        List<String> ticked = checks == null ? List.of() : checks;
        List<String> missing = ITEMS.stream().filter(item -> !ticked.contains(item.key())).map(Item::label).toList();
        if (!missing.isEmpty()) {
            throw new ValidationException("Tick every drafting check before sharing: "
                    + String.join("; ", missing) + ".");
        }
        return ITEMS.stream().map(Item::key).toList();
    }
}
