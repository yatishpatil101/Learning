package com.punenest.api.catalog.city;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.security.AuthPrincipal;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Back-office reads and writes over the city roster: which cities are live, and which cities people
 * keep asking for.
 *
 * <p>The two halves are not the same shape. The roster is curated — a fixed list somebody maintains,
 * keyed by slug. The waitlist is free text typed by visitors, and by definition names cities that
 * are <em>not</em> on the roster. Reading them through one service is what lets the console put the
 * question and the answer on the same screen; keeping them as separate methods is what stops the
 * waitlist's un-curated spellings leaking into the roster's keys.
 */
@Service
public class CityAdminService {

    private final CityRepository cities;
    private final CityWaitlistRepository waitlist;
    private final AuditService audit;

    public CityAdminService(CityRepository cities, CityWaitlistRepository waitlist,
            AuditService audit) {
        this.cities = cities;
        this.waitlist = waitlist;
        this.audit = audit;
    }

    /**
     * Which cities people have asked for, most-wanted first.
     *
     * <p>Aggregate-only, and the aggregation happens in the database rather than here — see
     * {@link CityWaitlistRepository#demandByCity()}. Loading the rows and grouping them in Java
     * would put every waitlist mobile in this process's heap on the way to a response that contains
     * none of them, which is the sort of detail that survives a refactor as a leak.
     *
     * <p>Nothing is audited. This is a read of counts with no subject to attribute it to, and an
     * audit row per dashboard render would bury the toggles below it in noise.
     */
    @Transactional(readOnly = true)
    public List<CityWaitlistDemandRow> expansionDemand() {
        return waitlist.demandByCity();
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

