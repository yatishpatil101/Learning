// Imported directly rather than through `config.js`: the server's document is the only access
// model, and a client-side union could only widen it. Every export is still async.
export {
  getFunctionCatalogue,
  getMemberPermissions,
  saveMemberFunctions,
} from './providers/http/permissionsProvider.js';
