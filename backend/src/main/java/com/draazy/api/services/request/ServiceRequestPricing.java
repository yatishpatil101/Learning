package com.draazy.api.services.request;

import com.draazy.api.catalog.fee.LeaveAndLicenceCharges;
import com.draazy.api.catalog.fee.PlatformFee;
import com.draazy.api.catalog.fee.PlatformFeeRepository;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.settings.PlatformSettings;
import java.math.BigDecimal;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

// Pricing stays separate: pure rupee math over desk/type/details, no request row.
@Service
public class ServiceRequestPricing {

    private static final Logger log = LoggerFactory.getLogger(ServiceRequestPricing.class);

    // Eleven months is the wizard default and common Indian tenancy.
    // Keep it mirrored with useRentAgreement.js so estimates match charges.
    private static final int DEFAULT_TERM_MONTHS = 11;
    private static final int DEFAULT_INCREMENT_EVERY_MONTHS = 11;

    private final PlatformFeeRepository fees;
    private final RegistrationArea registrationArea;
    private final PlatformSettings settings;

    public ServiceRequestPricing(PlatformFeeRepository fees, RegistrationArea registrationArea,
            PlatformSettings settings) {
        this.fees = fees;
        this.registrationArea = registrationArea;
        this.settings = settings;
    }

    Map<String, Object> withServerTerms(String type, Map<String, Object> details) {
        return ServiceRequestTypes.RENT_AGREEMENT.equals(type) ? registrationArea.stamped(details) : details;
    }

    public Long priceFor(String type, Map<String, Object> details) {
        if (!ServiceRequestTypes.RENT_AGREEMENT.equals(type)) {
            return null;
        }
        RentAgreementDetailsRules.check(details);
        return rentAgreementPrice(details);
    }

    // Only the statutory lines move: the platform fee was settled at the price of the day it was paid,
    // and the admin schedule may have changed since.
    long repriced(long paid, Map<String, Object> current, Map<String, Object> next) {
        RentAgreementDetailsRules.checkPricedTerms(next);
        LeaveAndLicenceCharges.Terms terms = leaveAndLicenceTerms(next);
        if (terms == null) {
            throw new ValidationException("An amended rent agreement still needs a rent.");
        }
        return paid - statutory(current) + LeaveAndLicenceCharges.on(terms).total();
    }

    private long rentAgreementPrice(Map<String, Object> details) {
        long platformFee = settings.rentAgreementPlatform();
        return platformFee + settings.gstOn(platformFee) + statutory(details);
    }

    private long statutory(Map<String, Object> details) {
        LeaveAndLicenceCharges.Terms terms = leaveAndLicenceTerms(details);
        if (terms != null) {
            return LeaveAndLicenceCharges.on(terms).total();
        }
        log.warn("Rent agreement raised without terms; statutory charges cannot be computed and are "
                + "billed only if the published schedule states them");
        PlatformFee published = fees.findById(PlatformFee.RENT).orElseThrow(() -> new IllegalStateException(
                        "Missing platform fee row for deal " + PlatformFee.RENT));
        return orZero(published.getStampDuty()) + orZero(published.getRegistration());
    }

    private static long orZero(Long publishedLine) {
        return publishedLine == null ? 0L : publishedLine;
    }

    static LeaveAndLicenceCharges.Charges quotedCharges(Map<String, Object> details) {
        try {
            LeaveAndLicenceCharges.Terms terms = leaveAndLicenceTerms(details);
            return terms == null ? null : LeaveAndLicenceCharges.on(terms);
        } catch (ValidationException unpriceable) {
            return null;
        }
    }

    private static LeaveAndLicenceCharges.Terms leaveAndLicenceTerms(Map<String, Object> details) {
        if (details == null || details.isEmpty()) {
            return null;
        }
        Map<String, Object> state = childObject(childObject(details, "_state"), "terms");
        Long rent = rupees(details.get("rent"), state.get("rent"));
        if (rent == null || rent <= 0L) {
            return null;
        }
        Long months = rupees(details.get("months"), state.get("months"));
        Long deposit = rupees(details.get("deposit"), state.get("deposit"));
        Long nonRefundable = rupees(details.get("nrDeposit"), state.get("nrDeposit"));
        boolean urban = !isRural(details.containsKey("regArea") ? details.get("regArea") : state.get("regArea"));
        Long every = rupees(state.get("incrementEvery"));
        try {
            return new LeaveAndLicenceCharges.Terms(rent,
                    deposit == null ? 0L : deposit,
                    nonRefundable == null ? 0L : nonRefundable,
                    months == null || months <= 0L ? DEFAULT_TERM_MONTHS : Math.toIntExact(months),
                    urban,
                    incrementBps(state.get("increment")),
                    every == null ? DEFAULT_INCREMENT_EVERY_MONTHS : Math.toIntExact(every));
        } catch (ArithmeticException | IllegalArgumentException unpriceable) {
            throw new ValidationException(
                    "details states rent-agreement terms that cannot be priced: "
                            + unpriceable.getMessage());
        }
    }

    static boolean rentStated(Map<String, Object> details) {
        Long rent = rupees(details.get("rent"), childObject(childObject(details, "_state"), "terms").get("rent"));
        return rent != null && rent > 0L;
    }

    static boolean samePricedTerms(Map<String, Object> before, Map<String, Object> after) {
        return Objects.equals(leaveAndLicenceTerms(before), leaveAndLicenceTerms(after));
    }

    private static int incrementBps(Object percent) {
        if (percent == null || percent.toString().isBlank()) {
            return 0;
        }
        return new BigDecimal(percent.toString().strip()).movePointRight(2).intValueExact();
    }

    // Accept flat and _state copies because both are posted.
    // Invalid money is treated unstated so range checks report the missing term.
    static Long rupees(Object... candidates) {
        for (Object candidate : candidates) {
            if (candidate instanceof Number number && number.longValue() >= 0) {
                return number.longValue();
            }
            if (candidate instanceof String text && text.strip().matches("\\d{1,18}")) {
                return Long.valueOf(text.strip());
            }
        }
        return null;
    }

    private static boolean isRural(Object area) {
        return area instanceof String text && text.toLowerCase(Locale.ROOT).contains("rural");
    }

    // The nested object at key, or an empty map — so lookups can chain without null checks.
    static Map<String, Object> childObject(Map<String, Object> parent, String key) {
        Object child = parent.get(key);
        if (child instanceof Map<?, ?> map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> typed = (Map<String, Object>) map;
            return typed;
        }
        return Map.of();
    }
}
