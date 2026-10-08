import { fmtNum } from '../../../lib/format.js';
import { titleCase } from './constants.js';

/* A whole template per case, with only the descriptor interpolated: Hindi and Marathi put the
   builder and locality in different positions, so a sentence glued from fragments cannot translate. */
function buildAbout(soc, locName, t) {
  if (soc._thin) return t('society.aboutThin', { name: soc.name, locality: locName });

  // Only assert specifics we actually hold — never invent size/utilities/occupancy.
  const descriptor = [
    soc.towers ? t('society.descTower', { count: soc.towers }) : null,
    soc.units ? t('society.descHome', { count: fmtNum(soc.units) }) : null,
    soc.rera ? t('society.descRera') : null,
  ].filter(Boolean).join(', ');
  const descArg = descriptor ? `${descriptor} ` : '';

  const sentences = [
    soc.builder
      ? t('society.aboutIntroBuilder', { name: soc.name, descriptor: descArg, builder: soc.builder, locality: locName })
      : t('society.aboutIntro', { name: soc.name, descriptor: descArg, locality: locName }),
  ];
  if (soc.year) {
    sentences.push(soc.occupancy
      ? t('society.aboutBuiltOccupancy', { year: soc.year, percent: soc.occupancy })
      : t('society.aboutBuilt', { year: soc.year }));
  }
  sentences.push(t('society.aboutBrokerFree'));
  return sentences.join(' ');
}

/* Placeholder for a slug that is not in the catalogue, reachable from shared links and
   merged-away societies. Every unknown field stays absent so `_thin` renders the honest state. */
function genericSociety(slug, name, locName) {
  return {
    id: 'G:' + slug, slug, name: name || titleCase(slug), localitySlug: slug,
    registration: false, conveyance: false, amenities: [],
    _generic: true, _thin: true, _locName: locName,
  };
}

export { buildAbout, genericSociety };
