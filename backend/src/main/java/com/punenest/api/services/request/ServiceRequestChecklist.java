package com.punenest.api.services.request;

import com.punenest.api.documents.vault.DocumentDto;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The named paperwork a service request asks for, and the fold from vault documents onto it (D120).
 *
 * <p><strong>Where the list comes from.</strong> These are the items the frontend mock has carried
 * since the service flow was built ({@code frontend/src/lib/serviceFlow.js}, {@code defaultDocs}) —
 * the same names, in the same order, so a tracker switched from the mock provider to the live API
 * renders the same column rather than a different one. The mock's own ids ({@code d_oid} and
 * friends) are deliberately <em>not</em> reused: they are a browser fixture's internal keys, and
 * putting them in a published contract would freeze a private detail into a public one. The slugs
 * here say what the item is.
 *
 * <p><strong>The register says six; the mock names five.</strong> Five is what is implemented,
 * because the mock is the specification the tracker was built against and it has exactly five
 * entries. Inventing a sixth to match a count in a prose row would put an item on every customer's
 * checklist that no surface has ever asked for.
 *
 * <p><strong>One list for every service type, for now.</strong> The mock seeds these on every
 * request regardless of type, so a per-type catalogue would change behaviour rather than expose it.
 * A rent-agreement checklist on a legal-opinion request is a real wart; it is the mock's wart, and
 * closing it is a product decision about what each service needs, not a backend one. When that
 * decision arrives the shape here is already right — swap the constant for a lookup on
 * {@code request.getType()} and nothing above this class changes.
 */
final class ServiceRequestChecklist {

    private ServiceRequestChecklist() {
    }

    /**
     * Slug → display name, in render order. A {@link LinkedHashMap} rather than two parallel lists
     * or a record array, because the two things this class does are "iterate in order" and "look up
     * by category", and one ordered map does both without a second structure to keep in step.
     */
    private static final Map<String, String> ITEMS = new LinkedHashMap<>();

    static {
        ITEMS.put("owner-id", "Owner Aadhaar + PAN");
        ITEMS.put("tenant-id", "Tenant Aadhaar + PAN");
        ITEMS.put("ownership-proof", "Ownership proof (Index II / tax receipt)");
        ITEMS.put("passport-photos", "Passport photos (all parties)");
        ITEMS.put("electricity-bill", "Latest electricity bill");
    }

    /**
     * Fold the request's documents onto the catalogue.
     *
     * <p>Matching is case-insensitive on {@code category} and nothing else. Not a prefix or a
     * substring match: {@code owner-id} would then be satisfied by a file filed under
     * {@code owner-id-rejected}, and a checklist that reports paperwork it does not have is worse
     * than one that reports nothing.
     *
     * <p>{@code documents} arrives newest-first from the vault
     * ({@code findByServiceRequestIdOrderByUploadedAtDesc}), so the first match per category is the
     * current one. A re-upload therefore supersedes rather than duplicating, which is the behaviour
     * the desk expects when a customer sends a legible scan of something they already sent.
     *
     * <p>Documents under any other category — {@code draft}, {@code final-document}, the
     * {@code service-request} default — are ignored here by construction. They are on the request
     * and visible through {@code GET /service-requests/{id}}; they are not items the customer was
     * asked for, and counting them would inflate "3 of 5" with the desk's own output.
     */
    static ServiceRequestChecklistDto of(List<DocumentDto> documents) {
        Map<String, String> newestByCategory = new LinkedHashMap<>();
        for (DocumentDto document : documents) {
            if (document.category() == null) {
                continue;
            }
            newestByCategory.putIfAbsent(
                    document.category().trim().toLowerCase(Locale.ROOT), document.id());
        }

        List<ServiceRequestChecklistDto.Item> items = ITEMS.entrySet().stream()
                .map(entry -> {
                    String documentId = newestByCategory.get(entry.getKey());
                    return new ServiceRequestChecklistDto.Item(
                            entry.getKey(), entry.getValue(), documentId != null, documentId);
                })
                .toList();

        int ready = (int) items.stream().filter(ServiceRequestChecklistDto.Item::done).count();
        return new ServiceRequestChecklistDto(ready, items.size(), items);
    }
}
