/* PuneNest mock API — barrel.
   The single swap-point for a future real backend. The implementation is split into
   cohesive domain modules under ./mockApi/; this file re-exports the exact same public
   API so every existing `import { … } from '../lib/mockApi.js'` keeps working unchanged.
   Importing this module also evaluates ./mockApi/core.js, running the one-time
   localStorage seed/hydration side effects. */

// Core: only the PUBLIC primitives are re-exported (rawLoad/rawSave/delay/KEY/
// currentStaffInfo stay internal to the mockApi/ tree).
export {
  ensureMockDb,
  rawDb,
  saveDb,
  mutateDb,
  archiveRecord,
  restoreRecord,
} from './mockApi/core.js';
/* `resetDb` was exported here. Nothing imported it — not a page, not a provider, not a spec, not a
   dev tool — and the e2e suites reset state through the server or through `localStorage.clear()`,
   neither of which goes near it. Deleted with its definition; see `core.js` for the note it left
   behind in the migration comment. */

export * from './mockApi/properties.js';
export * from './mockApi/whatsappTemplates.js';
/* `ownerComms.js` was here. It assembled a listing's communication timeline, and five of its seven
   event categories were booleans rendered at arithmetic offsets from `createdAt` -- "claim link
   sent" an hour after creation, "photos uploaded" a day and a half after -- times nobody observed,
   printed as history on the screen used to decide whether an owner has been chased recently
   enough. Its one real source, the outbound-message ledger, now comes from the server through
   `outreachService`, so the module had no callers and no honest content left. Deleted rather than
   left dead, because the next person to want a timeline should find the ledger, not this. */
export * from './mockApi/demand.js';
export * from './mockApi/users.js';
export * from './mockApi/team.js';
export * from './mockApi/tickets.js';
export * from './mockApi/collections.js';
export * from './mockApi/audit.js';
export * from './mockApi/staff.js';
