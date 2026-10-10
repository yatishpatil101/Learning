/** A flatmate report is `post`, not `user`: the server validates the reason against the target type (else 400).
 * A decided report is terminal, since reopening would erase the record that somebody judged it. */
import { createProvider } from './config.js';

const provider = createProvider('report');

/** The provider surfaces the server's 409 for a duplicate live report as `'duplicate'`,
 * so the modal does not thank the user for a report nobody received. */
export const createReport = async (report) => (await provider()).createReport(report);

export const listReports = async (opts) => (await provider()).listReports(opts);

export const triageReport = async (id, decision) => (await provider()).triageReport(id, decision);
