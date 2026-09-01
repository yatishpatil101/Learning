package com.punenest.api.moderation.society;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.engagement.society.SocietyAnswerRepository;
import com.punenest.api.engagement.society.SocietyBoardItemRepository;
import com.punenest.api.engagement.society.SocietyContributionReplyRepository;
import com.punenest.api.engagement.society.SocietyContributionRepository;
import com.punenest.api.engagement.society.SocietyQuestionRepository;
import com.punenest.api.moderation.report.ReportTargetTypes;
import com.punenest.api.security.AuthPrincipal;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Taking society-hub content off the public site.
 *
 * <p><strong>Why this exists.</strong> Every recommendation, reply, question, answer and
 * noticeboard item on a society hub carries a "Report" control, and reporting one wrote to the
 * reporting member's own {@code localStorage}. The ops queue that was meant to read those reports
 * read the <em>moderator's</em> browser, so it was permanently empty: a recommendation naming a
 * real tradesman with his real mobile number could be reported by fifty neighbours and no
 * moderator would ever see one of them. Filing now goes to the platform-wide {@code reports}
 * table; this is the other half — the ability to actually do something about it.
 *
 * <p><strong>Why removal is a stamp and not a delete.</strong> The author's own {@code DELETE} on a
 * contribution or a reply really does delete the row, which is right for somebody changing their
 * mind. It is wrong for moderation: the complaint was <em>about the contents</em>, so destroying
 * them destroys the appeal, the repeat-offender check and any later lawful request in the same
 * statement. {@code removed_at} / {@code removed_by} take it off every public read and keep it.
 *
 * <p><strong>Why removal is idempotent rather than a conflict.</strong> Two neighbours reporting
 * the same post is the ordinary case, not the exception, and the second moderator to reach it has
 * done nothing wrong. The guard lives in the SQL (`where removed_at is null`), so the second call
 * changes nothing and, in particular, does not overwrite the record of who removed it first —
 * which is the only thing that answers an appeal. What it must not do is silently succeed at
 * nothing, so a target that never existed is still a 404.
 */
@Service
public class SocietyContentModerationService {

    private final SocietyContributionRepository contributions;
    private final SocietyContributionReplyRepository replies;
    private final SocietyQuestionRepository questions;
    private final SocietyAnswerRepository answers;
    private final SocietyBoardItemRepository board;
    private final AuditService audit;

    public SocietyContentModerationService(SocietyContributionRepository contributions,
            SocietyContributionReplyRepository replies, SocietyQuestionRepository questions,
            SocietyAnswerRepository answers, SocietyBoardItemRepository board,
            AuditService audit) {
        this.contributions = contributions;
        this.replies = replies;
        this.questions = questions;
        this.answers = answers;
        this.board = board;
        this.audit = audit;
    }

    /**
     * Remove one piece of society content from the public site.
     *
     * <p>Writes its own audit row rather than relying on the report queue's. Somebody auditing a
     * society must be able to see why a post went dark without having to know that a report
     * existed, in the same way {@code PropertyModerationService.flag} does for a listing.
     *
     * @param actor      the moderator; recorded as {@code removed_by}
     * @param targetType one of the five society kinds in {@link ReportTargetTypes}
     * @param targetId   the row's id, as stored on the report
     * @param because    why, for the audit trail
     * @throws NotFoundException if there is no such row — deciding a complaint while the
     *                           enforcement quietly did nothing is the defect this replaces
     */
    @Transactional
    public void remove(AuthPrincipal actor, String targetType, String targetId, String because) {
        UUID id = parseId(targetId);
        UUID moderator = actor.userId();

        boolean exists = switch (targetType) {
            case ReportTargetTypes.SOCIETY_CONTRIBUTION -> contributions.existsById(id);
            case ReportTargetTypes.SOCIETY_REPLY -> replies.existsById(id);
            case ReportTargetTypes.SOCIETY_QUESTION -> questions.existsById(id);
            case ReportTargetTypes.SOCIETY_ANSWER -> answers.existsById(id);
            case ReportTargetTypes.SOCIETY_BOARD -> board.existsById(id);
            default -> throw new IllegalArgumentException(
                    "Not a society content type: " + targetType);
        };
        if (!exists) {
            throw NotFoundException.of("Reported content");
        }

        switch (targetType) {
            case ReportTargetTypes.SOCIETY_CONTRIBUTION -> contributions.markRemoved(id, moderator);
            case ReportTargetTypes.SOCIETY_REPLY -> contributions.markReplyRemoved(id, moderator);
            case ReportTargetTypes.SOCIETY_QUESTION -> questions.markRemoved(id, moderator);
            case ReportTargetTypes.SOCIETY_ANSWER -> questions.markAnswerRemoved(id, moderator);
            case ReportTargetTypes.SOCIETY_BOARD -> board.markRemoved(id, moderator);
            default -> throw new IllegalArgumentException(
                    "Not a society content type: " + targetType);
        }

        audit.record(actor, "society.content.remove", targetType, targetId, "reason", because);
    }

    /** A malformed id is a 404 for the same reason a stranger's is: it does not exist for you. */
    private static UUID parseId(String token) {
        return com.punenest.api.common.web.Ids.parseUuid(token)
                .orElseThrow(() -> NotFoundException.of("Reported content"));
    }
}
