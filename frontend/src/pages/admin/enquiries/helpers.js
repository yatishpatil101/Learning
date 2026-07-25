import { mutateDb } from '../../../lib/mockApi.js';

function updateCollection(col, id, patch) {
  return mutateDb((db) => {
    const item = (db[col] || []).find((x) => x.id === id);
    if (item) Object.assign(item, patch);
  });
}

export { updateCollection };
