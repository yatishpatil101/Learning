/* Property-type options come from the canonical browse taxonomy so the filter,
   the home search and "Post a property" always offer the same set. */
export { BUY_TYPES, RENT_TYPES, COMMERCIAL_TYPES, PG_SHARING, SHARING_LBL } from '../../../data/propertyTypes.js';
export const FURN = [['furnished', 'Furnished'], ['semi', 'Semi-Furnished'], ['unfurnished', 'Unfurnished']];
export const AMEN_BUY = [['gym', 'Gym'], ['pool', 'Pool'], ['lift', 'Lift'], ['parking', 'Parking'], ['security', 'Security'], ['power', 'Power Backup'], ['garden', 'Garden'], ['club', 'Clubhouse']];
export const AMEN_RENT = [['lift', 'Lift'], ['parking', 'Parking'], ['security', 'Security'], ['power', 'Power Backup'], ['gym', 'Gym'], ['pool', 'Pool']];
export const BHK_BUY = [['1', '1 BHK'], ['2', '2 BHK'], ['3', '3 BHK'], ['4', '4 BHK'], ['5', '5+ BHK']];
export const BHK_RENT = [['0', '1 RK / Room'], ['1', '1 BHK'], ['2', '2 BHK'], ['3', '3 BHK'], ['3plus', '3+ BHK']];
export const TENANTS = [['family', 'Family'], ['bachelor-male', 'Bachelors (Male)'], ['bachelor-female', 'Bachelors (Female)'], ['company', 'Company']];
export const ROOM_TYPES = [['single', 'Single Room (Private)'], ['shared', 'Shared Room']];
export const AVAIL_FROM = [['', 'Anytime'], ['now', 'Immediately'], ['15', 'Within 15 days'], ['30', 'Within 30 days']];
export const AVAIL_BUY = [['', 'All'], ['ready', 'Ready to Move'], ['uc', 'Under Construction']];
export const CONSTR_STATUS = [['ready', 'Ready to Move'], ['under', 'Under Construction'], ['new', 'New Launch']];

/* Land-use / zone options for Open Plot & Farm Land filters — mirrors the
   "Post a property" plotZoneOptions so a land listing is filterable by the same
   zoning the owner declared. */
export const LAND_USE = [['residential', 'Residential'], ['commercial', 'Commercial'], ['industrial', 'Industrial'], ['agricultural', 'Agricultural'], ['mixed', 'Mixed-Use']];
export const LANDUSE_LBL = Object.fromEntries(LAND_USE);

export const AMEN_LBL = Object.fromEntries([...AMEN_BUY, ...AMEN_RENT]);
export const FURN_LBL = Object.fromEntries(FURN);

export const LANDMARKS = [
  { label: 'Any location', value: '', group: '' },
  { label: 'Hinjawadi IT Park', value: '18.5912,73.7389', group: 'IT Parks & Workplaces' },
  { label: 'EON IT Park, Kharadi', value: '18.5515,73.9430', group: 'IT Parks & Workplaces' },
  { label: 'World Trade Center, Kharadi', value: '18.5601,73.9430', group: 'IT Parks & Workplaces' },
  { label: 'Magarpatta City, Hadapsar', value: '18.5159,73.9290', group: 'IT Parks & Workplaces' },
  { label: 'Commerzone, Yerwada', value: '18.5560,73.8770', group: 'IT Parks & Workplaces' },
  { label: 'SP Infocity, Phursungi', value: '18.4790,73.9430', group: 'IT Parks & Workplaces' },
  { label: 'Savitribai Phule Pune University', value: '18.5535,73.8254', group: 'Colleges & Universities' },
  { label: 'COEP Technological University', value: '18.5295,73.8567', group: 'Colleges & Universities' },
  { label: 'Symbiosis, Viman Nagar', value: '18.5680,73.9140', group: 'Colleges & Universities' },
  { label: 'MIT-WPU, Kothrud', value: '18.4970,73.8120', group: 'Colleges & Universities' },
  { label: 'Fergusson College', value: '18.5230,73.8410', group: 'Colleges & Universities' },
  { label: 'VIT Pune, Bibwewadi', value: '18.4640,73.8680', group: 'Colleges & Universities' },
  { label: 'Pune Railway Station', value: '18.5286,73.8743', group: 'Landmarks & Transit' },
  { label: 'Pune Airport', value: '18.5793,73.9089', group: 'Landmarks & Transit' },
  { label: 'Shivajinagar', value: '18.5308,73.8470', group: 'Landmarks & Transit' },
  { label: 'Swargate', value: '18.5010,73.8580', group: 'Landmarks & Transit' },
  { label: 'Phoenix Marketcity', value: '18.5620,73.9170', group: 'Landmarks & Transit' },
];

export const LOC_COORDS = {
  baner: [18.559, 73.787], wakad: [18.609, 73.762], hinjawadi: [18.591, 73.739], kothrud: [18.508, 73.821],
  koregaon: [18.538, 73.893], viman: [18.566, 73.914], hadapsar: [18.508, 73.927], wagholi: [18.578, 73.989],
  magarpatta: [18.518, 73.927], bavdhan: [18.522, 73.782], kalyani: [18.548, 73.903],
};
