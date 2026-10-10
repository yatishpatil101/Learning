package com.draazy.api.services.request;

import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.validation.Formats;
import com.draazy.api.documents.agreement.PreparedAgreement;
import com.draazy.api.documents.agreement.RentAgreement;
import com.draazy.api.documents.agreement.RentAgreementRepository;
import com.draazy.api.documents.agreement.RentAgreementService;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Stream;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RentAgreementRegistration {

    private static final int MAX_TERM_MONTHS = 120;

    private final ServiceRequestService requests;
    private final ServiceRequestPartyRepository parties;
    private final RentAgreementService agreements;
    private final RentAgreementRepository agreementRows;
    private final PropertyRepository properties;
    private final UserRepository users;

    public RentAgreementRegistration(ServiceRequestService requests,
            ServiceRequestPartyRepository parties,
            RentAgreementService agreements,
            RentAgreementRepository agreementRows,
            PropertyRepository properties,
            UserRepository users) {
        this.requests = requests;
        this.parties = parties;
        this.agreements = agreements;
        this.agreementRows = agreementRows;
        this.properties = properties;
        this.users = users;
    }

    // Runs inside the final-document upload's transaction, so a failed upload leaves no rows.
    // Skip ownerless requests: the row names landlord and receives the registered copy.
    void prepare(AuthPrincipal caller, ServiceRequest request, UUID finalDocumentId) {
        if (!ServiceRequestTypes.RENT_AGREEMENT.equals(request.getType())
                || request.getPropertyId() == null) {
            return;
        }
        UUID ownerId = properties.findById(request.getPropertyId()).map(p -> p.getOwner().getId()).orElseThrow(() -> NotFoundException.of("Property"));
        if (!ownerId.equals(request.getRequesterId()) && !acceptedParty(request, "owner", ownerId)) {
            return;
        }
        Map<String, Object> details = request.getDetails() == null ? Map.of() : request.getDetails();
        Map<String, Object> terms = ServiceRequestPricing.childObject(
                ServiceRequestPricing.childObject(details, "_state"), "terms");
        Long months = ServiceRequestPricing.rupees(details.get("months"), terms.get("months"));
        agreements.prepare(new PreparedAgreement(request.getId(), request.getPropertyId(), ownerId,
                        finalDocumentId, caller.userId(),
                        ServiceRequestPricing.rupees(details.get("rent"), terms.get("rent")),
                        ServiceRequestPricing.rupees(details.get("deposit"), terms.get("deposit")),
                        date(details.get("startDate"), terms.get("startDate")),
                        months == null || months < 1 || months > MAX_TERM_MONTHS
                                ? null : months.intValue()),
                tenants(request, verifiedTenants(request)).keySet());
    }

    @Transactional(readOnly = true)
    public List<RentAgreementRecordDto> forRequest(AuthPrincipal caller, String requestId) {
        ServiceRequest request = requests.opsAccessible(caller, requestId);
        return records(caller, request,
                agreementRows.findByServiceRequestIdOrderByCreatedAtAsc(request.getId()));
    }

    // Desk-scoped transition: caller must be on the desk, not a party.
    // Admins alone retire rows the paid flow did not produce.
    @Transactional
    public RentAgreementRecordDto transition(AuthPrincipal caller, UUID agreementId, String status) {
        RentAgreement agreement = agreementRows.findById(agreementId).orElseThrow(() -> NotFoundException.of("Rent agreement"));
        ServiceRequest request = null;
        if (agreement.getServiceRequestId() == null) {
            if (!Roles.Wire.ADMIN.equals(caller.role())) {
                throw new ForbiddenException(
                        "This agreement was not produced by a Draazy service request, so only an admin can change it.");
            }
        } else {
            request = requests.opsAccessible(caller, agreement.getServiceRequestId().toString());
            if (request.getStatus() != ServiceRequestStatus.COMPLETED) {
                throw new ConflictException("The service request behind this agreement is "
                        + request.getStatus() + ", not completed.");
            }
            String next = status == null ? "" : status.strip();
            if (RentAgreementService.isEvidence(next)
                    && !verifiedTenants(request).containsKey(agreement.getTenantMobile())) {
                throw new ValidationException("This tenant's number was typed on the form, never"
                        + " confirmed by OTP, so it cannot vouch for a trust badge. Only a tenant who"
                        + " signed in with it — the requester, or an invitee who accepted — can be"
                        + " recorded as registered.");
            }
        }
        agreements.transition(caller, agreementId, status);
        return records(caller, request, List.of(agreementRows.findById(agreementId).orElseThrow())).getFirst();
    }

    private List<RentAgreementRecordDto> records(AuthPrincipal caller, ServiceRequest request,
            List<RentAgreement> rows) {
        Map<String, String> verified = request == null ? Map.of() : verifiedTenants(request);
        Map<String, String> names = request == null ? Map.of() : tenants(request, verified);
        return rows.stream().map(a -> new RentAgreementRecordDto(a.getId().toString(),
                        names.get(a.getTenantMobile()),
                        a.getTenantMobile(),
                        a.getStatus(),
                        nameOf(a.getPreparedBy()),
                        nameOf(a.getVerifiedBy()),
                        caller.userId().equals(a.getPreparedBy()),
                        a.getFinalDocumentId() == null ? null : a.getFinalDocumentId().toString(),
                        verified.containsKey(a.getTenantMobile()))).toList();
    }

    private static Map<String, String> tenants(ServiceRequest request, Map<String, String> verified) {
        Map<String, String> out = formTenants(request);
        verified.forEach(out::putIfAbsent);
        return out;
    }

    // Verified tenants are mobiles proved by OTP: accepted invitees, plus non-owner requester.
    private Map<String, String> verifiedTenants(ServiceRequest request) {
        UUID ownerId = request.getPropertyId() == null ? null : properties.findById(request.getPropertyId()).map(p -> p.getOwner().getId()).orElse(null);
        Stream<UUID> requester = ownerId == null || ownerId.equals(request.getRequesterId())
                ? Stream.empty() : Stream.of(request.getRequesterId());
        Stream<UUID> invitees = parties.findByRequestId(request.getId()).stream().filter(p -> "tenant".equals(p.getRole()) && CoFillParties.ACCEPTED.equals(p.getStatus())).map(ServiceRequestParty::getUserId);
        Map<String, String> out = new LinkedHashMap<>();
        Stream.concat(requester, invitees).filter(Objects::nonNull).flatMap(id -> users.findById(id).stream()).forEach(u -> {
                    String mobile = validMobile(u.getMobile());
                    if (mobile != null) {
                        out.putIfAbsent(mobile, u.getName());
                    }
                });
        return out;
    }

    static Map<String, String> formTenants(ServiceRequest request) {
        Map<String, String> out = new LinkedHashMap<>();
        Map<String, Object> details = request.getDetails() == null ? Map.of() : request.getDetails();
        Map<String, Object> state = ServiceRequestPricing.childObject(details, "_state");
        if ("invite".equals(state.get("tenantMode")) || !(state.get("tenants") instanceof List<?> rows)) {
            return out;
        }
        for (Object row : rows) {
            if (row instanceof Map<?, ?> tenant && tenant.get("mobile") instanceof String raw) {
                String mobile = validMobile(raw);
                if (mobile != null) {
                    out.putIfAbsent(mobile, tenant.get("name") instanceof String n ? n : null);
                }
            }
        }
        return out;
    }

    static String validMobile(String raw) {
        String mobile = MobileMask.normalise(raw);
        return mobile != null && mobile.matches(Formats.MOBILE) ? mobile : null;
    }

    private boolean acceptedParty(ServiceRequest request, String role, UUID userId) {
        return parties.findByRequestId(request.getId()).stream().anyMatch(p -> role.equals(p.getRole()) && CoFillParties.ACCEPTED.equals(p.getStatus())
                        && userId.equals(p.getUserId()));
    }

    private String nameOf(UUID userId) {
        return userId == null ? null : users.findById(userId).map(User::getName).orElse(null);
    }

    static LocalDate date(Object... candidates) {
        for (Object candidate : candidates) {
            if (candidate instanceof String text && !text.isBlank()) {
                try {
                    return LocalDate.parse(text.strip());
                } catch (DateTimeParseException ignored) {

                }
            }
        }
        return null;
    }
}
