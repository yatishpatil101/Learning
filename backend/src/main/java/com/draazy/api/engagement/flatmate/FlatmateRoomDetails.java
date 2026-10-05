package com.draazy.api.engagement.flatmate;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

public record FlatmateRoomDetails(
        @Pattern(regexp = "Ground|[1-9]|[1-4][0-9]|50") String floor,
        @Min(1) @Max(50) Integer totalFloors,
        @Min(1) @Max(4) Integer floorsInHouse,
        @Min(1) @Max(4) Integer bathrooms,
        @Min(0) @Max(3) Integer balconies,
        @Size(max = 40) List<@NotBlank @Size(max = 60) String> furniture,
        @Size(max = 30) String tower,
        @Size(max = 60) String street,
        @Size(max = 60) String landmark,
        @Pattern(regexp = "[0-9]{6}") String pincode) {
}
