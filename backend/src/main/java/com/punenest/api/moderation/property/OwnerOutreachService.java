package com.punenest.api.moderation.property;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.MessageSender;
import com.punenest.api.common.trust.OutreachCounts;
import com.punenest.api.common.web.Ids;
import com.punenest.api.engagement.messaging.OutboundMessage;
import com.punenest.api.engagement.messaging.OutboundMessageRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Chasing the owner of a listing — the server behind the console's Follow-up tab and its WhatsApp
 * template panel.
 *
 * <p>Both of those shipped without a server. {@code sendOwnerReminder} incremented a number in the
 * browser's own copy of the data and sent nothing at all; {@code sendWhatsappTemplate} did open a
 * real WhatsApp chat, but left no trace, so two staff members chasing the same owner on the same
 * morning had no way to discover each other. This closes both: the message is composed once, by the
 * server, and recorded where the next colleague will see it.
 *
 * <p><strong>Its own service rather than a method on {@link OnBehalfListingService}.</strong> That
 * class is about attribution — naming somebody else as the owner of a listing — and this is about
 * pursuit. They share a permission and a first caller, which is exactly the coincidence that makes
 * merging them tempting and wrong: outreach is already wanted for listings nobody posted on behalf
 * of (a stale listing whose owner has gone quiet), and the day it grows a second subject type the
 * split will have paid for itself.
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
    private final String baseUrl;

    public OwnerOutreachService(
            PropertyRepository properties,
            MessageSender sender,
            OutboundMessageRepository ledger,
            AuditService audit,
            UserRepository users,
            @Value("${punenest.app.base-url}") String baseUrl) {
        this.properties = properties;
        this.sender = sender;
        this.ledger = ledger;
        this.audit = audit;
        this.users = users;
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    }

    /**
     * Compose a chaser to this listing's owner and record it.
     *
     * <p>Audited on every call, and that is not routine bookkeeping. This is the one operation on
     * the platform where a staff member causes a message to arrive on a member of the public's
     * personal phone, in the platform's name, without that person having asked for it. The audit row
     * is what makes "who keeps messaging this owner" an answerable question.
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

    /**
     * Chaser counts for a page of listings, in one query.
     *
     * <p>Narrowed to staff-posted listings before asking, because the response mapper renders the
     * count only for those; counting the rest would enlarge the {@code in} list to no visible end.
     * An empty selection short-circuits to {@link OutreachCounts#NONE} rather than issuing
     * {@code in ()}, which some drivers will not parse and none will answer usefully.
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
     * Values for the template's {@code {placeholder}} keys.
     *
     * <p>Two of the console's nine are deliberately absent, and their keys will render literally in
     * the preview the staff member reads before sending — which is the point of leaving unknown keys
     * standing rather than blanking them.
     *
     * <p>{@code market_rate} was the string {@code "9,500"}, the same number for every locality in
     * Pune. Carrying that across would be quoting an invented figure to an owner deciding what to
     * charge. When there is a real rate to quote, this is the line that gains it.
     *
     * <p>{@code claim_link} pointed at {@code /claim/{id}}, a route this application does not have
     * and never had. There is nothing to build, either: the account was provisioned against the
     * owner's own mobile, so signing in with it <em>is</em> the claim. The key resolves to the
     * sign-in page, which is the thing that actually completes the sentence "verify here".
     *
     * <p>{@code listing_link} is the same repair one step further out. Three templates
     * ({@code wa-live}, {@code wa-stale}, {@code wa-dormant}) wrote the URL out by hand as
     * {@code punenest.com/property/{listing_id}}, so every chaser sent from a staging box asked the
     * owner to confirm availability on <em>production</em> — against a listing id that may not exist
     * there. It is built from the same {@code baseUrl} as {@code claim_link} for the same reason:
     * the one place that knows which deployment this is, is the deployment.
     */
    private Map<String, String> variables(Property property, User owner, AuthPrincipal caller) {
        Map<String, String> vars = new LinkedHashMap<>();
        vars.put("owner_name", owner.getName() != null ? owner.getName() : "there");
        vars.put("owner_mobile", owner.getMobile());
        vars.put("title", property.getTitle());
        vars.put("locality", property.getLocality());
        vars.put("price", property.getPrice() != null ? String.valueOf(property.getPrice()) : null);
        vars.put("listing_id", property.getId().toString());
        vars.put("staff_name", staffName(caller));
        vars.put("claim_link", baseUrl + "/signin");
        vars.put("listing_link", baseUrl + "/property/" + property.getId());
        return vars;
    }

    /**
     * The name the owner will see this message signed with.
     *
     * <p>Read from the user row rather than the token, because {@link AuthPrincipal} carries only
     * identity and trust claims — deliberately, since a display name is mutable and a JWT is not, so
     * a renamed colleague would keep signing messages with their old name until their session
     * expired.
     *
     * <p>Falls back to the platform's own name rather than blank. A chaser signed "— , PuneNest"
     * reads as a bug to the owner receiving it, and there is no case where naming the individual
     * matters more than the message being well-formed.
     */
    private String staffName(AuthPrincipal caller) {
        return users.findById(caller.userId())
                .map(User::getName)
                .filter(name -> name != null && !name.isBlank())
                .orElse("PuneNest");
    }

    private Property load(String propertyId) {
        UUID id = Ids.parseUuid(propertyId).orElseThrow(() -> NotFoundException.of("Listing"));
        return properties.findById(id).orElseThrow(() -> NotFoundException.of("Listing"));
    }

    /**
     * One chaser as the Follow-up tab renders it.
     *
     * @param status {@code prepared} on every row today. The tab must label it as such: this
     *     platform composes the message and hands it to a staff member's own WhatsApp, so it knows
     *     a chaser was written and cannot know one was delivered. See
     *     {@link com.punenest.api.common.trust.MessageSender}.
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
