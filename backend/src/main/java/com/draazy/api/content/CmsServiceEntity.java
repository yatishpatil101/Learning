package com.draazy.api.content;

import com.draazy.api.common.persistence.SoftDeleteEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A paid-services directory entry (packers, painters, legal, etc). Extends {@link SoftDeleteEntity}
 * for the soft-delete triplet. The public endpoint returns only non-archived rows.
 */
@Entity
@Table(name = "cms_services")
@Getter
public class CmsServiceEntity extends SoftDeleteEntity {

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "icon")
    private String icon;

    @Column(name = "description")
    private String description;

    @Column(name = "link")
    private String link;

    /** Editor-written translations, keyed language then wire field name — see {@link FaqEntity}. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "translations", nullable = false)
    private Map<String, Map<String, String>> translations = new LinkedHashMap<>();

    protected CmsServiceEntity() {}

    /** Copy the non-null fields of {@code w} onto this row — see {@link ContentWrite}. */
    void apply(ContentWrite w) {
        if (w.name() != null) { this.name = w.name(); }
        if (w.icon() != null) { this.icon = w.icon(); }
        if (w.description() != null) { this.description = w.description(); }
        if (w.link() != null) { this.link = w.link(); }
        if (w.translations() != null) { this.translations = w.translations(); }
    }
}
