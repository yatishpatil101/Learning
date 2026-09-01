package com.punenest.api.engagement.society;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Answers.
 *
 * <p>Reads go through {@link SocietyQuestionRepository#answersFor} — a page of questions is the only
 * way anybody looks at answers, and a finder here would invite the per-question query this exists to
 * avoid. This interface is for writes and for the delete cascade JPA needs to know about.
 */
public interface SocietyAnswerRepository extends JpaRepository<SocietyAnswer, UUID> {
}
