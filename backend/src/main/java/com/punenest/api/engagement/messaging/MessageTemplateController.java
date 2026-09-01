package com.punenest.api.engagement.messaging;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.Roles;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The outreach template library.
 *
 * <p>Read-only over HTTP. Editing exists as a deliberate gap rather than an oversight: the wording
 * of these messages is the platform speaking in its own name to people who did not ask to be
 * contacted, and an authoring screen would make that a thing any staff account could rewrite
 * unreviewed. Changing the copy is a migration, which is a change with a reviewer and a history.
 *
 * <p>Guarded on role alone, with no permission atom. The catalogue is copy — it names no owner,
 * carries no listing and discloses nothing about anybody. Minting an atom to protect it would put a
 * checkbox in front of an administrator implying there was a reason to withhold it.
 */
@RestController
public class MessageTemplateController {

    private static final String STAFF_OR_ADMIN = "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    private final MessageTemplateRepository templates;

    MessageTemplateController(MessageTemplateRepository templates) {
        this.templates = templates;
    }

    /**
     * The active templates for one channel.
     *
     * <p>Not paged. There are ten, they are picked from a dropdown, and a page boundary through a
     * list somebody is scanning by eye would hide the one they wanted behind a control the panel
     * does not draw.
     */
    @GetMapping(Routes.Admin.MESSAGE_TEMPLATES)
    @PreAuthorize(STAFF_OR_ADMIN)
    public List<MessageTemplateDto> list(@RequestParam(defaultValue = "whatsapp") String channel) {
        return templates.findByChannelAndActiveTrueOrderByCategoryAscNameAsc(channel).stream()
                .map(MessageTemplateDto::of)
                .toList();
    }
}
