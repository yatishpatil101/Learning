package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.error.BadRequestException;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.LinkedHashSet;
import java.util.List;

public record FlatmateGroupPreferences(
        @NotNull @Size(min = 1, max = MAX_LOCALITIES) List<@NotBlank @Size(max = 80) String> localities,
        @Size(max = 4) List<@NotBlank String> bhk,
        @Min(0) @Max(10_000_000) Long rentMin,
        @NotNull @Min(1) @Max(10_000_000) Long rentMax,
        @Min(0) @Max(10_000_000) Long depositMin,
        @Min(0) @Max(10_000_000) Long depositMax,
        boolean gatedOnly,
        boolean bachelors,
        String furnishing,
        LocalDate moveInBy) {

    public static final int MAX_LOCALITIES = 3;

    FlatmateGroupPreferences normalised() {
        List<String> locs = List.copyOf(new LinkedHashSet<>(localities.stream().map(String::strip).toList()));
        List<String> sizes = bhk == null ? List.of() : List.copyOf(new LinkedHashSet<>(bhk.stream()
                .map(b -> FlatmateVocabulary.require(b.strip(), FlatmateVocabulary.BHK, "bhk"))
                .sorted().toList()));
        if (rentMin != null && rentMin > rentMax) {
            throw new BadRequestException("The lowest rent cannot be above the highest.");
        }
        if (depositMin != null && depositMax != null && depositMin > depositMax) {
            throw new BadRequestException("The lowest deposit cannot be above the highest.");
        }
        return new FlatmateGroupPreferences(locs, sizes, rentMin, rentMax, depositMin, depositMax,
                gatedOnly, bachelors,
                FlatmateVocabulary.optional(furnishing, FlatmateVocabulary.FURNISHING, "furnishing"),
                moveInBy);
    }
}
