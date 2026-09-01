package com.punenest.api.common.settings;

import java.math.BigDecimal;

/**
 * What PuneNest charges for its own products.
 *
 * <p>Six named fields rather than the {@code fees} settings block projected onto the wire. The
 * block holds three more keys — the free contact allowance, the referral bonus and the monthly
 * auto-qualify cap — and the last of those is a fraud threshold, which is the one number on the
 * platform that must not be published. Naming the six is what makes that a property of the type
 * rather than of somebody remembering to filter.
 *
 * @param ownerPlanYearly       yearly price of the entry owner plan, in rupees; zero is the free tier
 * @param ownerProYearly        yearly price of the top owner plan, in rupees
 * @param rentAgreementPlatform the platform's share of a rent agreement, in rupees; stamp duty and
 *                              registration are the state's and are quoted on {@code /fees}
 * @param seekerPlusTopup       what a seeker pays to top up their contact allowance, in rupees
 * @param featuredListing       what an owner pays to feature one listing, in rupees
 * @param gstPercent            GST on the platform's fees, as a percentage
 */
public record PricingResponse(
        long ownerPlanYearly,
        long ownerProYearly,
        long rentAgreementPlatform,
        long seekerPlusTopup,
        long featuredListing,
        BigDecimal gstPercent) {
}
