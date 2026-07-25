import { AMEN_LBL } from '../../pages/consumer/listings/constants.js';

// Possession label from the seed's `construction` field.
export const POSSESSION = { ready: 'Ready to move', under: 'Under constr.', new: 'New launch' };

// Icon per amenity key; labels reuse AMEN_LBL with a fallback for keys it lacks.
export const AMEN_ICON = { gym: 'dumbbell', pool: 'waves', lift: 'move-vertical', parking: 'parking-circle', security: 'shield-check', power: 'zap', garden: 'trees', club: 'users', play: 'party-popper' };
const AMEN_EXTRA = { play: 'Play Area' };
export const amenLabel = (k) => AMEN_LBL[k] ?? AMEN_EXTRA[k] ?? k;
