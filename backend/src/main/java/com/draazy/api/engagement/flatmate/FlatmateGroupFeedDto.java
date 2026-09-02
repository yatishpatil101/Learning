package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Contract schema {@code FlatmateGroupFeed} — the card-sized projection of a group (D211).
 *
 * <p><strong>Why a second shape.</strong> D80 gave rooms one, for the reason that applies just as
 * well here: the public reads render a <em>card</em>, and a card cannot show a field it never
 * reads. {@link FlatmateGroupDto} carries the host's own view — their number, the anti-broker
 * forensics, the moderation verdict — and the two anonymous producers ({@code GET
 * /flatmates/groups} and the group half of {@code GET /flatmates/feed}) were sending all of it to
 * strangers because there was only one shape to send.
 *
 * <p><strong>What is deliberately absent, and why nothing breaks.</strong> Each omission was
 * checked against the real consumers under {@code frontend/src}, excluding the mock providers
 * ({@code lib/data/}, {@code services/providers/mock/}) which never touch the wire. A field counts
 * as "read" only if something <em>downstream</em> of the seam view model consumes it —
 * {@code flatmateMapper.js} copies almost everything through, so its own mention proves nothing:
 *
 * <ul>
 *   <li>{@code ownerMobile} — both producers pass {@code null} for it
 *       ({@code PartyView.anonymous(..)}), so removing the field changes no payload. It turns the
 *       convention into a structural guarantee: an anonymous group read now has nowhere to put a
 *       number.</li>
 *   <li>{@code ownerConsentMobile} — the flat owner's number, masked but still a third party's
 *       contact detail on an unauthenticated wire. The only frontend mention is
 *       {@code flatmateProvider.createGroup}, which reads it off the <em>form</em> to build the
 *       outbound request body; nothing reads it back off a returned row.</li>
 *   <li>{@code addressFingerprint}, {@code flagForReview} — anti-broker forensics the client only
 *       ever writes ({@code list-property/submit.js} and {@code useFlatmateSupply.jsx} compute both
 *       locally at create time). No card, filter or helper reads them off a group. The Ops review
 *       queue keys on its own record from {@code lib/data/flatmates.js}, not on a feed row.</li>
 *   <li>{@code modStatus} — the moderation verdict. Both producers already filter to
 *       {@code modStatus in ('live','approved')}, so the field could only ever say "this one
 *       passed": no information to a stranger, and a slot a future unfiltered producer could leak a
 *       verdict through. Its one derived use at the seam ({@code publiclyVisible}) has no consumer;
 *       {@code AdminFlatmates.jsx} reads {@code modStatus} from the local store, never from here.
 *       The host's own copy still carries it on {@link FlatmateGroupDto}, which is what labels a
 *       group as pending review to the person who wrote it.</li>
 * </ul>
 *
 * <p><strong>{@code ownerConsent} stays</strong>, as the boolean it always was:
 * {@code GroupCard.jsx} renders the owner-consent trust cue from it. Dropping the number while
 * keeping the fact is the whole point — a stranger may know the flat's owner agreed, and may not
 * know how to ring them.
 *
 * <p><strong>{@code reviewStatus} was added, and is the one verdict that belongs on a public
 * card.</strong> It reads oddly next to {@code modStatus} being removed two paragraphs up, so the
 * distinction is worth stating: {@code modStatus} is what we think of the <em>post</em>, and both
 * producers already filter to the ones that passed, so publishing it says nothing and risks a
 * future unfiltered producer leaking a verdict. {@code reviewStatus} is what Ops concluded about
 * the host's <em>claim to the flat</em>, and it is the entire content of the trust badge the card
 * exists to show — "Pending Ops review" withholds the badge, an approval grants it. Withholding it
 * is what made {@code hostVerifiedFor} unable to return true for a tenant-tier host from any
 * machine but the reviewer's. Publishing a pending state is deliberate and not a leak: a badge
 * absent because nobody looked yet and a badge absent because Ops said no are different facts to a
 * seeker deciding whom to message, and the mock board has always drawn them differently.
 *
 * <p>{@link #perHead()} and {@link #seatsOpen()} are derived on read, never stored — see
 * {@link FlatmateGroupDto}.
 */
public record FlatmateGroupFeedDto(
        UUID id,
        String title,
        String locality,
        String policy,
        Long rent,
        Long perHead,
        int seatsTotal,
        int seatsOpen,
        List<FlatmateGroupDto.Member> members,
        UUID propertyId,
        String hostRole,
        String verificationTier,
        boolean agreementDeclared,
        boolean ownerConsent,
        String reviewStatus,
        List<String> tags,
        String note,
        String ownerName,
        Instant createdAt) {
}
