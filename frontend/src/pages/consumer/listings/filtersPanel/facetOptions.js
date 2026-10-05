import { facingOptions, naStatusOptions } from '../../list-property/constants.js';

const optionKey = (label) => String(label).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const FACING = facingOptions.map((label) => [optionKey(label), `listings.facing${label.replace(/\s+/g, '')}`]);
export const BATHS = [['1', 'listings.baths1'], ['2', 'listings.baths2'], ['3', 'listings.baths3'], ['4', 'listings.baths4']];
export const SHELL = [['bareShell', 'listings.shellBare'], ['warmShell', 'listings.shellWarm'], ['furnished', 'listings.shellFurnished']];
export const NA_STATUS = naStatusOptions.map(({ value }) => [value, `listings.na${value[0].toUpperCase()}${value.slice(1)}`]);
export const FOOD = [['veg', 'listings.foodVegOnly'], ['jain', 'listings.foodJainOnly'], ['nonveg', 'listings.nonVegOk']];
