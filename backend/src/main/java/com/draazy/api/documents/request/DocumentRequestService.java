package com.draazy.api.documents.request;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.UnauthorizedException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.web.Ids;
import com.draazy.api.documents.vault.Document;
import com.draazy.api.documents.vault.DocumentMapper;
import com.draazy.api.documents.vault.DocumentRepository;
import com.draazy.api.documents.vault.DocumentSummary;
import com.draazy.api.documents.vault.DocumentUrl;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DocumentRequestService {

    private static final Logger LOG = LoggerFactory.getLogger(DocumentRequestService.class);

    // Long enough for a buyer to forward the link to their lawyer and for the lawyer to get to it after a weekend.
    private static final Duration GRANT_TTL = Duration.ofDays(7);

    private final DocumentRequestRepository requests;
    private final DocumentRepository documents;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final DocumentRequestMapper mapper;
    private final DocumentMapper documentMapper;
    private final Notifier notifier;
    private final AuditService audit;

    public DocumentRequestService(DocumentRequestRepository requests, DocumentRepository documents,
            PropertyRepository properties, UserRepository users, DocumentRequestMapper mapper,
            DocumentMapper documentMapper, Notifier notifier, AuditService audit) {
        this.requests = requests;
        this.documents = documents;
        this.properties = properties;
        this.users = users;
        this.mapper = mapper;
        this.documentMapper = documentMapper;
        this.notifier = notifier;
        this.audit = audit;
    }

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
                .map(existing -> mapper.toRequesterDto(
                        existing, users.findById(buyerId).orElse(null), 0))
                .orElseGet(() -> create(buyerId, property, body));
    }

    // Paged because the owner writes none of these rows.
    @Transactional(readOnly = true)
    public Page<DocumentRequestDto> myRequests(UUID ownerId, Pageable pageable) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(ownerId);
        if (ownedPropertyIds.isEmpty()) {
            return Page.empty(pageable);
        }
        Page<DocumentRequest> rows =
                requests.findByPropertyIdInOrderByCreatedAtDesc(ownedPropertyIds, pageable);
        Map<UUID, User> requesters = users
                .findAllById(rows.getContent().stream()
                        .map(DocumentRequest::getRequesterId).distinct().toList())
                .stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
        Map<UUID, Integer> sharedCounts = sharedCounts(rows.getContent());

        return rows.map(row -> mapper.toDto(
                row, requesters.get(row.getRequesterId()),
                sharedCounts.getOrDefault(row.getId(), 0)));
    }

    @Transactional(readOnly = true)
    public Page<DocumentRequestDto> myAsks(UUID requesterId, UUID propertyId, Pageable pageable) {
        Page<DocumentRequest> rows = propertyId == null
                ? requests.findByRequesterIdOrderByCreatedAtDesc(requesterId, pageable)
                : requests.findByRequesterIdAndPropertyIdOrderByCreatedAtDesc(
                        requesterId, propertyId, pageable);
        if (rows.isEmpty()) {
            return Page.empty(pageable);
        }
        User requester = users.findById(requesterId).orElse(null);

        // Only the granted rows are counted, because only they are allowed to report a count — the mapper zeroes the
        // rest anyway.
        Map<UUID, Integer> sharedCounts = sharedCounts(rows.getContent().stream()
                .filter(row -> DocumentRequestStatuses.GRANTED.equals(row.getStatus()))
                .toList());
        return rows.map(row -> mapper.toRequesterDto(
                row, requester, sharedCounts.getOrDefault(row.getId(), 0)));
    }

    // Owner scope is enforced by lookup, before the row is accepted.
    @Transactional
    public void respond(AuthPrincipal owner, String reqId, StatusUpdate body) {
        DocumentRequest row = Ids.parseUuid(reqId)
                .flatMap(requests::findById)
                .filter(r -> properties.findByIdAndOwner_Id(
                        r.getPropertyId(), owner.userId()).isPresent())
                .orElseThrow(() -> NotFoundException.of("Document request"));

        String before = row.getStatus();
        if (body.status().equals(before)) {
            return;
        }
        if (!DocumentRequestStatuses.canTransition(row.getStatus(), body.status())) {
            throw new ConflictException("This document request has already been answered");
        }
        String shareToken = DocumentRequestStatuses.GRANTED.equals(body.status())
                ? ShareTokens.mint() : null;
        Instant expiresAt = DocumentRequestStatuses.GRANTED.equals(body.status())
                ? Instant.now().plus(GRANT_TTL) : null;
        if (requests.updateDecisionIfCurrent(row.getId(), DocumentRequestStatuses.PENDING,
                body.status(), shareToken, expiresAt) == 0) {
            DocumentRequest current = requests.findById(row.getId())
                    .orElseThrow(() -> NotFoundException.of("Document request"));
            if (body.status().equals(current.getStatus())) {
                return;
            }
            throw new ConflictException("This document request has already been answered");
        }
        audit.record(owner, "document.request." + body.status(), "documentRequest",
                row.getId().toString(), "fromStatus", before, "toStatus", body.status());

        if (DocumentRequestStatuses.GRANTED.equals(body.status())) {
            notifier.notify(row.getRequesterId(), "document.granted",
                    "Property documents unlocked",
                    "The owner approved your request \u2014 open your documents to view them. "
                            + "Access expires in " + GRANT_TTL.toDays() + " days.",
                    "/view-documents/" + row.getId());
        }
    }

    // Contract `getSharedDocuments` — read the documents a grant unlocked.
    // Unknown token, declined request, lapsed grant: one message, one status.
    @Transactional(readOnly = true)
    public List<DocumentSummary> shared(String token) {
        return documentMapper.toSummaries(unlocked(sharedGrant(token)));
    }

    /** One file of a token grant, signed on open; the same grant checks as {@link #shared}. */
    @Transactional(readOnly = true)
    public DocumentUrl sharedUrl(String token, String docId) {
        return urlOf(unlocked(sharedGrant(token)), docId);
    }

    @Transactional(readOnly = true)
    public List<DocumentSummary> myGranted(UUID requesterId, String reqId) {
        return documentMapper.toSummaries(unlocked(requesterGrant(requesterId, reqId)));
    }

    /** One file of the caller's own grant, signed on open; the same checks as {@link #myGranted}. */
    @Transactional(readOnly = true)
    public DocumentUrl myGrantedUrl(UUID requesterId, String reqId, String docId) {
        return urlOf(unlocked(requesterGrant(requesterId, reqId)), docId);
    }

    private DocumentRequest sharedGrant(String token) {
        if (token == null || token.isBlank()) {
            throw new UnauthorizedException("This share link is not valid");
        }
        return requests.findByShareToken(token)
                .filter(r -> DocumentRequestStatuses.GRANTED.equals(r.getStatus()))
                .filter(r -> r.getExpiresAt() != null && r.getExpiresAt().isAfter(Instant.now()))
                .orElseThrow(() -> new UnauthorizedException("This share link is not valid"));
    }

    private DocumentRequest requesterGrant(UUID requesterId, String reqId) {
        return Ids.parseUuid(reqId)
                .flatMap(requests::findById)
                .filter(r -> r.getRequesterId().equals(requesterId))
                .filter(r -> DocumentRequestStatuses.GRANTED.equals(r.getStatus()))
                .filter(r -> r.getExpiresAt() != null && r.getExpiresAt().isAfter(Instant.now()))
                .orElseThrow(() -> NotFoundException.of("Document request"));
    }

    private DocumentUrl urlOf(List<Document> unlocked, String docId) {
        return Ids.parseUuid(docId)
                .flatMap(id -> unlocked.stream().filter(d -> d.getId().equals(id)).findFirst())
                .map(d -> new DocumentUrl(documentMapper.urlOf(d)))
                .orElseThrow(() -> NotFoundException.of("Document"));
    }

    // What a grant actually unlocks, given a row already proven live and already proven the caller's to read.
    private List<Document> unlocked(DocumentRequest grant) {
        List<String> categories = grant.getCategories();
        if (categories.isEmpty()) {
            return documents.findByPropertyIdAndServiceRequestIdIsNullOrderByUploadedAtDesc(
                    grant.getPropertyId());
        }
        return documents.findSharable(grant.getPropertyId(),
                categories.stream().map(c -> c.toLowerCase(Locale.ROOT)).toList());
    }

    // Count the actual files each request would unlock, in one document query for a whole page.
    // Count only uploaded proofs; approval can exist before an owner uploads the file.
    private Map<UUID, Integer> sharedCounts(List<DocumentRequest> rows) {
        if (rows.isEmpty()) {
            return Map.of();
        }
        Map<UUID, List<Document>> byProperty = documents
                .findByPropertyIdInAndServiceRequestIdIsNull(
                        rows.stream().map(DocumentRequest::getPropertyId).distinct().toList())
                .stream()
                .collect(Collectors.groupingBy(Document::getPropertyId));

        return rows.stream().collect(Collectors.toMap(DocumentRequest::getId, row -> {
            List<Document> vault = byProperty.getOrDefault(row.getPropertyId(), List.of());
            if (row.getCategories().isEmpty()) {
                return vault.size();
            }
            Set<String> categories = row.getCategories().stream()
                    .map(category -> category.toLowerCase(Locale.ROOT))
                    .collect(Collectors.toSet());
            return (int) vault.stream()
                    .filter(document -> categories.contains(
                            document.getCategory().toLowerCase(Locale.ROOT)))
                    .count();
        }));
    }

    private DocumentRequestDto create(UUID buyerId, Property property, DocumentRequestCreate body) {
        UUID propertyId = property.getId();
        DocumentRequest row = new DocumentRequest(propertyId, buyerId, body.categories(),
                body.message(), Boolean.TRUE.equals(body.acknowledgedDisclaimer()));
        User buyer = users.findById(buyerId).orElse(null);
        try {
            requests.saveAndFlush(row);
            if (property.getOwner() != null) {
                notifier.notify(property.getOwner().getId(), "document.requested",
                        "New document request",
                        (buyer == null || buyer.getName() == null || buyer.getName().isBlank()
                                ? "Someone" : buyer.getName())
                                + " asked to see documents for " + property.getTitle() + ".",
                        "/dashboard#leads");
            }
        } catch (DataIntegrityViolationException concurrentDuplicate) {

            // A parallel tap won the race; its row is the one true request, so this call is simply
            // a re-read. Nothing to repair, nothing worth telling the user about.
            LOG.debug("Concurrent document request for property {}", propertyId);
            row = requests.findByRequesterIdAndPropertyIdAndStatus(
                            buyerId, propertyId, DocumentRequestStatuses.PENDING)
                    .orElseThrow(() -> concurrentDuplicate);
        }
        return mapper.toRequesterDto(row, buyer, 0);
    }

    private Property resolve(String idOrSlug) {
        return Ids.parseUuid(idOrSlug)
                .flatMap(properties::findById)
                .or(() -> properties.findBySlug(idOrSlug))
                .orElseThrow(() -> NotFoundException.of("Property"));
    }
}
