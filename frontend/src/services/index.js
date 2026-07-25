/**
 * Service layer barrel export.
 *
 * Usage in components:
 *   import { listProperties, getProperty } from '../../services/propertyService.js';
 *
 * Or import the whole barrel:
 *   import * as services from '../../services';
 *
 * All service functions return Promises regardless of the active provider (mock/http).
 */

export * as propertyService from './propertyService.js';
export * as authService from './authService.js';
export * as dealService from './dealService.js';
export * as contactService from './contactService.js';
export * as financeService from './financeService.js';
