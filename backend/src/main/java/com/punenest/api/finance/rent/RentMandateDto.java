package com.punenest.api.finance.rent;

/**
 * An autopay mandate as returned to the tenant (contract {@code RentMandate}).
 *
 * @param id        opaque mandate id; null when the caller has none
 * @param tenancyId the tenancy the mandate charges against
 * @param maxAmount the ceiling the tenant authorised, whole rupees
 * @param dayOfMonth 1–28; see {@link RentMandate} for why 28 is the cap
 * @param status    see {@link MandateStatuses}
 * @param provider  the rail holding the mandate, e.g. {@code cashfree}
 */
public record RentMandateDto(
        String id,
        String tenancyId,
        Long maxAmount,
        Integer dayOfMonth,
        String status,
        String provider) {

    /**
     * The shape returned when a tenant has no mandate.
     *
     * <p>An empty object rather than a 404: "I have not set up autopay" is a normal state, and a
     * 404 would force every client to special-case a status code in order to render an off switch.
     * Consistent with the slice-5 D5 ruling on {@code /me/tenant-profile} and {@code /basis}.
     */
    public static RentMandateDto none() {
        return new RentMandateDto(null, null, null, null, null, null);
    }
}
