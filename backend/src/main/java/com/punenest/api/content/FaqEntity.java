package com.punenest.api.content;

import com.punenest.api.common.persistence.SoftDeleteEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;

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

    protected FaqEntity() {}

    /** Copy the non-null fields of {@code w} onto this row — see {@link ContentWrite}. */
    void apply(ContentWrite w) {
        if (w.question() != null) { this.question = w.question(); }
        if (w.answer() != null) { this.answer = w.answer(); }
        if (w.category() != null) { this.category = w.category(); }
    }
}
