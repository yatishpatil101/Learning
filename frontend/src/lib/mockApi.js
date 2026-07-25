/* PuneNest mock API — barrel.
   The single swap-point for a future real backend. The implementation is split into
   cohesive domain modules under ./mockApi/; this file re-exports the exact same public
   API so every existing `import { … } from '../lib/mockApi.js'` keeps working unchanged.
   Importing this module also evaluates ./mockApi/core.js, running the one-time
   localStorage seed/hydration side effects. */

// Core: only the PUBLIC primitives are re-exported (rawLoad/rawSave/delay/KEY/
// currentStaffInfo stay internal to the mockApi/ tree).
export {
  resetDb,
  rawDb,
  saveDb,
  mutateDb,
  archiveRecord,
  restoreRecord,
} from './mockApi/core.js';

export * from './mockApi/properties.js';
export * from './mockApi/whatsappTemplates.js';
export * from './mockApi/ownerComms.js';
export * from './mockApi/demand.js';
export * from './mockApi/users.js';
export * from './mockApi/team.js';
export * from './mockApi/tickets.js';
export * from './mockApi/collections.js';
export * from './mockApi/audit.js';
export * from './mockApi/staff.js';
