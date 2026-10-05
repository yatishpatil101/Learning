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

            if ("sent".equals(prepared.status()) && prepared.body().contains(baseUrl + "/signin")) {
                property.recordClaimLinkSent();
            }

        audit.record(caller, "property.outreach", "property", property.getId().toString(),
                "template", templateId, "owner", owner.getId().toString(), "message", prepared.id().toString());
        return prepared;
    }

    @Transactional(readOnly = true)
    public List<OwnerOutreachEntry> history(String propertyId) {
        Property property = load(propertyId);
        return ledger.findBySubjectTypeAndSubjectIdOrderByPreparedAtDesc(SUBJECT, property.getId()).stream()
                .map(OwnerOutreachEntry::of)
                .toList();
    }

    // Narrowed to staff-posted listings because only those render a chaser count.
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

    // Unresolved placeholders are left standing so the preview exposes the gap.
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
        vars.put("claim_link", baseUrl + "/signin?claim=" + property.getId());
        vars.put("listing_link", baseUrl + "/property/" + property.getId());
        return vars;
    }

    // Active only because a retired locality rate is one we have dropped.
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

    // Read from the row, not the token, so name changes take effect immediately.
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
