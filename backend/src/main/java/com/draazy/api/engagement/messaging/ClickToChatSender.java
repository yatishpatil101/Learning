package com.draazy.api.engagement.messaging;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.trust.MessageSender;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The {@link MessageSender} port, implemented as WhatsApp click-to-chat.
 *
 * <p>Renders the template, writes the ledger row, and hands back a {@code wa.me} link. The staff
 * member's own WhatsApp opens with the message typed out and they press send.
 *
 * <p><strong>This is not a stub.</strong> Click-to-chat is a supported, documented WhatsApp
 * mechanism that needs no Business Solution Provider, no vendor contract and no Meta template
 * approval — which is exactly why the console has been able to use it since before there was a
 * server. Owners really do receive these messages. What it cannot do is confirm it, which is why
 * the row it writes says {@code prepared} and why {@link MessageSender.Prepared#handoffLink} exists
 * at all.
 *
 * <p>Registered unconditionally rather than behind a profile. A profile-scoped recorder would mean
 * production has some other, better sender — and it does not; this is the sender. When a BSP is
 * chosen it arrives as a second implementation with a {@code @Primary} or a property switch, and
 * this one stays as the fallback for the numbers the BSP will not touch (a template outside its
 * approved set, or an owner outside its 24-hour service window — both of which are ordinary and
 * neither of which stops a human opening WhatsApp).
 */
@Component
public class ClickToChatSender implements MessageSender {

    /**
     * Country code prefixed to every recipient. Hard-coded because this platform sells flats in
     * Pune; the day it does not, this is the line that has to change, and a config key would only
     * have hidden that fact behind indirection.
     */
    private static final String COUNTRY_CODE = "91";

    private final MessageTemplateRepository templates;
    private final OutboundMessageRepository ledger;

    ClickToChatSender(MessageTemplateRepository templates, OutboundMessageRepository ledger) {
        this.templates = templates;
        this.ledger = ledger;
    }

    @Override
    @Transactional
    public Prepared send(MessageRequest request) {
        MessageTemplate template = templates
                .findById(request.templateId())
                .filter(MessageTemplate::isActive)
                .orElseThrow(() -> new BadRequestException(
                        "No active message template called '" + request.templateId() + "'."));

        String body = template.render(request.variables());

        OutboundMessage row = ledger.save(new OutboundMessage(
                request.channel(),
                template.getId(),
                request.subjectType(),
                request.subjectId(),
                request.recipientId(),
                request.recipientMobile(),
                body,
                request.preparedBy()));

        return new Prepared(row.getId(), body, row.getStatus(), link(request.recipientMobile(), body));
    }

    /**
     * Build the click-to-chat URL.
     *
     * <p>Strips everything but digits from the number, because it may arrive spaced, hyphenated or
     * carrying a country code, and {@code wa.me} accepts only digits. A number that survives this
     * with fewer than ten digits is not a mobile — most often it is a <em>masked</em> one that
     * reached here by mistake, where {@code 98XXXXX210} reduces to {@code 98210} and would silently
     * produce a link to nobody. Better to refuse than to open a chat with a stranger.
     */
    private String link(String mobile, String body) {
        String digits = mobile.replaceAll("\\D", "");
        if (digits.length() < 10) {
            throw new BadRequestException("Cannot open a WhatsApp chat: the recipient's mobile is incomplete.");
        }
        String national = digits.length() > 10 ? digits.substring(digits.length() - 10) : digits;
        return "https://wa.me/" + COUNTRY_CODE + national + "?text="
                + URLEncoder.encode(body, StandardCharsets.UTF_8);
    }
}
