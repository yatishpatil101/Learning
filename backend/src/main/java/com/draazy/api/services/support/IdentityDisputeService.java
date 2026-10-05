package com.draazy.api.services.support;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ErrorCodes;
import com.draazy.api.identity.verification.IdentityConflict;
import com.draazy.api.identity.verification.IdentityConflictService;
import com.draazy.api.security.AuthPrincipal;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IdentityDisputeService {

    private static final List<Pattern> SENSITIVE_NUMBERS = List.of(
            Pattern.compile("(?i)(?:\\d[\\s-]?){8,}"),
            Pattern.compile("(?i)\\b[a-z]{5}[\\s-]?\\d{4}[\\s-]?[a-z]\\b"),
            Pattern.compile("(?i)\\b[a-z][\\s-]?\\d{7}\\b"),
            Pattern.compile("(?i)\\b[a-z]{3}[\\s-]?\\d{7}\\b"));

    private final IdentityConflictService conflicts;
    private final SupportTicketService supportTickets;
    private final SupportTicketRepository supportTicketRepository;
    private final AuditService audit;

    public IdentityDisputeService(IdentityConflictService conflicts, SupportTicketService supportTickets,
            SupportTicketRepository supportTicketRepository, AuditService audit) {
        this.conflicts = conflicts;
        this.supportTickets = supportTickets;
        this.supportTicketRepository = supportTicketRepository;
        this.audit = audit;
    }

    @Transactional
    public IdentityDisputeResponse open(AuthPrincipal actor, IdentityDisputeRequest body) {
        String note = cleanNote(body == null ? null : body.note());
        IdentityConflict conflict = conflicts.latestRecent(actor.userId()).orElseThrow(() -> new ConflictException(ErrorCodes.IDENTITY_NO_RECENT_CONFLICT,
                        "No recent identity conflict is available to dispute"));
        if (hasOpenIdentityDispute(actor.userId())) {
            throw new ConflictException(ErrorCodes.IDENTITY_DISPUTE_OPEN,
                    "An identity dispute is already open");
        }
        SupportTicketDto ticket;
        try {
            ticket = supportTickets.create(actor, new SupportTicketCreate(
                    "Identity document already in use", "identity_dispute", visibleBody(note)));
        } catch (DataIntegrityViolationException e) {
            throw new ConflictException(ErrorCodes.IDENTITY_DISPUTE_OPEN,
                    "An identity dispute is already open");
        }
        audit.record(actor, "identity.dispute.opened", "support_ticket", ticket.id(),
                "holderVerificationId", String.valueOf(conflict.getHolderVerificationId()),
                "docType", conflict.getDocType());
        return new IdentityDisputeResponse(ticket.id());
    }

    private boolean hasOpenIdentityDispute(UUID userId) {
        return supportTicketRepository.findByUserIdOrderByCreatedAtDesc(userId).stream().anyMatch(ticket -> "identity_dispute".equals(ticket.getCategory())
                        && !SupportTicketStatuses.CLOSED.equals(ticket.getStatus())
                        && !SupportTicketStatuses.RESOLVED.equals(ticket.getStatus()));
    }

    private static String visibleBody(String note) {
        String body = "I need help because my identity document is already in use.";
        return note == null ? body : body + "\n\nNote: " + note;
    }

    private static String cleanNote(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String note = raw.trim();
        if (note.length() > 500) {
            throw new BadRequestException("note must be at most 500 characters");
        }
        for (Pattern pattern : SENSITIVE_NUMBERS) {
            note = pattern.matcher(note).replaceAll("[redacted]");
        }
        return note;
    }
}
