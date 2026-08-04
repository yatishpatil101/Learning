package com.punenest.api.engagement.flatmate;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * Contract schema {@code FlatSplitRequest}.
 *
 * <p>The two bounds that matter are conditional and therefore live in {@link FlatSplitService}: the
 * room count depends on the parent's {@code bhk}, and {@code maxOccupants} depends on the room
 * count. Neither is expressible as an annotation on this record, and both produce a message naming
 * the actual numbers involved.
 *
 * @param maxOccupants people allowed in the whole flat — the society's rule, and the only ceiling
 *                     the owner declares
 */
public record FlatSplitRequest(
        @NotNull @Min(1) @Max(36) Integer maxOccupants,
        @NotEmpty @Size(max = 12) List<@Valid @NotNull RoomSpec> rooms) {

    /**
     * One lettable room.
     *
     * @param deposit defaults to twice the rent when omitted, which is the Pune convention
     */
    public record RoomSpec(
            @NotBlank String roomKind,
            @NotNull @Min(1) @Max(10_000_000) Long rent,
            @Min(0) @Max(20_000_000) Long deposit,
            @Size(max = 600) String note) {
    }
}
