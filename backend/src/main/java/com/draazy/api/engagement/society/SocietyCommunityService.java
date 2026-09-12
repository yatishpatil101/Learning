package com.draazy.api.engagement.society;

import com.draazy.api.catalog.society.Society;
import com.draazy.api.catalog.society.SocietyRepository;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The society hub's two community surfaces: questions and the noticeboard.
 *
 * <p><strong>What was actually broken.</strong> Both lived in {@code localStorage} —
 * {@code dzSocietyQA} and {@code dzSocietyBoard} — so a committee that posted "water off Tuesday
 * 6–10am" published it to itself, and every answer a resident wrote to a prospective buyer's
 * question was stored in the resident's own browser and read by nobody. The hub rendered
 * convincingly throughout, which is why it survived this long.
 *
 * <p><strong>Two different gates, on purpose.</strong> Anyone signed in may ask or answer a
 * question; only a verified resident, the committee, or staff may post to the board. A question is
 * an enquiry and the person with the most to ask lives somewhere else; a notice is an assertion
 * about the building, and a stranger is not in a position to make one. The reader is protected on
 * the Q&A side by a badge rather than a gate — {@code authorIsResident} — so a stranger's answer is
 * visibly a stranger's without being silenced.
 *
 * <p><strong>The resident badge is computed, never stored.</strong> Every read here resolves the
 * authors of the page it is returning against {@code society_residents} in one query. A stored flag
 * would keep asserting "verified resident" after the committee rejected the person, which is the one
 * thing a trust badge must not do.
 */
@Service
public class SocietyCommunityService {

    private final SocietyQuestionRepository questions;
    private final SocietyAnswerRepository answers;
    private final SocietyBoardItemRepository board;
    private final SocietyResidentRepository residents;
    private final SocietyClaimRepository claims;
    private final SocietyRepository societies;
    private final SocietyAuthors authors;

    public SocietyCommunityService(SocietyQuestionRepository questions,
            SocietyAnswerRepository answers, SocietyBoardItemRepository board,
            SocietyResidentRepository residents, SocietyClaimRepository claims,
            SocietyRepository societies, SocietyAuthors authors) {
        this.questions = questions;
        this.answers = answers;
        this.board = board;
        this.residents = residents;
        this.claims = claims;
        this.societies = societies;
        this.authors = authors;
    }

    /* ------------------------------------------------------------------ Q&A */

    /**
     * One page of questions with every answer attached.
     *
     * <p>Answers arrive in a second query keyed on the ids this page returned, not as a mapped
     * collection. A {@code @OneToMany} would either fire one query per question or force a join
     * that makes the page size meaningless — twenty questions would come back as however many rows
     * their answers happen to make.
     */
    @Transactional(readOnly = true)
    public Page<SocietyQuestionResponse> questions(String slug, Pageable pageable) {
        Society society = society(slug);
        Page<SocietyQuestion> page = questions
                .findBySocietyIdAndRemovedAtIsNullOrderByCreatedAtDescIdDesc(society.getId(), pageable);
        if (page.isEmpty()) {
            // Not just an optimisation: `answersFor` is an `in :questionIds`, and an empty IN list
            // is invalid SQL that some providers pass straight through to Postgres.
            return Page.empty(pageable);
        }

        List<UUID> questionIds = page.getContent().stream().map(SocietyQuestion::getId).toList();
        List<SocietyAnswer> allAnswers = questions.answersFor(questionIds);

        List<UUID> authorIds = new java.util.ArrayList<>(
                page.getContent().stream().map(SocietyQuestion::getAuthorId).toList());
        allAnswers.forEach(a -> authorIds.add(a.getAuthorId()));
        SocietyAuthors.Directory directory = authors.of(society.getId(), authorIds);

        Map<UUID, List<SocietyAnswerResponse>> answersByQuestion = allAnswers.stream()
                .collect(Collectors.groupingBy(SocietyAnswer::getQuestionId, LinkedHashMap::new,
                        Collectors.mapping(a -> toResponse(a, directory), Collectors.toList())));

        return page.map(q -> toResponse(q, slug, directory,
                answersByQuestion.getOrDefault(q.getId(), List.of())));
    }

    /** Ask a question. Any signed-in caller — see the class note on why this is not resident-gated. */
    @Transactional
    public SocietyQuestionResponse ask(String slug, UUID authorId, SocietyPostRequest request) {
        Society society = society(slug);
        String body = requireBody(request);
        SocietyQuestion saved = questions.save(new SocietyQuestion(society.getId(), authorId, body));
        return toResponse(saved, slug, authors.of(society.getId(), List.of(authorId)), List.of());
    }

    /**
     * Answer one.
     *
     * <p>The question is re-checked against the society in the path rather than trusted from its id
     * alone: the id is enough to find the row, and without the check an answer could be posted to
     * one society's question through another society's URL, where it would then be invisible.
     */
    @Transactional
    public SocietyAnswerResponse answer(String slug, UUID questionId, UUID authorId,
            SocietyPostRequest request) {
        Society society = society(slug);
        SocietyQuestion question = questions.findById(questionId)
                .filter(q -> q.getSocietyId().equals(society.getId()))
                .orElseThrow(() -> NotFoundException.of("Question"));

        SocietyAnswer saved = answers.save(
                new SocietyAnswer(question.getId(), authorId, requireBody(request)));
        return toResponse(saved, authors.of(society.getId(), List.of(authorId)));
    }

    /* ---------------------------------------------------------------- board */

    /**
     * The noticeboard, optionally narrowed to events or notices.
     *
     * <p>{@code viewerId} is nullable — reading is public — and is used only to decide whether each
     * row carries a delete control.
     */
    @Transactional(readOnly = true)
    public Page<SocietyBoardItemResponse> board(String slug, String kind, UUID viewerId,
            boolean staff, Pageable pageable) {
        Society society = society(slug);
        if (kind != null && !SocietyBoardKinds.isValid(kind)) {
            throw new BadRequestException("kind must be one of: event, notice");
        }

        Page<SocietyBoardItem> page = board.boardFor(society.getId(), kind, pageable);

        List<UUID> authorIds = page.getContent().stream().map(SocietyBoardItem::getAuthorId).toList();
        SocietyAuthors.Directory directory = authors.of(society.getId(), authorIds);
        boolean committee = viewerId != null && isCommittee(society.getId(), viewerId);

        return page.map(b -> toResponse(b, slug, directory,
                canRemove(b, viewerId, committee, staff)));
    }

    /**
     * Post a notice or an event.
     *
     * <p>Gated on residency, the committee, or staff. Staff are included because ops run an
     * unclaimed society's page and a building with no committee still has a water shutdown.
     */
    @Transactional
    public SocietyBoardItemResponse post(String slug, UUID authorId, boolean staff,
            SocietyBoardItemRequest request) {
        Society society = society(slug);
        requirePoster(society.getId(), authorId, staff);

        String kind = request.kind() == null ? null : request.kind().trim().toLowerCase();
        if (!SocietyBoardKinds.isValid(kind)) {
            throw new BadRequestException("kind must be one of: event, notice");
        }
        String title = blankToNull(request.title());
        if (title == null) {
            throw new BadRequestException("title is required");
        }
        LocalDate eventDate = request.eventDate();
        LocalTime eventTime = request.eventTime();
        if (SocietyBoardKinds.EVENT.equals(kind) && eventDate == null) {
            throw new BadRequestException("eventDate is required for an event");
        }
        if (SocietyBoardKinds.NOTICE.equals(kind)) {
            // A dated notice would sort into the calendar and claim to be something happening.
            // Dropping the date is kinder than a 400 the composer has no field to point at.
            eventDate = null;
            eventTime = null;
        }

        SocietyBoardItem saved = board.save(new SocietyBoardItem(society.getId(), authorId, kind,
                title, blankToNull(request.body()), blankToNull(request.category()),
                eventDate, eventTime));

        return toResponse(saved, slug, authors.of(society.getId(), List.of(authorId)), true);
    }

    /** Take one down. The author, the committee, or staff — nobody else. */
    @Transactional
    public void remove(String slug, UUID itemId, UUID viewerId, boolean staff) {
        Society society = society(slug);
        SocietyBoardItem item = board.findById(itemId)
                .filter(b -> b.getSocietyId().equals(society.getId()))
                .orElseThrow(() -> NotFoundException.of("Board item"));

        if (!canRemove(item, viewerId, isCommittee(society.getId(), viewerId), staff)) {
            throw new ForbiddenException("Only the author, the committee or staff can remove this.");
        }
        board.delete(item);
    }

    /* -------------------------------------------------------------- helpers */

    private Society society(String slug) {
        return societies.findBySlug(slug).orElseThrow(() -> NotFoundException.of("Society"));
    }

    private static String requireBody(SocietyPostRequest request) {
        String body = blankToNull(request == null ? null : request.body());
        if (body == null) {
            throw new BadRequestException("body is required");
        }
        return body;
    }

    /** The approved claimant of this society, and nobody else — see {@code SocietyClaim}. */
    private boolean isCommittee(UUID societyId, UUID viewerId) {
        return viewerId != null && claims.findLiveClaim(societyId)
                .filter(SocietyClaim::isApproved)
                .map(c -> c.getClaimedBy().equals(viewerId))
                .orElse(false);
    }

    private void requirePoster(UUID societyId, UUID authorId, boolean staff) {
        if (staff || isCommittee(societyId, authorId)) {
            return;
        }
        boolean resident = residents.findBySocietyIdAndUserId(societyId, authorId)
                .filter(SocietyResident::isVerified)
                .isPresent();
        if (!resident) {
            throw new ForbiddenException(
                    "Verify your flat to post on this society's board.");
        }
    }

    private static boolean canRemove(SocietyBoardItem item, UUID viewerId, boolean committee,
            boolean staff) {
        return viewerId != null && (staff || committee || item.getAuthorId().equals(viewerId));
    }

    private static String blankToNull(String s) {
        if (s == null) {
            return null;
        }
        String trimmed = s.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /**
     * A display name for an author, however little of one they have.
     *
     * <p>Lives on {@link SocietyAuthors.Directory} rather than here, so that questions, the
     * noticeboard and the community tab cannot drift into three different answers to "what do we
     * call somebody whose account is gone".
     */
    private static SocietyQuestionResponse toResponse(SocietyQuestion q, String slug,
            SocietyAuthors.Directory authors, List<SocietyAnswerResponse> answers) {
        return new SocietyQuestionResponse(q.getId(), slug, authors.name(q.getAuthorId()),
                authors.isResident(q.getAuthorId()), q.getBody(), q.getCreatedAt(), answers);
    }

    private static SocietyAnswerResponse toResponse(SocietyAnswer a,
            SocietyAuthors.Directory authors) {
        return new SocietyAnswerResponse(a.getId(), a.getQuestionId(), authors.name(a.getAuthorId()),
                authors.isResident(a.getAuthorId()), a.getBody(), a.getCreatedAt());
    }

    private static SocietyBoardItemResponse toResponse(SocietyBoardItem b, String slug,
            SocietyAuthors.Directory authors, boolean canRemove) {
        return new SocietyBoardItemResponse(b.getId(), slug, b.getKind(), b.getTitle(), b.getBody(),
                b.getCategory(), b.getEventDate(), b.getEventTime(), authors.name(b.getAuthorId()),
                authors.isResident(b.getAuthorId()), canRemove, b.getCreatedAt());
    }
}
