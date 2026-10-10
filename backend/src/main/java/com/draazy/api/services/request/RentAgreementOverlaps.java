package com.draazy.api.services.request;

import com.draazy.api.documents.agreement.RentAgreement;
import com.draazy.api.documents.agreement.RentAgreementRepository;
import com.draazy.api.security.AuthPrincipal;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// Advisory overlap check: double letting, duplicate filing, or non-owner licensor.
// Advisory: an early renewal overlaps too, so the drafter judges, and nothing is refused.
@Service
public class RentAgreementOverlaps {

    private static final Pattern FLAT_WORDS = Pattern.compile("\\b(?:flat|no|number|unit|apt|apartment)\\b");

    private final ServiceRequestService requests;
    private final ServiceRequestRepository repository;
    private final RentAgreementRepository filed;

    public RentAgreementOverlaps(ServiceRequestService requests, ServiceRequestRepository repository,
            RentAgreementRepository filed) {
        this.requests = requests;
        this.repository = repository;
        this.filed = filed;
    }

    @Transactional(readOnly = true)
    public List<RentAgreementOverlapDto> forRequest(AuthPrincipal caller, String requestId) {
        ServiceRequest request = requests.opsAccessible(caller, requestId);
        return overlapsFor(request);
    }

    List<RentAgreementOverlapDto> overlapsFor(ServiceRequest request) {
        if (!ServiceRequestTypes.RENT_AGREEMENT.equals(request.getType())) {
            return List.of();
        }
        String flat = flatKey(request.getDetails());
        if (request.getPropertyId() == null && flat == null) {
            return List.of();
        }
        Term mine = Term.of(request.getDetails());
        String licensor = licensor(request.getDetails());
        List<RentAgreementOverlapDto> records = request.getPropertyId() == null ? List.of()
                : filed.findFiledOnListing(request.getPropertyId()).stream()
                        .filter(other -> mine.overlaps(Term.of(other)))
                        .map(other -> recordOverlap(other)).toList();
        List<RentAgreementOverlapDto> requestsOnFlat = repository.findRentAgreementsOnFlat(request.getId(),
                        request.getPropertyId() == null ? null : request.getPropertyId().toString(), flat).stream().filter(other -> mine.overlaps(Term.of(other.getDetails()))).map(other -> {
                    Term term = Term.of(other.getDetails());
                    String theirs = licensor(other.getDetails());
                    boolean sameListing = request.getPropertyId() != null
                            && request.getPropertyId().equals(other.getPropertyId());
                    return new RentAgreementOverlapDto(other.getId().toString(), other.getStatus().wire(),
                            sameListing ? "listing" : "address", term.start(), term.end(), theirs,
                            licensor != null && theirs != null && !person(licensor).equals(person(theirs)));
                }).toList();
        return Stream.concat(requestsOnFlat.stream(), records.stream()).toList();
    }

    private static RentAgreementOverlapDto recordOverlap(RentAgreement other) {
        Term term = Term.of(other);
        return new RentAgreementOverlapDto(other.getId().toString(), other.getStatus(), "record", term.start(),
                term.end(), null, false);
    }

    // Must match the SQL function rent_agreement_flat_key, which the overlap query and its index use.
    static String flatKey(Map<String, Object> details) {
        Map<String, Object> prop = ServiceRequestPricing.childObject(
                ServiceRequestPricing.childObject(details, "_state"), "prop");
        String flatNo = squash(FLAT_WORDS.matcher(prop.get("flatNo") == null ? "" : prop.get("flatNo").toString()
                .toLowerCase(Locale.ROOT)).replaceAll("")).replaceFirst("^0+", "");
        String society = squash(prop.get("society"));
        String pincode = squash(prop.get("pincode"));
        return flatNo.isEmpty() || society.isEmpty() || pincode.isEmpty()
                ? null : flatNo + "|" + society + "|" + pincode;
    }

    private static String squash(Object value) {
        return value == null ? "" : value.toString().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    private static String licensor(Map<String, Object> details) {
        Object name = ServiceRequestPricing.childObject(
                ServiceRequestPricing.childObject(details, "_state"), "owner").get("oName");
        return name == null || name.toString().isBlank() ? null : name.toString().strip().replaceAll("\\s+", " ");
    }

    private static String person(String name) {
        return name.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}]", "");
    }

    // [start, end); either end unknown means the overlap cannot be ruled out.
    private record Term(LocalDate start, LocalDate end) {

        static Term of(Map<String, Object> details) {
            Map<String, Object> safe = details == null ? Map.of() : details;
            Map<String, Object> terms = ServiceRequestPricing.childObject(
                    ServiceRequestPricing.childObject(safe, "_state"), "terms");
            LocalDate start = RentAgreementRegistration.date(safe.get("startDate"), terms.get("startDate"));
            Long months = ServiceRequestPricing.rupees(safe.get("months"), terms.get("months"));
            return new Term(start, start == null || months == null || months < 1 ? null : start.plusMonths(months));
        }

        static Term of(RentAgreement filed) {
            LocalDate start = filed.getStartDate();
            Integer months = filed.getDurationMonths();
            return new Term(start, start == null || months == null || months < 1 ? null : start.plusMonths(months));
        }

        boolean overlaps(Term other) {
            if (end == null || other.end == null) {
                return true;
            }
            return start.isBefore(other.end) && other.start.isBefore(end);
        }
    }
}
