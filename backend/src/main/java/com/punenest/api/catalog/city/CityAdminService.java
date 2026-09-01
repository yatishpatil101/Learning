package com.punenest.api.catalog.city;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.security.AuthPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Back-office control of the curated city roster's launch state. */
@Service
public class CityAdminService {

    private final CityRepository cities;
    private final AuditService audit;

    public CityAdminService(CityRepository cities, AuditService audit) {
        this.cities = cities;
        this.audit = audit;
    }

    /**
     * Launch or pause one city shoppers may enter.
     *
     * <p><strong>An unchanged value still writes an audit row.</strong> "Ops confirmed Mumbai should
     * be live at 14:02" is a decision worth having on the record, and a history that silently drops
     * the confirmations is one you cannot reason backwards from. The row carries {@code beforeLive}
     * and {@code afterLive} precisely so that a no-op reads as one.
     *
     * <p><strong>No {@code If-Match}, unlike {@code PUT /admin/settings} (S68).</strong> That
     * endpoint edits a document assembled from several rows, where a blind overwrite silently loses
     * another admin's unrelated block. This edits one boolean on one row: the loser of a concurrent
     * toggle has lost nothing but their own click, and both attempts are in the audit log with their
     * before and after. Last-write-wins is the honest semantics here, not an oversight.
     */
    @Transactional
    public void updateLive(String slug, CityAdminUpdateRequest request, AuthPrincipal operator) {
        City city = cities.findById(slug).orElseThrow(() -> NotFoundException.of("City"));
        boolean before = city.isLive();
        // Unboxed, not `Boolean.TRUE.equals(...)`. `@NotNull` on the record makes null a 422 before
        // this runs, and mapping a null to `false` here would turn any future gap in that validation
        // into a silent un-launch rather than a loud failure.
        boolean after = request.live();
        city.setLive(after);
        audit.record(operator, "city.update", "city", slug,
                "name", city.getName(),
                "beforeLive", before,
                "afterLive", after);
    }
}

