package com.draazy.api.services.request;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.persistence.AttributeConverter;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * The {@code service_requests.status} vocabulary and the state machine over it. Mirrors the V7
 * CHECK, which is the real enforcement.
 *
 * <p><strong>Why this list and not the frontend's.</strong> {@code docs/flows/ops/service-queues.md}
 * documents a different set of statuses ({@code submitted}, {@code docs_review},
 * {@code changes_requested}, {@code registration}) because the React prototype invented its own in
 * {@code localStorage}. The contract and the table are the source of truth, and most of the
 * prototype's extras map cleanly onto them: {@code registration} is the window between
 * {@code approved} and the final document landing — a state with no decision in it, and therefore
 * not a state.
 *
 * <p><strong>{@code changes_requested} was the exception, and this class used to say otherwise
 * (D121).</strong> It was mapped to {@code draft-shared → in-progress} on the reasoning that the
 * draft had come back so ops was working again. That is true and it is not sufficient: a request
 * that has <em>never</em> had a draft rejected sits in {@code in-progress} too, so after the
 * collapse the read shape could not distinguish "we are drafting" from "you turned our draft down".
 * The rejection survived only in {@code audit_log}, which is not a place a customer or an operator
 * looks — so from every surface either of them can see, a rejection was unrecoverable. {@link
 * #CHANGES_REQUESTED} is that missing state, and V75 widened the CHECK to accept it.
 *
 * <p><strong>An enum, not a constant holder (D11).</strong> This was the first vocabulary promoted,
 * because it is the one where the string cost the most: nine values, four of them hyphenated, and a
 * nine-edge transition map that was keyed by {@code String} and so could not be checked by anything
 * but a test. The Java constant name and the wire value are deliberately <em>not</em> derived from
 * one another — {@link #wire()} is the only mapping, {@link Converter} is the only thing that writes
 * it to a column, and {@code @JsonValue} is the only thing that writes it to the wire. A hyphenated
 * value therefore cannot be reached by {@link #name()} escaping into either.
 */
public enum ServiceRequestStatus {

    /**
     * Filed and priced, but not yet paid for. The starting state of a rent-agreement request, and
     * invisible to the ops queue until the payment webhook moves it on. A free service desk skips
     * this and starts at {@link #NEW}.
     */
    AWAITING_PAYMENT("awaiting-payment"),

    /** Filed, nobody has picked it up. */
    NEW("new"),

    /** A staff member owns it. */
    ASSIGNED("assigned"),

    /** Work is happening. */
    IN_PROGRESS("in-progress"),

    /** The maker has put a deliverable in front of the customer. */
    DRAFT_SHARED("draft-shared"),

    /**
     * The checker said no, and the draft is back with ops carrying a reason (D121).
     *
     * <p>Hyphenated to match its neighbours rather than the prototype's {@code changes_requested};
     * the wire vocabulary on this column has been {@code awaiting-payment} / {@code in-progress} /
     * {@code draft-shared} since V7 and one underscore in the middle of it would be a wart every
     * client has to remember.
     *
     * <p>Not reachable from {@code PATCH /{id}/status} — see {@link #isStaffSettable()}. Only the
     * customer's rejection puts a request here, which is the whole reason the state carries
     * information the others do not.
     */
    CHANGES_REQUESTED("changes-requested"),

    /** The checker said yes. Only the customer can cause this. */
    APPROVED("approved"),

    /** The registered copy is in. Terminal. */
    COMPLETED("completed"),

    /** Terminal. */
    CANCELLED("cancelled");

    private final String wire;

    ServiceRequestStatus(String wire) {
        this.wire = wire;
    }

    /**
     * The value on the column and on the wire. The <em>only</em> string form of this status:
     * {@link #name()} is a Java identifier and four of these differ from it.
     */
    @JsonValue
    public String wire() {
        return wire;
    }

    /**
     * The wire form, so a status interpolated into an error message or a log line reads
     * {@code awaiting-payment} rather than {@code AWAITING_PAYMENT}. Several of those messages are
     * shown to customers, and they said the wire word before this was an enum.
     */
    @Override
    public String toString() {
        return wire;
    }

    private static final Map<String, ServiceRequestStatus> BY_WIRE = byWire();

    private static Map<String, ServiceRequestStatus> byWire() {
        Map<String, ServiceRequestStatus> index = new HashMap<>();
        for (ServiceRequestStatus status : values()) {
            index.put(status.wire, status);
        }
        return Map.copyOf(index);
    }

    /**
     * The status with this wire value.
     *
     * <p>Throws rather than returning {@code null} or a default: this is what Jackson and
     * {@link Converter} both go through, and a row or a payload carrying a value the V7 CHECK should
     * have rejected is a bug to surface, not one to paper over with {@code new}.
     *
     * @throws IllegalArgumentException if no status carries this wire value
     */
    @JsonCreator
    public static ServiceRequestStatus fromWire(String wire) {
        ServiceRequestStatus status = BY_WIRE.get(wire);
        if (status == null) {
            throw new IllegalArgumentException("Unknown service request status: " + wire);
        }
        return status;
    }

    /**
     * The status with this wire value, or empty. For the two places a caller supplies the string —
     * {@code ?status=} and the {@code PATCH /{id}/status} body — where an unknown value is the
     * caller's mistake and owes them a 400, not a 500.
     */
    public static Optional<ServiceRequestStatus> parse(String wire) {
        return Optional.ofNullable(BY_WIRE.get(wire));
    }

    /**
     * The legal moves.
     *
     * <p>{@code draft-shared → draft-shared} is intentional: a revised draft after the customer
     * asked for changes is the same move made twice, not a special case.
     *
     * <p>{@link #CHANGES_REQUESTED} leaves to {@code draft-shared} (ops revised and re-shared
     * without needing an intermediate step), to {@code in-progress} or {@code assigned} (the change
     * is bigger than a re-upload, or the matter is being handed to somebody else), and to
     * {@code cancelled}. It cannot return to {@code draft-shared} <em>and</em> stay a record of the
     * rejection at the same time — that is what the timeline entry and the customer's message are
     * for, and they are why the status is allowed to move on at all.
     *
     * <p>{@code draft-shared → in-progress} is kept alongside the new edge. The customer's
     * rejection no longer uses it, but ops pulling a shared draft back to work on it is a different
     * act by a different person, and removing the move would have turned a status correction into a
     * 409.
     *
     * <p>{@link Map#of} tops out at ten pairs and this is now nine. A tenth status needs
     * {@code Map.ofEntries}, and is a good moment to ask whether it is really a state.
     */
    private static final Map<ServiceRequestStatus, Set<ServiceRequestStatus>> ALLOWED = Map.of(
            AWAITING_PAYMENT, Set.of(NEW, CANCELLED),
            NEW, Set.of(ASSIGNED, IN_PROGRESS, CANCELLED),
            ASSIGNED, Set.of(IN_PROGRESS, DRAFT_SHARED, CANCELLED),
            IN_PROGRESS, Set.of(ASSIGNED, DRAFT_SHARED, CANCELLED),
            DRAFT_SHARED, Set.of(APPROVED, CHANGES_REQUESTED, IN_PROGRESS, DRAFT_SHARED, CANCELLED),
            CHANGES_REQUESTED, Set.of(ASSIGNED, IN_PROGRESS, DRAFT_SHARED, CANCELLED),
            APPROVED, Set.of(COMPLETED, CANCELLED),
            COMPLETED, Set.of(),
            CANCELLED, Set.of());

    /**
     * What {@code PATCH /service-requests/{id}/status} may set.
     *
     * <p>Four statuses are deliberately absent: {@code draft-shared} is earned by actually
     * uploading a draft, {@code approved} and {@code changes-requested} by the customer deciding,
     * and {@code completed} by the final document landing. A status endpoint that could set them
     * would let a staff member mark a job approved and finished without ever producing the document
     * — the maker-checker defeated by a free-text field. {@code changes-requested} belongs in that
     * list for the mirror-image reason: an operator who could set it would be able to manufacture
     * evidence that the customer had asked for something.
     */
    private static final Set<ServiceRequestStatus> STAFF_SETTABLE =
            Set.of(ASSIGNED, IN_PROGRESS, CANCELLED);

    public boolean canTransitionTo(ServiceRequestStatus target) {
        return ALLOWED.getOrDefault(this, Set.of()).contains(target);
    }

    public boolean isStaffSettable() {
        return STAFF_SETTABLE.contains(this);
    }

    /** Terminal states accept no further work of any kind — no draft, no message, no document. */
    public boolean isTerminal() {
        return this == COMPLETED || this == CANCELLED;
    }

    /**
     * Column ↔ enum, named explicitly on {@link ServiceRequest#getStatus()} rather than auto-applied.
     *
     * <p>This exists because {@code @Enumerated(EnumType.STRING)} would write {@link #name()} —
     * {@code AWAITING_PAYMENT}, {@code IN_PROGRESS}, {@code DRAFT_SHARED},
     * {@code CHANGES_REQUESTED} — and the V7 CHECK would reject every one of them. It goes through
     * {@link #wire()} and {@link #fromWire} so there is exactly one mapping in the process.
     */
    public static final class Converter implements AttributeConverter<ServiceRequestStatus, String> {

        @Override
        public String convertToDatabaseColumn(ServiceRequestStatus status) {
            return status == null ? null : status.wire;
        }

        @Override
        public ServiceRequestStatus convertToEntityAttribute(String column) {
            return column == null ? null : fromWire(column);
        }
    }
}
