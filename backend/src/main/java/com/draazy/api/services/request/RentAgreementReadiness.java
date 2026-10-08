package com.draazy.api.services.request;

import com.draazy.api.common.error.ConflictException;
import com.draazy.api.documents.vault.DocumentRepository;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

// Registration needs identity rows for every signatory and witness.
// Each person also needs required papers; the flat needs ownership proof.
@Component
class RentAgreementReadiness {

    private static final int NAMED_AT_MOST = 6;
    private static final Set<String> PERSON_PAPERS = Set.of("pan", "aadhaar", "passport", "visa", "photo");

    private static final Set<String> RESIDENTIAL =
            Set.of("Flat / Apartment", "Independent House / Bungalow", "Row House");

    static String sideOf(String category) {
        String c = category == null ? "" : category.strip().toLowerCase(Locale.ROOT);
        if (c.startsWith("licensor-") || "ownership-proof".equals(c)) {
            return "owner";
        }
        return c.startsWith("tenant-") ? "tenant" : null;
    }

    static String identityScanSide(String category) {
        String c = category == null ? "" : category.strip().toLowerCase(Locale.ROOT);
        return PERSON_PAPERS.stream().anyMatch(paper -> c.endsWith("-" + paper)) ? sideOf(c) : null;
    }

    private final ServiceRequestIdentityRepository identities;
    private final DocumentRepository documents;

    RentAgreementReadiness(ServiceRequestIdentityRepository identities, DocumentRepository documents) {
        this.identities = identities;
        this.documents = documents;
    }

    void require(ServiceRequest request) {
        if (!ServiceRequestTypes.RENT_AGREEMENT.equals(request.getType())) {
            return;
        }
        List<String> missingDocuments = missingDocuments(request);
        if (!missingDocuments.isEmpty()) {
            throw new ConflictException("Upload required documents before checkout: "
                    + summarise(missingDocuments) + ".");
        }
        List<String> missingIdentities = missingIdentities(request);
        if (!missingIdentities.isEmpty()) {
            throw new ConflictException("Record Aadhaar numbers before checkout: "
                    + summarise(missingIdentities) + ".");
        }
        List<String> missingParticulars = missingParticulars(request);
        if (!missingParticulars.isEmpty()) {
            throw new ConflictException("Complete the agreement before checkout: "
                    + summarise(missingParticulars) + ".");
        }
    }

    static List<String> missingParticulars(ServiceRequest request) {
        Map<String, Object> details = request.getDetails() == null ? Map.of() : request.getDetails();
        Map<String, Object> state = ServiceRequestPricing.childObject(details, "_state");
        Map<String, Object> terms = ServiceRequestPricing.childObject(state, "terms");
        Map<String, Object> prop = ServiceRequestPricing.childObject(state, "prop");
        List<String> missing = new ArrayList<>();
        Long rent = ServiceRequestPricing.rupees(details.get("rent"), terms.get("rent"));
        if (rent == null || rent <= 0L) {
            missing.add("Monthly rent");
        }
        need(missing, terms.get("startDate"), "Start date");
        need(missing, prop.get("flatNo"), "Flat number");
        need(missing, prop.get("society"), "Society / building");
        need(missing, prop.get("locality"), "Locality");
        need(missing, prop.get("pincode"), "Pincode");
        boolean areaStamped = stated(details.get("regArea"))
                || stated(state.get("regArea"));
        if (!areaStamped && !(prop.get("gramPanchayat") instanceof Boolean)) {
            missing.add("Gram panchayat (Yes or No)");
        }
        need(missing, prop.get("area"), "Area");
        if (!RESIDENTIAL.contains(String.valueOf(prop.get("propType")))) {
            missing.add("A residential property type");
        }
        Map<String, Object> owner = ServiceRequestPricing.childObject(state, "owner");
        entity(missing, owner, "Licensor 1");
        need(missing, owner.get("oName"), "Licensor 1 name");
        need(missing, owner.get("oAge"), "Licensor 1 age");
        need(missing, owner.get("oAddr"), "Licensor 1 address");
        offlinePapers(missing, owner, "Licensor 1");
        List<Map<?, ?>> coOwners = rows(state.get("coOwners"));
        for (int i = 0; i < coOwners.size(); i++) {
            entity(missing, coOwners.get(i), "Licensor " + (i + 2));
            need(missing, coOwners.get(i).get("name"), "Licensor " + (i + 2) + " name");
            need(missing, coOwners.get(i).get("age"), "Licensor " + (i + 2) + " age");
            need(missing, coOwners.get(i).get("addr"), "Licensor " + (i + 2) + " address");
            offlinePapers(missing, coOwners.get(i), "Licensor " + (i + 2));
        }
        List<Map<?, ?>> tenants = rows(state.get("tenants"));
        for (int j = 0; j < Math.max(1, tenants.size()); j++) {
            Map<?, ?> tenant = j < tenants.size() ? tenants.get(j) : Map.of();
            entity(missing, tenant, "Tenant " + (j + 1));
            need(missing, tenant.get("name"), "Tenant " + (j + 1) + " name");
            need(missing, tenant.get("age"), "Tenant " + (j + 1) + " age");
            need(missing, tenant.get("addr"), "Tenant " + (j + 1) + " address");
            offlinePapers(missing, tenant, "Tenant " + (j + 1));
        }
        Map<String, Object> wit = ServiceRequestPricing.childObject(state, "wit");
        for (int w = 1; w <= 2; w++) {
            need(missing, wit.get("w" + w + "Name"), "Witness " + w + " name");
            need(missing, wit.get("w" + w + "Age"), "Witness " + w + " age");
            need(missing, wit.get("w" + w + "Addr"), "Witness " + w + " address");
        }
        return missing;
    }

    private static boolean stated(Object value) {
        return value != null && !value.toString().isBlank();
    }

    private static void need(List<String> missing, Object value, String label) {
        if (!stated(value)) {
            missing.add(label);
        }
    }

    private static void entity(List<String> missing, Map<?, ?> party, String label) {
        if ("entity".equals(String.valueOf(party.get("type")))) {
            missing.add(label + " must use the legal desk quote flow for company or firm parties");
        }
    }

    private static void offlinePapers(List<String> missing, Map<?, ?> party, String label) {
        String residency = residency(party);
        if ("resident".equals(residency)) {
            return;
        }
        need(missing, party.get("passport"), label + " passport number");
        if ("foreign".equals(residency)) {
            need(missing, party.get("visaOci"), label + " visa / OCI details");
        }
    }

    List<String> missingDocuments(ServiceRequest request) {
        Set<String> filed = documents.findByServiceRequestIdOrderByUploadedAtDesc(request.getId()).stream().map(com.draazy.api.documents.vault.Document::getCategory).filter(Objects::nonNull).map(category -> category.strip().toLowerCase(Locale.ROOT)).collect(Collectors.toSet());
        return ServiceRequestChecklist.itemsFor(request).entrySet().stream().filter(entry -> !filed.contains(entry.getKey())).map(Map.Entry::getValue).toList();
    }

    List<String> missingIdentities(ServiceRequest request) {
        Map<String, Object> state = ServiceRequestPricing.childObject(request.getDetails() == null
                ? Map.of() : request.getDetails(), "_state");
        List<Map<?, ?>> licensors = new ArrayList<>();
        licensors.add(ServiceRequestPricing.childObject(state, "owner"));
        licensors.addAll(rows(state.get("coOwners")));
        int tenants = Math.max(1, rows(state.get("tenants")).size());

        List<ServiceRequestIdentity> recorded =
                identities.findByServiceRequestIdOrderByPartyRoleAscPartyIndexAsc(request.getId());
        Set<String> identified = recorded.stream().filter(row -> row.getAadhaar() != null).map(row -> row.getPartyRole() + ":" + row.getPartyIndex()).collect(Collectors.toSet());

        List<String> missing = new ArrayList<>();
        for (int i = 0; i < licensors.size(); i++) {
            if ("resident".equals(residency(licensors.get(i))) && !identified.contains("owner:" + i)) {
                missing.add("Licensor " + (i + 1));
            }
        }
        List<Map<?, ?>> tenantRows = rows(state.get("tenants"));
        for (int j = 0; j < tenants; j++) {
            Map<?, ?> tenant = j < tenantRows.size() ? tenantRows.get(j) : Map.of();
            if ("resident".equals(residency(tenant)) && !identified.contains("tenant:" + j)) {
                missing.add("Tenant " + (j + 1));
            }
        }
        for (int w = 0; w < 2; w++) {
            if (!identified.contains("witness:" + w)) {
                missing.add("Witness " + (w + 1));
            }
        }
        Set<String> aadhaars = new HashSet<>();
        if (recorded.stream().map(ServiceRequestIdentity::getAadhaar).filter(Objects::nonNull).anyMatch(aadhaar -> !aadhaars.add(aadhaar))) {
            missing.add("a distinct Aadhaar number for every party");
        }
        return missing;
    }

    private static String summarise(List<String> items) {
        String named = String.join(", ", items.subList(0, Math.min(items.size(), NAMED_AT_MOST)));
        String more = items.size() > NAMED_AT_MOST ? " and " + (items.size() - NAMED_AT_MOST) + " more" : "";
        return named + more;
    }

    private static List<Map<?, ?>> rows(Object value) {
        if (!(value instanceof List<?> items)) {
            return List.of();
        }
        return items.stream().filter(Map.class::isInstance).<Map<?, ?>>map(Map.class::cast).toList();
    }

    private static String residency(Map<?, ?> party) {
        Object raw = party.get("residency");
        String value = raw == null || raw.toString().isBlank() ? "resident" : raw.toString().trim();
        return "nri".equals(value) || "foreign".equals(value) ? value : "resident";
    }
}
