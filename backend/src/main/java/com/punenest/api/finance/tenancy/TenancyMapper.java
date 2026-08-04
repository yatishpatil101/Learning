package com.punenest.api.finance.tenancy;

import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.identity.user.User;

/**
 * Hand-written mapper for the tenancy feature, mirroring {@code deals.deal.DealMapper}. MapStruct
 * is not used: both projections carry a mobile number, so the whole shape is trust-shaping and the
 * masking rule must stay reviewable in source rather than in generated code
 * ({@code api-standards.md} §8.1).
 *
 * <p><strong>When a tenancy party's mobile reveals.</strong> Unlike an offer or a visit — which are
 * approaches, and therefore masked until the owner acts — a tenancy only exists because a deal
 * closed. The two people already have each other's numbers; they signed an agreement and one pays
 * the other rent every month. Masking here would not protect anybody, it would just stop a tenant
 * calling their landlord about a leak. So both mobiles are revealed <em>to the two participants</em>
 * — and this feature never shows a tenancy to anyone else.
 */
public final class TenancyMapper {

    private TenancyMapper() {
    }

    /**
     * Project a stored tenancy for one of its two participants.
     *
     * @param tenancy the stored row
     * @param tenant  the resolved tenant user
     * @param owner   the resolved owner user
     */
    public static TenancyDto toDto(Tenancy tenancy, User tenant, User owner) {
        return new TenancyDto(
                tenancy.getId().toString(),
                tenancy.getPropertyId().toString(),
                toParty(tenant, "tenant"),
                toParty(owner, "owner"),
                tenancy.getRent(),
                tenancy.getDeposit(),
                tenancy.getStartDate(),
                tenancy.getEndDate(),
                tenancy.getStatus());
    }

    /**
     * Project a tenant profile.
     *
     * @param profile the stored row
     * @param mobile  the profile owner's mobile, already normalised
     * @param self    whether the reader is the profile's owner; a screening owner sees it masked
     */
    public static TenantProfileDto toDto(TenantProfile profile, String mobile, boolean self) {
        return new TenantProfileDto(
                maskMobile(mobile, self ? ContactVisibility.REVEALED : ContactVisibility.MASKED),
                profile.getName(),
                profile.getOccupation(),
                profile.getIncome(),
                profile.getOccupants(),
                profile.getMoveIn(),
                profile.getPriorLandlord(),
                profile.getAbout(),
                profile.getScore(),
                profile.isVerified());
    }

    /**
     * The empty profile a tenant who has never saved one still gets back, so the form has something
     * to render. Returning 404 would make "you have no profile yet" indistinguishable from an
     * error, and the client would have to special-case a status code to show a blank form.
     */
    public static TenantProfileDto emptyProfile(String mobile, boolean verified) {
        return new TenantProfileDto(
                maskMobile(mobile, ContactVisibility.REVEALED),
                null, null, null, null, null, null, null, 0, verified);
    }

    /**
     * Build a tenancy participant. The mobile is revealed — see the class Javadoc — but still
     * routed through {@link MobileMask} so the platform has exactly one definition of the rule.
     */
    private static TenancyDto.Party toParty(User user, String role) {
        if (user == null) {
            return null;
        }
        return new TenancyDto.Party(
                user.getId().toString(),
                user.getName(),
                maskMobile(user.getMobile(), ContactVisibility.REVEALED),
                role);
    }

    /** Delegates to {@link MobileMask} — the single definition. Private by §8.1. */
    private static String maskMobile(String mobile, ContactVisibility visibility) {
        return MobileMask.applyTo(mobile, visibility);
    }
}
