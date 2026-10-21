import type { SafetyReport } from './types';

/**
 * The demo tenant, site list and sample reports used to live here.
 *
 * The worker app reads its site list, company name, employee master, recognitions and
 * reports from the server now, and every screen that used to fall back to a sample shows an
 * empty state instead. Nothing in this file is rendered; it survives only so a stale import
 * fails at build time rather than silently reintroducing demo rows.
 */
export const DEMO_REPORTS: SafetyReport[] = [];
