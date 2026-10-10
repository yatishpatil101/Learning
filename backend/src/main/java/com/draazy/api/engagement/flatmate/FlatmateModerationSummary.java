package com.draazy.api.engagement.flatmate;

/** Cards waiting on each tab of the moderation desk, counted by the server rather than by the
 * length of whatever window the browser happened to download. */
public record FlatmateModerationSummary(long pending, long published, long hidden) {
}