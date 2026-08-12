package com.punenest.api.moderation.conversation;

/**
 * Contract schema {@code ModeratedParticipant} — one side of a moderated thread.
 *
 * <p>Both participants are named absolutely, not "you and the counterparty". The participant-facing
 * {@code Conversation} shape is reader-relative — its {@code counterpartyName} means "the other one"
 * and is only meaningful because the reader is in the thread. A moderator is in neither side of it,
 * so reusing that shape here would have forced a choice of which participant to call the
 * counterparty, and every such choice is wrong. This is the reason D53 got its own DTO rather than
 * a flag on the existing one.
 *
 * <p>No mobile number. The participant read masks or reveals one according to the contact gate; a
 * moderator has not passed that gate and reading a reported chat is not a reason to hand over both
 * parties' phone numbers. The ids are here, and {@code users:read} is the atom for going further.
 *
 * @param id   the user id — the field to correlate with the report and with the message authors
 * @param name display name, {@code null} if the account has none or has since been erased
 * @param role the account's role now, not at write time (per-message roles are on the messages)
 */
public record ModeratedParticipantDto(String id, String name, String role) {
}
