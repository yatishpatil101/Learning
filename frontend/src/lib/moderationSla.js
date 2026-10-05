export const MODERATION_SLA_HOURS = 24;
export const MODERATION_SLA_AMBER_HOURS = 12;
export const MODERATION_SLA_RED_HOURS = 20;
export const MODERATION_SLA_OVERDUE_HOURS = 24;

export function moderationSlaState({ createdAt, submittedAt, status } = {}, now = Date.now()) {
  if (status === 'needs_info') {
    return { paused: true, label: 'Waiting on owner', tone: 'neutral', hoursElapsed: null };
  }
  const started = new Date(submittedAt || createdAt || 0).getTime();
  const hoursElapsed = Number.isFinite(started) && started > 0 ? Math.max(0, (now - started) / 3600000) : null;
  if (hoursElapsed == null) return { paused: false, label: 'No SLA timestamp', tone: 'neutral', hoursElapsed };
  if (hoursElapsed >= MODERATION_SLA_OVERDUE_HOURS) return { paused: false, label: 'overdue', tone: 'red', hoursElapsed };
  if (hoursElapsed >= MODERATION_SLA_RED_HOURS) return { paused: false, label: 'due soon', tone: 'red', hoursElapsed };
  if (hoursElapsed >= MODERATION_SLA_AMBER_HOURS) return { paused: false, label: 'due today', tone: 'amber', hoursElapsed };
  return { paused: false, label: `${Math.max(1, Math.ceil(MODERATION_SLA_HOURS - hoursElapsed))}h left`, tone: 'green', hoursElapsed };
}
