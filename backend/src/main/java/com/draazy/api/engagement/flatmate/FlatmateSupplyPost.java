package com.draazy.api.engagement.flatmate;

/** The trust columns a room and a group share, so {@link FlatmatePublication#reapplyAfterEdit} can
 * settle both from one object. A seeker post has no address or host tier, so it does not implement. */
interface FlatmateSupplyPost {

    String getModStatus();

    void setModStatus(String modStatus);

    void setAddressFingerprint(String addressFingerprint);

    void setFlagForReview(boolean flagForReview);

    ModerationRecheck getRecheck();
}
