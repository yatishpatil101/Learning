package com.draazy.api.engagement.flatmate;

import java.util.List;

/**
 * Contract schema {@code FlatSplitResult}.
 *
 * @param tier    the tier the rooms were born at — {@code owner} only when Ops has already approved
 *                the parent listing
 * @param pending true when the parent is not yet approved, so the rooms start unbadged and will be
 *                promoted when it is
 * @param flagged true when a different host already claimed this address, so Ops will take a look
 */
public record FlatSplitResult(
        int count,
        String tier,
        boolean pending,
        boolean flagged,
        List<FlatmateRoomDto> rooms) {
}
