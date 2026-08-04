package com.punenest.api.leads.society;

import java.time.Instant;
import java.util.UUID;

/**
 * Contract schema {@code SocietyLead}.
 *
 * <p><strong>The mobile is not masked, and that is the one deliberate difference from every other
 * surface that carries a phone number.</strong> Elsewhere a number belongs to a consumer who gave
 * it in order to sign in, and showing it to staff is a privacy decision the platform has to justify
 * (see {@code UserAdminService}). Here the number was typed into a form whose entire purpose is
 * "call me about my building" — masking it would leave ops with a lead they cannot work, which is
 * the same as not capturing the lead. It is still staff-and-admin only, and the list is paged
 * rather than exportable in one request (S57).
 *
 * @param note the ops working note, visible only on this staff-only surface
 */
public record SocietyLeadDto(
        UUID id,
        String societyName,
        String contactName,
        String mobile,
        Integer units,
        String interest,
        String status,
        String note,
        Instant createdAt) {

    static SocietyLeadDto from(SocietyLead lead) {
        return new SocietyLeadDto(lead.getId(), lead.getSocietyName(), lead.getContactName(),
                lead.getMobile(), lead.getUnits(), lead.getInterest(), lead.getStatus(),
                lead.getNote(), lead.getCreatedAt());
    }
}
