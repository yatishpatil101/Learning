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
 * A promotional banner. Extends {@link SoftDeleteEntity} for the soft-delete triplet.
 * The public endpoint returns only non-archived rows, ordered by {@code position}.
 */
@Entity
@Table(name = "banners")
@Getter
public class BannerEntity extends SoftDeleteEntity {

    @Column(name = "image")
    private String image;

    @Column(name = "link")
    private String link;

    @Column(name = "headline")
    private String headline;

    @Column(name = "position", nullable = false)
    private int position = 0;

    /** Editor-written translations, keyed language then wire field name — see {@link FaqEntity}. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "translations", nullable = false)
    private Map<String, Map<String, String>> translations = new LinkedHashMap<>();

    protected BannerEntity() {}

    /** Copy the non-null fields of {@code w} onto this row — see {@link ContentWrite}. */
    void apply(ContentWrite w) {
        if (w.image() != null) { this.image = w.image(); }
        if (w.link() != null) { this.link = w.link(); }
        if (w.headline() != null) { this.headline = w.headline(); }
        if (w.position() != null) { this.position = w.position(); }
        if (w.translations() != null) { this.translations = w.translations(); }
    }
}
