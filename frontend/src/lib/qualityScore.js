/**
 * Global Listing Quality Score — visible to owners, buyers, and admin.
 * Scores 0–100 with separate weightage for rent and buy flows.
 *
 * RENT scoring (100 pts):
 *   Photos (25): 0=0, 1=8, 2=16, 3+=25
 *   Description (15): <50=3, <100=8, <200=12, 200+=15
 *   Verification (20): ownerVerified=10, aadhaarVerified=10
 *   Completeness (25): furnishing=5, facing=5, floor=5, age=5, availableFrom/deposit=5
 *   Amenities (15): 0=0, 1-2=5, 3-4=10, 5+=15
 *
 * BUY scoring (100 pts):
 *   Photos (25): 0=0, 1=8, 2=16, 3+=25
 *   Description (15): <50=3, <100=8, <200=12, 200+=15
 *   Documents (20): ownershipVerified=10, docsCount>=3=10, docsCount>=1=5
 *   Completeness (25): furnishing=4, facing=4, floor=4, age=4, area=4, possession=5
 *   Amenities (15): 0=0, 1-2=5, 3-4=10, 5+=15
 */

export function computeQualityScore(l) {
  const isRent = l.deal === 'rent';
  let score = 0;

  // Photos (25 pts)
  const photoCount = (l.gallery && l.gallery.length) || (l.image ? 1 : 0);
  if (photoCount >= 3) score += 25;
  else if (photoCount === 2) score += 16;
  else if (photoCount === 1) score += 8;

  // Description (15 pts)
  const descLen = (l.description || '').length;
  if (descLen >= 200) score += 15;
  else if (descLen >= 100) score += 12;
  else if (descLen >= 50) score += 8;
  else if (descLen > 0) score += 3;

  // Verification / Documents (20 pts)
  if (isRent) {
    if (l.ownerVerified) score += 10;
    if (l.aadhaarVerified) score += 10;
  } else {
    if (l.ownershipVerified) score += 10;
    if (l.docsCount >= 3) score += 10;
    else if (l.docsCount >= 1) score += 5;
  }

  // Completeness (25 pts)
  if (isRent) {
    if (l.furnishing && l.furnishing !== 'unfurnished') score += 5;
    else if (l.furnishing) score += 3;
    if (l.facing) score += 5;
    if (l.floor) score += 5;
    if (l.age) score += 5;
    if (l.deposit || l.availableFrom) score += 5;
  } else {
    if (l.furnishing && l.furnishing !== 'unfurnished') score += 4;
    else if (l.furnishing) score += 2;
    if (l.facing) score += 4;
    if (l.floor) score += 4;
    if (l.age) score += 4;
    if (l.area) score += 4;
    if (l.construction || l.possession) score += 5;
  }

  // Amenities (15 pts)
  const amenityCount = (l.amenities && l.amenities.length) || 0;
  if (amenityCount >= 5) score += 15;
  else if (amenityCount >= 3) score += 10;
  else if (amenityCount >= 1) score += 5;

  return Math.min(score, 100);
}

export function qualityLabel(score) {
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

export function qualityColor(score) {
  if (score >= 80) return { ring: 'text-emerald-400', bg: 'bg-emerald-500/15', text: 'text-emerald-300', label: 'Excellent' };
  if (score >= 50) return { ring: 'text-amber-400', bg: 'bg-amber-500/15', text: 'text-amber-300', label: 'Good' };
  return { ring: 'text-rose-400', bg: 'bg-rose-500/15', text: 'text-rose-300', label: 'Needs work' };
}

/**
 * Returns a breakdown of what's missing for the owner to improve their score.
 */
export function qualityTips(l) {
  const tips = [];
  const photoCount = (l.gallery && l.gallery.length) || (l.image ? 1 : 0);
  if (photoCount < 3) tips.push('Add more photos (3+ recommended)');
  if ((l.description || '').length < 100) tips.push('Write a detailed description (100+ chars)');
  if (!l.ownerVerified && !l.ownershipVerified) tips.push('Complete verification for trust badge');
  if (!(l.amenities && l.amenities.length >= 3)) tips.push('Add amenities to attract more views');
  if (!l.facing) tips.push('Add facing direction');
  if (!l.floor) tips.push('Specify floor number');
  return tips;
}
