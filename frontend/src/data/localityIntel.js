// Shared Pune locality intelligence. Single source of truth for the Locality
// insights page and the Property Location tab. Data is curated/deterministic —
// there is no backend or live POI API in this prototype.

export const LOC = {
  Baner: { price: 11500, yoy: 8.4, rent2: 32000, demand: 'High', launches: 18, age: 5, buyer: 88, subs: { Safety: 8.6, Connectivity: 9.0, Schools: 8.2, Healthcare: 8.5, Lifestyle: 8.8, Greenery: 7.6 }, conn: [['Hinjawadi IT Park', 'cpu', '8 km'], ['Balewadi Sports Complex', 'dumbbell', '3 km'], ['Mumbai–Pune Expressway', 'milestone', '5 km'], ['Metro (upcoming)', 'train-front', '2 km'], ['Symbiosis Campus', 'graduation-cap', '1.5 km']] },
  Wakad: { price: 9200, yoy: 9.1, rent2: 27000, demand: 'Very High', launches: 22, age: 6, buyer: 92, subs: { Safety: 8.2, Connectivity: 8.7, Schools: 8.0, Healthcare: 8.1, Lifestyle: 8.3, Greenery: 7.2 }, conn: [['Hinjawadi IT Park', 'cpu', '5 km'], ['Mumbai–Pune Expressway', 'milestone', '3 km'], ['Wakad Bridge', 'milestone', '1 km'], ['Aundh', 'map-pin', '6 km'], ['Xion Mall', 'shopping-bag', '2 km']] },
  Hinjawadi: { price: 8200, yoy: 10.2, rent2: 24000, demand: 'Very High', launches: 30, age: 5, buyer: 94, subs: { Safety: 7.8, Connectivity: 8.9, Schools: 7.6, Healthcare: 7.5, Lifestyle: 7.9, Greenery: 7.8 }, conn: [['Rajiv Gandhi IT Park', 'cpu', '1 km'], ['Metro (upcoming)', 'train-front', '0.5 km'], ['Wakad', 'map-pin', '5 km'], ['Expressway', 'milestone', '6 km'], ['Blue Ridge Town', 'building', '0.5 km']] },
  'Koregaon Park': { price: 16500, yoy: 6.2, rent2: 55000, demand: 'Moderate', launches: 6, age: 12, buyer: 74, subs: { Safety: 9.0, Connectivity: 9.2, Schools: 8.8, Healthcare: 9.1, Lifestyle: 9.6, Greenery: 8.4 }, conn: [['Pune Airport', 'plane', '6 km'], ['Pune Railway Station', 'train-front', '4 km'], ['MG Road', 'shopping-bag', '3 km'], ['Riverfront', 'waves', '0.5 km'], ['Osho Garden', 'trees', '1 km']] },
  Kothrud: { price: 13000, yoy: 7.0, rent2: 30000, demand: 'High', launches: 10, age: 10, buyer: 82, subs: { Safety: 9.1, Connectivity: 9.0, Schools: 9.2, Healthcare: 8.9, Lifestyle: 8.6, Greenery: 8.2 }, conn: [['Pune University', 'graduation-cap', '6 km'], ['Chandni Chowk', 'milestone', '3 km'], ['Karve Road', 'milestone', '1 km'], ['City Centre', 'building', '7 km'], ['MIT Campus', 'graduation-cap', '2 km']] },
  'Viman Nagar': { price: 12500, yoy: 7.8, rent2: 38000, demand: 'High', launches: 9, age: 9, buyer: 85, subs: { Safety: 8.8, Connectivity: 9.1, Schools: 8.6, Healthcare: 8.7, Lifestyle: 9.0, Greenery: 7.9 }, conn: [['Pune Airport', 'plane', '3 km'], ['Phoenix Marketcity', 'shopping-bag', '1 km'], ['Kharadi', 'map-pin', '5 km'], ['Railway Station', 'train-front', '7 km'], ['Symbiosis', 'graduation-cap', '2 km']] },
  Aundh: { price: 12000, yoy: 7.2, rent2: 34000, demand: 'High', launches: 8, age: 11, buyer: 80, subs: { Safety: 8.9, Connectivity: 8.8, Schools: 8.9, Healthcare: 8.8, Lifestyle: 8.7, Greenery: 8.0 }, conn: [['Pune University', 'graduation-cap', '4 km'], ['Baner', 'map-pin', '4 km'], ['Expressway', 'milestone', '6 km'], ['ITI Road', 'shopping-bag', '0.5 km'], ['Westend Mall', 'shopping-bag', '1.5 km']] },
  Kharadi: { price: 10500, yoy: 9.6, rent2: 33000, demand: 'Very High', launches: 20, age: 6, buyer: 91, subs: { Safety: 8.3, Connectivity: 8.6, Schools: 8.1, Healthcare: 8.4, Lifestyle: 8.5, Greenery: 7.7 }, conn: [['EON IT Park', 'cpu', '1 km'], ['Pune Airport', 'plane', '8 km'], ['Viman Nagar', 'map-pin', '5 km'], ['Magarpatta', 'building', '6 km'], ['Phoenix Mall', 'shopping-bag', '4 km']] },
  Hadapsar: { price: 8800, yoy: 8.0, rent2: 26000, demand: 'High', launches: 14, age: 8, buyer: 84, subs: { Safety: 8.0, Connectivity: 8.4, Schools: 7.9, Healthcare: 8.2, Lifestyle: 8.0, Greenery: 7.4 }, conn: [['Magarpatta City', 'building', '2 km'], ['Amanora Mall', 'shopping-bag', '1 km'], ['Pune Airport', 'plane', '10 km'], ['Solapur Road', 'milestone', '0.5 km'], ['SP Infocity', 'cpu', '3 km']] },
  Wagholi: { price: 6800, yoy: 11.0, rent2: 19000, demand: 'Very High', launches: 26, age: 4, buyer: 90, subs: { Safety: 7.4, Connectivity: 7.8, Schools: 7.3, Healthcare: 7.2, Lifestyle: 7.3, Greenery: 7.6 }, conn: [['Kharadi', 'map-pin', '6 km'], ['Pune Airport', 'plane', '12 km'], ['Nagar Road', 'milestone', '0.5 km'], ['EON IT Park', 'cpu', '7 km'], ['Lulu Mall (upcoming)', 'shopping-bag', '5 km']] },
};

// Major Pune employment hubs used for the property "Commute to work" estimate.
export const IT_HUBS = [
  { name: 'Hinjawadi IT Park', lat: 18.5913, lng: 73.7389 },
  { name: 'Kharadi / EON IT', lat: 18.5515, lng: 73.9430 },
  { name: 'Magarpatta / Hadapsar', lat: 18.5150, lng: 73.9260 },
  { name: 'Baner–Balewadi', lat: 18.5590, lng: 73.7870 },
];
