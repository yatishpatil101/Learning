package com.draazy.api.engagement.flatmate;

/**
 * The seeker-feed filter as the page offers it: locality plus who the seeker is and how they want
 * to live ({@code gender}, {@code flatPref}, {@code roomPref}) and a budget range. Optional
 * throughout, so the all-null instance is the default page load. {@code flatPref} reads the literal
 * {@code any} as no preference; {@code gender} and {@code roomPref} are exact, because "women only"
 * and a specific room preference are hard constraints on the seeker's side — mirroring the mock.
 */
public record PostFacets(String locality, String gender, String flatPref, String roomPref,
        Long minBudget, Long maxBudget) {
}
