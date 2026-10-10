package com.draazy.api.catalog.society;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.security.AuthPrincipal;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Audited because the edit overwrites four columns in place, destroying the old values;
 * the entry carries them, since the new ones are in the row. */
@Service
@Transactional
public class SocietyAdminService {

    private final SocietyRepository societies;
    private final AuditService audit;

    public SocietyAdminService(SocietyRepository societies, AuditService audit) {
        this.societies = societies;
        this.audit = audit;
    }

    /** Alphabetical, name then slug, so offset paging over repeated names neither repeats nor skips a row. */
    @Transactional(readOnly = true)
    public Page<SocietyDirectoryRow> directory(String q, Pageable pageable) {
        Pageable page = PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), Sort.by("name", "slug"));
        return societies.findAll(SocietySpecs.browse(q, null, null), page).map(SocietyDirectoryRow::of);
    }

    /** Read-only, so no audit entry: reading destroys no evidence, and a log of every glance goes unread. */
    @Transactional(readOnly = true)
    public SocietyAdminResponse get(String slug) {
        return SocietyAdminResponse.of(
                societies.findBySlug(slug).orElseThrow(() -> NotFoundException.of("Society")));
    }

    /** Re-reads after the write, since a coalesced update makes echoing the request misreport omitted fields. */
    public SocietyAdminResponse edit(String slug, SocietyAdminEditRequest request, AuthPrincipal operator) {
        Society before = societies.findBySlug(slug).orElseThrow(() -> NotFoundException.of("Society"));

        // A note that arrived blank is stored as null: "no note" has one representation, so the
        // console cannot render a cleared note differently from one that never existed.
        boolean noteGiven = request.adminNote() != null;
        String note = noteGiven && !request.adminNote().isBlank() ? request.adminNote().trim() : null;

        societies.applyAdminEdit(before.getId(), request.registration(), request.conveyance(),
                request.maintenancePerSqft(), noteGiven, note);

        audit.record(operator, "society.edit", "society", slug,
                "wasRegistration", before.isRegistration(),
                "wasConveyance", before.isConveyance(),
                "wasMaintenancePerSqft", before.getMaintenancePerSqft(),
                "hadNote", before.getAdminNote() != null);

        return SocietyAdminResponse.of(
                societies.findBySlug(slug).orElseThrow(() -> NotFoundException.of("Society")));
    }
}
