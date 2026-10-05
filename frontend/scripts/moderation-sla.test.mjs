import assert from 'node:assert/strict';
import {
  MODERATION_SLA_AMBER_HOURS,
  MODERATION_SLA_HOURS,
  MODERATION_SLA_OVERDUE_HOURS,
  MODERATION_SLA_RED_HOURS,
  moderationSlaState,
} from '../src/lib/moderationSla.js';

assert.equal(MODERATION_SLA_HOURS, 24);
assert.equal(MODERATION_SLA_AMBER_HOURS, 12);
assert.equal(MODERATION_SLA_RED_HOURS, 20);
assert.equal(MODERATION_SLA_OVERDUE_HOURS, 24);

const base = Date.parse('2026-09-28T00:00:00.000Z');
const at = (hours) => base + hours * 3600000;

assert.deepEqual(
  moderationSlaState({ createdAt: new Date(base).toISOString(), status: 'needs_info' }, at(30)),
  { paused: true, label: 'Waiting on owner', tone: 'neutral', hoursElapsed: null },
);

assert.equal(moderationSlaState({ createdAt: new Date(base).toISOString(), status: 'pending' }, at(11)).tone, 'green');
assert.equal(moderationSlaState({ createdAt: new Date(base).toISOString(), status: 'pending' }, at(12)).tone, 'amber');
assert.equal(moderationSlaState({ createdAt: new Date(base).toISOString(), status: 'pending' }, at(20)).tone, 'red');
assert.equal(moderationSlaState({ createdAt: new Date(base).toISOString(), status: 'pending' }, at(24)).label, 'overdue');
