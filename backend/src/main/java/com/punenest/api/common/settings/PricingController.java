package com.punenest.api.common.settings;

import com.punenest.api.common.web.Routes;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /pricing} — what PuneNest charges for its own products.
 *
 * <p><strong>Why this exists.</strong> Every price the product quotes — the owner plans, the
 * seeker top-up, the featured-listing fee, the rent-agreement fee, the convenience percentage and
 * its GST — was read out of {@code FEE_DEFAULTS} in the browser's own bundle, with a localStorage
 * copy layered over it. The back office could edit them, the write was real, and no visitor ever
 * saw the result: a price change took a deployment, and the price a caller was quoted depended on
 * which browser they used.
 *
 * <p><strong>Why it is not {@code /fees}.</strong> That route answers what a <em>transaction</em>
 * costs, keyed by deal intent, and most of what it quotes belongs to the state rather than to us —
 * stamp duty, registration, and a brokerage of zero that is the platform's whole pitch. This
 * answers what PuneNest sells and for how much. The two are one word apart in English and nothing
 * alike in meaning, so the routes are named far enough apart that no caller has to check which one
 * it is holding. {@code /fees} is not extended, and the argument for keeping them separate is in
 * {@link Routes.Pricing}.
 *
 * <p><strong>Why not another key on {@code /flags}.</strong> The answer {@code /move-pack} gives:
 * that endpoint's contract is map-of-boolean and it drops everything else on purpose, so the
 * guarantee that makes it safe to read blindly is exactly what a price list would cost it.
 *
 * <p><strong>Why the response is seven named fields</strong> and not the {@code fees} block passed
 * through. That block also carries {@code referralQualifyPerMonth} — how many referrals one account
 * may mint before the fraud desk looks — and publishing it would hand the one reader who cares the
 * exact line to stay under. A projection would have carried it; a typed record cannot, and the next
 * key ops adds to that document is not published by accident.
 *
 * <p><strong>Why {@link PlatformSettings} rather than the row.</strong> {@code MovePackController}
 * reads {@code settings} directly and is right to — nothing else reads its block. Every field here
 * already has a named accessor with its own default and bounds, because the payment path reads the
 * same numbers. Parsing the row a second time would give this route its own opinion about what a
 * malformed price means, and the two opinions would drift on the endpoint where the visible symptom
 * is being quoted one number and charged another.
 *
 * <p><strong>No service layer</strong>, for the reason {@code FeeController} has none: there is no
 * decision between the settings and the wire, and a class whose whole body is a delegation is not a
 * layer. {@link PlatformSettings} already is the layer.
 */
@RestController
public class PricingController {

    private final PlatformSettings settings;

    public PricingController(PlatformSettings settings) {
        this.settings = settings;
    }

    /**
     * {@code GET /pricing} — the current price list. Anonymous.
     *
     * <p>Never fails on bad configuration: every accessor below falls back to the seeded figure and
     * logs, because the callers are page renders and a 500 on the plans page is a worse answer to a
     * mistyped config value than the price the platform charged yesterday.
     */
    @GetMapping(Routes.Pricing.BASE)
    public PricingResponse pricing() {
        return new PricingResponse(
                settings.ownerPlanYearly(),
                settings.ownerProYearly(),
                settings.rentAgreementPlatform(),
                settings.seekerPlusTopup(),
                settings.featuredListing(),
                settings.gstPercent());
    }
}
