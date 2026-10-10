package com.draazy.api.services.request;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/** Builds desk queue rows in four small reads, none of which touches a file, thread or party. */
@Component
class ServiceRequestQueueRows {

    private static final String APPROVED_EVENT = "draft.approved";

    private static final List<String> SCALAR_DETAILS = List.of("property", "location", "ownerName", "tenants",
            "rent", "deposit", "months", "startDate", "regArea", "service", "scope", "rooms", "budget",
            "timeline", "ptype", "area", "purpose", "from", "to", "moveDate", "homeSize");

    private final UserRepository users;
    private final ServiceRequestDraftCheckRepository draftChecks;
    private final ServiceRequestPoliceIntimationRepository policeIntimations;
    private final ServiceRequestEventRepository events;

    ServiceRequestQueueRows(UserRepository users, ServiceRequestDraftCheckRepository draftChecks,
            ServiceRequestPoliceIntimationRepository policeIntimations, ServiceRequestEventRepository events) {
        this.users = users;
        this.draftChecks = draftChecks;
        this.policeIntimations = policeIntimations;
        this.events = events;
    }

    List<ServiceRequestQueueRow> of(List<ServiceRequest> requests, AuthPrincipal viewer) {
        if (requests.isEmpty()) {
            return List.of();
        }
        List<UUID> ids = requests.stream().map(ServiceRequest::getId).toList();
        List<UUID> completed = idsWhere(requests, ServiceRequestStatus.COMPLETED);
        List<UUID> approvedRentals = requests.stream()
                .filter(r -> r.getStatus() == ServiceRequestStatus.APPROVED
                        && ServiceRequestTypes.RENT_AGREEMENT.equals(r.getType()))
                .map(ServiceRequest::getId).toList();

        Map<UUID, String> names = names(requests);
        Map<UUID, String> checks = latestCheckStatus(ids);
        Set<UUID> confirmed = completed.isEmpty() ? Set.of()
                : policeIntimations.findByServiceRequestIdIn(completed).stream()
                        .map(ServiceRequestPoliceIntimation::getServiceRequestId).collect(Collectors.toSet());
        Map<UUID, Instant> approvedAt = approvedRentals.isEmpty() ? Map.of() : approvedAt(approvedRentals);
        Instant now = Instant.now();

        return requests.stream().map(r -> new ServiceRequestQueueRow(
                r.getId().toString(),
                r.getType(),
                r.getStatus(),
                projected(r.getDetails()),
                names.get(r.getAssigneeId()),
                Objects.equals(r.getAssigneeId(), viewer.userId()),
                r.getCreatedAt(),
                r.getAmount(),
                RentAgreementSla.of(r, now),
                checks.get(r.getId()),
                confirmed.contains(r.getId()),
                approvedAt.get(r.getId()))).toList();
    }

    private static List<UUID> idsWhere(List<ServiceRequest> requests, ServiceRequestStatus status) {
        return requests.stream().filter(r -> r.getStatus() == status).map(ServiceRequest::getId).toList();
    }

    private Map<UUID, String> names(List<ServiceRequest> requests) {
        Set<UUID> assignees = requests.stream().map(ServiceRequest::getAssigneeId).filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<UUID, String> names = new HashMap<>();
        if (!assignees.isEmpty()) {
            for (User u : users.findAllById(assignees)) {
                names.put(u.getId(), u.getName());
            }
        }
        return names;
    }

    private Map<UUID, String> latestCheckStatus(List<UUID> ids) {
        Map<UUID, ServiceRequestDraftCheck> latest = new HashMap<>();
        for (ServiceRequestDraftCheck c : draftChecks.findByRequestIdIn(ids)) {
            latest.merge(c.getRequestId(), c, (a, b) -> b.getDraftVersion() > a.getDraftVersion() ? b : a);
        }
        Map<UUID, String> status = new HashMap<>();
        latest.forEach((id, c) -> status.put(id, c.getStatus()));
        return status;
    }

    private Map<UUID, Instant> approvedAt(Collection<UUID> ids) {
        Map<UUID, Instant> out = new HashMap<>();
        for (ServiceRequestEvent e : events.findByRequestIdInOrderByAtAsc(ids)) {
            if (APPROVED_EVENT.equals(e.getEvent())) {
                out.merge(e.getRequestId(), e.getAt(), (a, b) -> b.isAfter(a) ? b : a);
            }
        }
        return out;
    }

    // Free-form `_state` carries mobiles and identity fields, so only what the case summary draws is copied.
    private static Map<String, Object> projected(Map<String, Object> details) {
        if (details == null) {
            return null;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        for (String key : SCALAR_DETAILS) {
            Object v = details.get(key);
            if (v != null && !(v instanceof Map) && !(v instanceof Collection)) {
                out.put(key, v);
            }
        }
        Map<String, Object> state = ServiceRequestPricing.childObject(details, "_state");
        if (!state.isEmpty()) {
            Map<String, Object> slim = new LinkedHashMap<>();
            Map<String, Object> owner = pick(ServiceRequestPricing.childObject(state, "owner"), "oName");
            putIfAny(slim, "owner", owner);
            putIfAny(slim, "prop", pick(ServiceRequestPricing.childObject(state, "prop"), "flatNo", "society", "locality"));
            putIfAny(slim, "terms", pick(ServiceRequestPricing.childObject(state, "terms"), "rent", "deposit", "months"));
            if (state.get("tenants") instanceof List<?> tenants) {
                List<Map<String, Object>> names = new ArrayList<>();
                for (Object t : tenants) {
                    if (t instanceof Map<?, ?> row && row.get("name") != null) {
                        names.add(Map.of("name", row.get("name")));
                    }
                }
                if (!names.isEmpty()) {
                    slim.put("tenants", names);
                }
            }
            putIfAny(out, "_state", slim);
        }
        return out;
    }

    private static Map<String, Object> pick(Map<String, Object> source, String... keys) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (String key : keys) {
            Object v = source.get(key);
            if (v != null && !(v instanceof Map) && !(v instanceof Collection)) {
                out.put(key, v);
            }
        }
        return out;
    }

    private static void putIfAny(Map<String, Object> target, String key, Map<String, Object> value) {
        if (!value.isEmpty()) {
            target.put(key, value);
        }
    }
}
