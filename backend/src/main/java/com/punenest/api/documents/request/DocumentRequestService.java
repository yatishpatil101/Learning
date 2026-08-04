package com.punenest.api.documents.request;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.error.UnauthorizedException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.documents.vault.DocumentDto;
import com.punenest.api.documents.vault.DocumentMapper;
import com.punenest.api.documents.vault.DocumentRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Document access: a buyer's request, the owner's decision, and the token-scoped read that a grant
 * unlocks.
 *
 * <p><strong>The invariant this class exists to protect.</strong> Property documents are the most
 * sensitive thing on the platform — a sale deed carries the owner's name, address, PAN and the
 * chain of title. Nothing here reads a document without one of two proofs: the caller owns the
 * listing, or the caller holds a live, unguessable token for a grant the owner made. There is no
 * third door, and in particular there is no "signed-in users can see documents" path.
 *
 * <p><strong>Cross-context reads</strong> into {@code catalog.property} and {@code identity.user}
 * follow the precedent set by {@code leads.contact.ContactService}: this is a join context by
 * nature, and inverting the reads would cost interfaces for no behavioural change.
 */
@Service
public class DocumentRequestService {

    private static final Logger LOG = LoggerFactory.getLogger(DocumentRequestService.class);

    /**
     * How long a grant lives.
     *
     * <p>Long enough for a buyer to forward the link to their lawyer and for the lawyer to get to
     * it after a weekend; short enough that a link pasted into a WhatsApp group is not a permanent
     * exposure. A grant with no deadline is the failure mode worth designing against: nobody ever
     * goes back to revoke one.
     */
    private static final Duration GRANT_TTL = Duration.ofDays(7);

    private final DocumentRequestRepository requests;
    private final DocumentRepository documents;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final DocumentRequestMapper mapper;
    private final DocumentMapper documentMapper;

    public DocumentRequestService(DocumentRequestRepository requests, DocumentRepository documents,
            PropertyRepository properties, UserRepository users, DocumentRequestMapper mapper,
            DocumentMapper documentMapper) {
        this.requests = requests;
        this.documents = documents;
        this.properties = properties;
        this.users = users;
        this.mapper = mapper;
        this.documentMapper = documentMapper;
    }

    /**
     * Contract {@code requestDocumentAccess} — a buyer asks the owner for access.
     *
     * <p><strong>Idempotent while pending.</strong> A second tap returns the open request rather
     * than inserting another, so a double-submit cannot flood the owner's inbox — the same rule as
     * the contact gate, and for the same reason. Two genuinely concurrent taps can both miss the
     * read, so V20's {@code uq_document_requests_pending} partial index is the real guarantee and
     * the loser of the race simply re-reads the winner's row.
     *
     * <p><strong>Only <em>pending</em> is unique, deliberately.</strong> Once a request has been
     * answered the buyer may ask again — perhaps for different categories, perhaps because the
     * first ask was declined before they had a loan sanction. A total unique index would have made
     * a single "no" permanent, which is a policy nobody chose.
     *
     * @throws NotFoundException when no such listing exists
     * @throws ConflictException when the caller owns the listing — their vault is at
     *                           {@code /me/documents/{propId}}, and a request to oneself would sit
     *                           in one's own inbox forever
     */
    @Transactional
    public DocumentRequestDto request(UUID buyerId, DocumentRequestCreate body) {
        Property property = resolve(body.propertyId());
        User owner = property.getOwner();
        if (owner != null && owner.getId().equals(buyerId)) {
            throw new ConflictException("You own this listing; its documents are in your vault");
        }

        return requests
                .findByRequesterIdAndPropertyIdAndStatus(
                        buyerId, property.getId(), DocumentRequestStatuses.PENDING)
                .map(existing -> mapper.toDto(existing, users.findById(buyerId).orElse(null)))
                .orElseGet(() -> create(buyerId, property.getId(), body));
    }

    /**
     * Contract {@code myDocumentRequests} — every request against listings the caller owns, newest
     * first.
     *
     * <p>Strictly owner-scoped: the id set comes from {@code properties.owner_id}, so an owner with
     * no listings gets an empty array without a second query and can never see a foreign request.
     * N+1-safe: one query for the listing ids, one for the requests, one for all the requesters.
     */
    @Transactional(readOnly = true)
    public List<DocumentRequestDto> myRequests(UUID ownerId) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(ownerId);
        if (ownedPropertyIds.isEmpty()) {
            return List.of();
        }
        List<DocumentRequest> rows = requests.findByPropertyIdInOrderByCreatedAtDesc(ownedPropertyIds);
        Map<UUID, User> requesters = users
                .findAllById(rows.stream().map(DocumentRequest::getRequesterId).distinct().toList())
                .stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));

        return rows.stream().map(row -> mapper.toDto(row, requesters.get(row.getRequesterId()))).toList();
    }

    /**
     * Contract {@code respondDocumentRequest} — the owner grants or declines.
     *
     * <p>Owner-scoping is enforced by lookup, not by a check after the fact: the row is only
     * accepted once {@code findByIdAndOwner_Id} confirms the caller owns the listing it points at.
     * A foreign request is a {@code 404}, never a {@code 403}.
     *
     * @throws NotFoundException when the id is unknown, malformed, or belongs to a foreign listing
     * @throws ConflictException when the request has already been answered — both end states are
     *                           terminal, so a grant the buyer has already followed cannot be
     *                           rewritten into a decline
     */
    @Transactional
    public void respond(UUID ownerId, String reqId, StatusUpdate body) {
        DocumentRequest row = Ids.parseUuid(reqId)
                .flatMap(requests::findById)
                .filter(r -> properties.findByIdAndOwner_Id(r.getPropertyId(), ownerId).isPresent())
                .orElseThrow(() -> NotFoundException.of("Document request"));

        if (!DocumentRequestStatuses.canTransition(row.getStatus(), body.status())) {
            throw new ConflictException("This document request has already been answered");
        }
        if (DocumentRequestStatuses.GRANTED.equals(body.status())) {
            row.grant(ShareTokens.mint(), Instant.now().plus(GRANT_TTL));
        } else {
            row.decline();
        }
        requests.save(row);
    }

    /**
     * Contract {@code getSharedDocuments} — read the documents a grant unlocked.
     *
     * <p><strong>Every failure is the same 401.</strong> Unknown token, declined request, lapsed
     * grant: one message, one status. Distinguishing them would turn this endpoint into an oracle —
     * "this token was real once" is exactly what someone probing forwarded links wants to learn.
     *
     * <p><strong>The expiry, not the status label, is authoritative.</strong> Nothing sweeps rows
     * to {@code expired}; a background job that had not run yet would otherwise leave a lapsed link
     * live. The clock is checked here, on every read, so a grant stops working the instant it
     * should — and {@code expired} on the wire is derived for the owner's benefit rather than being
     * the thing security depends on.
     *
     * <p>An empty {@code categories} list means the whole vault: the buyer asked for "the
     * documents" without itemising, and the owner granted that ask as it was shown to them.
     */
    @Transactional(readOnly = true)
    public List<DocumentDto> shared(String token) {
        DocumentRequest grant = requests.findByShareToken(token)
                .filter(r -> DocumentRequestStatuses.GRANTED.equals(r.getStatus()))
                .filter(r -> r.getExpiresAt() != null && r.getExpiresAt().isAfter(Instant.now()))
                .orElseThrow(() -> new UnauthorizedException("This share link is not valid"));

        List<String> categories = grant.getCategories();
        if (categories.isEmpty()) {
            return documentMapper.toDtos(
                    documents.findByPropertyIdAndServiceRequestIdIsNullOrderByUploadedAtDesc(
                            grant.getPropertyId()));
        }
        return documentMapper.toDtos(documents.findSharable(grant.getPropertyId(),
                categories.stream().map(c -> c.toLowerCase(Locale.ROOT)).toList()));
    }

    private DocumentRequestDto create(UUID buyerId, UUID propertyId, DocumentRequestCreate body) {
        DocumentRequest row = new DocumentRequest(propertyId, buyerId, body.categories(),
                body.message(), Boolean.TRUE.equals(body.acknowledgedDisclaimer()));
        try {
            requests.saveAndFlush(row);
        } catch (DataIntegrityViolationException concurrentDuplicate) {
            // A parallel tap won the race; its row is the one true request, so this call is simply
            // a re-read. Nothing to repair, nothing worth telling the user about.
            LOG.debug("Concurrent document request for property {}", propertyId);
            row = requests.findByRequesterIdAndPropertyIdAndStatus(
                            buyerId, propertyId, DocumentRequestStatuses.PENDING)
                    .orElseThrow(() -> concurrentDuplicate);
        }
        return mapper.toDto(row, users.findById(buyerId).orElse(null));
    }

    /** Resolve the contract's {@code propertyId}, which may be a UUID or a slug. */
    private Property resolve(String idOrSlug) {
        return Ids.parseUuid(idOrSlug)
                .flatMap(properties::findById)
                .or(() -> properties.findBySlug(idOrSlug))
                .orElseThrow(() -> NotFoundException.of("Property"));
    }
}
