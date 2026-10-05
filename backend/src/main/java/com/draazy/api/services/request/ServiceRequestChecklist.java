package com.draazy.api.services.request;

import com.draazy.api.documents.vault.DocumentDto;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

// Same names/order as mock defaultDocs so the live swap keeps tracker columns.
final class ServiceRequestChecklist {

    private ServiceRequestChecklist() {
    }

    // Ordered map gives render order and category lookup without parallel structures.
    private static final Map<String, String> ITEMS = new LinkedHashMap<>();

    static {
        ITEMS.put("owner-id", "Owner Aadhaar + PAN");
        ITEMS.put("tenant-id", "Tenant Aadhaar + PAN");
        ITEMS.put("ownership-proof", "Ownership proof (Index II / tax receipt)");
        ITEMS.put("passport-photos", "Passport photos (all parties)");
        ITEMS.put("electricity-bill", "Latest electricity bill");
    }

    static ServiceRequestChecklistDto of(ServiceRequest request, List<DocumentDto> documents,
            Map<String, ServiceRequestDocumentReview> reviewsByDocument, Set<String> fileableSides) {
        Map<String, String> newestByCategory = newestByCategory(documents);
        List<ServiceRequestChecklistDto.Item> items = itemsFor(request).entrySet().stream().map(entry -> {
                    String documentId = newestByCategory.get(entry.getKey());
                    ServiceRequestDocumentReview review = documentId == null ? null
                            : reviewsByDocument.get(documentId);
                    String side = RentAgreementReadiness.sideOf(entry.getKey());
                    boolean canUpload = side == null || fileableSides.contains(side);

                    boolean reasonShown = canUpload || RentAgreementReadiness.identityScanSide(entry.getKey()) == null;
                    return new ServiceRequestChecklistDto.Item(
                            entry.getKey(), entry.getValue(), documentId != null, documentId,
                            documentId == null ? null : review == null ? "pending" : review.getVerdict(),
                            review == null || !reasonShown ? null : review.getReason(), canUpload);
                }).toList();

        int ready = (int) items.stream().filter(ServiceRequestChecklistDto.Item::done).count();
        return new ServiceRequestChecklistDto(ready, items.size(), items);
    }

    static Map<String, String> newestByCategory(List<DocumentDto> documents) {
        Map<String, String> newestByCategory = new LinkedHashMap<>();
        for (DocumentDto document : documents) {
            if (document.category() == null) {
                continue;
            }
            newestByCategory.putIfAbsent(
                    document.category().trim().toLowerCase(Locale.ROOT), document.id());
        }
        return newestByCategory;
    }

    static Map<String, String> itemsFor(ServiceRequest request) {
        if (!ServiceRequestTypes.RENT_AGREEMENT.equals(request.getType())) {
            return ITEMS;
        }
        Map<String, Object> state = ServiceRequestPricing.childObject(request.getDetails() == null
                ? Map.of() : request.getDetails(), "_state");
        Map<String, String> items = new LinkedHashMap<>();
        List<Map<?, ?>> licensors = new java.util.ArrayList<>();
        licensors.add(ServiceRequestPricing.childObject(state, "owner"));
        licensors.addAll(rows(state.get("coOwners")));
        for (int i = 0; i < licensors.size(); i++) {
            int number = i + 1;
            personPapers(items, "licensor-" + i, "Licensor " + number, licensors.get(i));
            if ("poa".equals(String.valueOf(licensors.get(i).get("capacity")))) {
                items.put("licensor-" + i + "-poa",
                        "Licensor " + number + " — Registered power of attorney");
            }
        }
        items.put("ownership-proof", "Ownership proof (Index II / sale deed)");
        List<Map<?, ?>> tenantRows = rows(state.get("tenants"));
        int tenants = Math.max(1, tenantRows.size());
        for (int i = 0; i < tenants; i++) {
            int number = i + 1;
            Map<?, ?> tenant = i < tenantRows.size() ? tenantRows.get(i) : Map.of();
            personPapers(items, "tenant-" + i, "Tenant " + number, tenant);
            tenantPolicePapers(items, "tenant-" + i, "Tenant " + number, tenant);
        }
        return items;
    }

    private static void personPapers(Map<String, String> items, String prefix, String label, Map<?, ?> party) {
        items.put(prefix + "-pan", label + " — PAN card");
        String residency = residency(party);
        if ("resident".equals(residency)) {
            items.put(prefix + "-aadhaar", label + " — Aadhaar card");
        } else {
            items.put(prefix + "-passport", label + " — Passport scan");
            if ("foreign".equals(residency)) {
                items.put(prefix + "-visa", label + " — Visa / OCI scan");
            }
        }
        items.put(prefix + "-photo", label + " — Passport photo");
    }

    private static void tenantPolicePapers(Map<String, String> items, String prefix, String label, Map<?, ?> tenant) {
        if (!(tenant.get("police") instanceof Map<?, ?> police)) {
            return;
        }
        if (!"uid".equals(text(police.get("addressProofType"), ""))) {
            items.put(prefix + "-addressproof", label + " — Address proof");
        }
        boolean previousSame = !(police.get("previousSameAsPermanent") instanceof Boolean same) || same;
        if (!previousSame && !"uid".equals(text(police.get("previousAddressProofType"), ""))) {
            items.put(prefix + "-prevaddressproof", label + " — Previous address proof");
        }
        if (TenantPoliceRecordRules.requiresWorkplaceSection(tenant)) {
            items.put(prefix + "-income", label + " — Work proof");
        }
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

    private static String text(Object raw, String fallback) {
        String value = raw == null ? "" : raw.toString().trim();
        return value.isBlank() ? fallback : value;
    }
}
