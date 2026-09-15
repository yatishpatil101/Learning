package com.draazy.api.moderation.property;

import com.draazy.api.catalog.locality.Locality;
import com.draazy.api.catalog.locality.LocalityRepository;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.MessageSender;
import com.draazy.api.common.trust.OutreachCounts;
import com.draazy.api.common.web.Ids;
import com.draazy.api.engagement.messaging.OutboundMessage;
import com.draazy.api.engagement.messaging.OutboundMessageRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.math.BigDecimal;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

/**
 * Chasing the owner of a listing — the server behind the console's Follow-up tab and its WhatsApp
 * template panel. The message is composed once, by the server, and recorded for the next colleague.
 */
@Service
public class OwnerOutreachService {

    private static final String CHANNEL = "whatsapp";
    private static final String SUBJECT = "property";

    private final PropertyRepository properties;
    private final MessageSender sender;
    private final OutboundMessageRepository ledger;
    private final AuditService audit;
    private final UserRepository users;
    private final LocalityRepository localities;
    private final String baseUrl;

    public OwnerOutreachService(
            PropertyRepository properties,
            MessageSender sender,
            OutboundMessageRepository ledger,
            AuditService audit,
            UserRepository users,
            LocalityRepository localities,
            @Value("${draazy.app.base-url}") String baseUrl) {
        this.properties = properties;
        this.sender = sender;
        this.ledger = ledger;
        this.audit = audit;
        this.users = users;
        this.localities = localities;
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    }

    /**
     * Compose a chaser to this listing's owner and record it. Audited on every call: this is the one
     * operation that puts an unsolicited message on a member of the public's personal phone.
     */
    @Transactional
    public MessageSender.Prepared chase(AuthPrincipal caller, String propertyId, String templateId) {
        Property property = load(propertyId);
        User owner = property.getOwner();
        if (owner == null || owner.getMobile() == null || owner.getMobile().isBlank()) {
            throw new ConflictException("This listing has no owner mobile to reach.");
        }

        MessageSender.Prepared prepared = sender.send(new MessageSender.MessageRequest(
                CHANNEL,
                templateId,
                SUBJECT,
                property.getId(),
                owner.getId(),
                owner.getMobile(),
                caller.userId(),
                variables(property, owner, caller)));

            // Click-to-chat is only prepared; only a transport-confirmed claim link counts as sent.
            if ("sent".equals(prepared.status()) && prepared.body().contains(baseUrl + "/signin")
                && "staff".equals(property.getLifecycleTrack()) && property.getLifecycleStage() == null
                && !property.isArchived() && "pending".equals(property.getStatus())) {
                property.recordLifecycleStage("link_sent");
            }

        audit.record(caller, "property.outreach", "property", property.getId().toString(),
                "template", templateId, "owner", owner.getId().toString(), "message", prepared.id().toString());
        return prepared;
    }

    /** The chaser history for one listing, newest first. */
    @Transactional(readOnly = true)
    public List<OwnerOutreachEntry> history(String propertyId) {
        Property property = load(propertyId);
        return ledger.findBySubjectTypeAndSubjectIdOrderByPreparedAtDesc(SUBJECT, property.getId()).stream()
                .map(OwnerOutreachEntry::of)
                .toList();
    }

    @Transactional
    public void recordClaimLinkSent(AuthPrincipal actor, String propertyId, String messageId) {
        UUID id = Ids.parseUuid(propertyId).orElseThrow(() -> NotFoundException.of("Listing"));
        Property property = properties.findForVerificationDecision(id)
                .orElseThrow(() -> NotFoundException.of("Listing"));
        OutboundMessage message = Ids.parseUuid(messageId).flatMap(ledger::findById)
                .filter(m -> SUBJECT.equals(m.getSubjectType()) && id.equals(m.getSubjectId())
                        && property.getOwner().getId().equals(m.getRecipientId()))
                .orElseThrow(() -> NotFoundException.of("Message"));
        if (!message.getBody().contains(baseUrl + "/signin") || "failed".equals(message.getStatus())) {
            throw new ConflictException("This message is not a sendable claim link");
        }
        message.recordSent();
        if ("staff".equals(property.getLifecycleTrack()) && property.getLifecycleStage() == null
                && !property.isArchived() && "pending".equals(property.getStatus())) {
            property.recordLifecycleStage("link_sent");
        }
        audit.record(actor, "property.claim-link.sent", "property", propertyId, "message", messageId);
    }

    /**
     * Chaser counts for a page of listings, in one query. Narrowed to staff-posted listings, since
     * only those render a count; an empty selection short-circuits rather than issuing {@code in ()}.
     */
    @Transactional(readOnly = true)
    public OutreachCounts countsFor(Collection<Property> page) {
        List<UUID> ids = page.stream()
                .filter(Property::isPostedByAdmin)
                .map(Property::getId)
                .toList();
        if (ids.isEmpty()) {
            return OutreachCounts.NONE;
        }
        Map<UUID, Integer> counts = new HashMap<>();
        for (Object[] row : ledger.countBySubjects(SUBJECT, ids)) {
            counts.put((UUID) row[0], ((Number) row[1]).intValue());
        }
        return subject -> counts.getOrDefault(subject, 0);
    }

    /**
     * Values for the template's {@code {placeholder}} keys; an unresolved key is left standing so
     * the gap shows up in the preview. Rationale: docs/flows/admin/property-verification.md.
     */
    private Map<String, String> variables(Property property, User owner, AuthPrincipal caller) {
        Map<String, String> vars = new LinkedHashMap<>();
        vars.put("owner_name", owner.getName() != null ? owner.getName() : "there");
        vars.put("owner_mobile", owner.getMobile());
        vars.put("title", property.getTitle());
        vars.put("locality", property.getLocality());
        vars.put("price", property.getPrice() != null ? String.valueOf(property.getPrice()) : null);
        vars.put("market_rate", marketRate(property));
        vars.put("listing_id", property.getId().toString());
        vars.put("staff_name", staffName(caller));
        vars.put("claim_link", baseUrl + "/signin");
        vars.put("listing_link", baseUrl + "/property/" + property.getId());
        return vars;
    }

    /**
     * The locality's published per-sqft rate, or {@code null} when it has not published one. Keyed
     * on the FK-constrained slug, and {@code active} because a retired rate is one we have dropped.
     */
    private String marketRate(Property property) {
        String slug = property.getLocalitySlug();
        if (!StringUtils.hasText(slug)) {
            return null;
        }
        BigDecimal rate = localities.findBySlugAndActiveTrue(slug)
                .map(Locality::getRatePerSqft)
                .orElse(null);
        return rate == null ? null : rate.stripTrailingZeros().toPlainString();
    }

    /**
     * The name the owner will see this message signed with. Read from the user row, not the token,
     * so a display-name change takes effect without waiting for the session to expire.
     */
    private String staffName(AuthPrincipal caller) {
        return users.findById(caller.userId())
                .map(User::getName)
                .filter(name -> name != null && !name.isBlank())
                .orElse("Draazy");
    }

    private Property load(String propertyId) {
        UUID id = Ids.parseUuid(propertyId).orElseThrow(() -> NotFoundException.of("Listing"));
        return properties.findById(id).orElseThrow(() -> NotFoundException.of("Listing"));
    }

    /**
     * One chaser as the Follow-up tab renders it. {@code status} is {@code prepared} on every row:
     * the platform knows a chaser was written and cannot know one was delivered.
     */
    public record OwnerOutreachEntry(
            String id,
            String templateId,
            String channel,
            String body,
            String status,
            String preparedBy,
            java.time.Instant preparedAt) {

        static OwnerOutreachEntry of(OutboundMessage message) {
            return new OwnerOutreachEntry(
                    message.getId().toString(),
                    message.getTemplateId(),
                    message.getChannel(),
                    message.getBody(),
                    message.getStatus(),
                    message.getPreparedBy().toString(),
                    message.getPreparedAt());
        }
    }
}
