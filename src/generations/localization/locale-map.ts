import { Faker, fakerES, fakerES_MX, fakerEN } from '@faker-js/faker';

export type SupportedRegion =
  | 'BOLIVIA'
  | 'ARGENTINA'
  | 'CHILE'
  | 'COLOMBIA'
  | 'MEXICO'
  | 'ESPAÑA'
  | 'USA'
  | 'GENERIC';

export type PlanLanguage = 'es' | 'en';

export const fakerMap: Record<SupportedRegion, Faker> = {
  ARGENTINA: fakerES,
  BOLIVIA: fakerES,
  CHILE: fakerES,
  COLOMBIA: fakerES,
  MEXICO: fakerES_MX,
  ESPAÑA: fakerES,
  USA: fakerEN,
  GENERIC: fakerES,
};

/** Regiones cuyo idioma de datos es inglés. */
const ENGLISH_REGIONS = new Set<SupportedRegion>(['USA']);

export function isEnglishRegion(regionName?: string): boolean {
  return ENGLISH_REGIONS.has((regionName || '').toUpperCase() as SupportedRegion);
}

export function languageForRegion(regionName?: string): PlanLanguage {
  return isEnglishRegion(regionName) ? 'en' : 'es';
}

export const bolivianCities = [
  'Santa Cruz de la Sierra',
  'La Paz',
  'Cochabamba',
  'Sucre',
  'Oruro',
  'Potosí',
  'Tarija',
  'Trinidad',
  'Cobija',
  'Montero',
  'Warnes',
  'El Alto',
  'Quillacollo',
  'Sacaba',
  'Yacuiba',
  'Riberalta',
];

export function getFakerInstance(region?: string): {
  faker: Faker;
  regionName: SupportedRegion;
  language: PlanLanguage;
} {
  const normalizedRegion = (region || '').toUpperCase().trim();

  const resolve = (regionName: SupportedRegion) => ({
    faker: fakerMap[regionName],
    regionName,
    language: languageForRegion(regionName),
  });

  if (normalizedRegion === 'BOLIVIA') return resolve('BOLIVIA');
  if (normalizedRegion === 'ARGENTINA') return resolve('ARGENTINA');
  if (normalizedRegion === 'CHILE') return resolve('CHILE');
  if (normalizedRegion === 'COLOMBIA') return resolve('COLOMBIA');
  if (normalizedRegion === 'MEXICO' || normalizedRegion === 'MÉXICO')
    return resolve('MEXICO');
  if (normalizedRegion === 'ESPAÑA' || normalizedRegion === 'ESPANA')
    return resolve('ESPAÑA');
  if (
    normalizedRegion === 'USA' ||
    normalizedRegion === 'EEUU' ||
    normalizedRegion === 'ENGLISH' ||
    normalizedRegion === 'INGLES' ||
    normalizedRegion === 'INGLÉS' ||
    normalizedRegion === 'EN'
  )
    return resolve('USA');

  return resolve('GENERIC');
}
