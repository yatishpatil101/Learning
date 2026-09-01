package com.punenest.api.content;

import com.punenest.api.common.persistence.SoftDeleteEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A frequently asked question. Extends {@link SoftDeleteEntity} for the soft-delete triplet.
 * The public endpoint returns only non-archived rows.
 */
@Entity
@Table(name = "faqs")
@Getter
public class FaqEntity extends SoftDeleteEntity {

    @Column(name = "question", nullable = false)
    private String question;

    @Column(name = "answer")
    private String answer;

    @Column(name = "category")
    private String category;

    /**
     * Editor-written translations, keyed language then wire field name (D2).
     *
     * <p>Typed {@code Map<String, Map<String, String>>} rather than the {@code Map<String, Object>}
     * the other jsonb columns here use, because this shape is known and fixed: two levels, strings
     * at the leaves. {@code Object} would accept a nested array or a number and only fail at the
     * point somebody tried to render it; this refuses it at deserialisation, which is where the bad
     * value actually arrives.
     *
     * <p>Empty rather than null when nothing is translated, so a reader never has to tell "this row
     * has no translations" from "this row predates translations" — they are the same fact.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "translations", nullable = false)
    private Map<String, Map<String, String>> translations = new LinkedHashMap<>();

    protected FaqEntity() {}

    /** Copy the non-null fields of {@code w} onto this row — see {@link ContentWrite}. */
    void apply(ContentWrite w) {
        if (w.question() != null) { this.question = w.question(); }
        if (w.answer() != null) { this.answer = w.answer(); }
        if (w.category() != null) { this.category = w.category(); }
        if (w.translations() != null) { this.translations = w.translations(); }
    }
}
