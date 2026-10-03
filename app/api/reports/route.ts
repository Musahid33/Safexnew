import { createHmac } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/admin';
import type { ReportType } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 12 * 1024 * 1024 + 64 * 1024;
const ATTACHMENT_BUCKET = 'safex-report-attachments';
const REPORT_TYPES: ReportType[] = ['Near Miss', 'Hazard', 'Safety Observation', 'Unsafe Condition', 'Unsafe Act', 'Feedback', 'Grievance', 'Speak Up', 'Suggestion'];
const REPORT_TYPE_DB: Record<ReportType, string> = {
  'Near Miss': 'near_miss',
  Hazard: 'hazard',
  'Safety Observation': 'safety_observation',
  'Unsafe Condition': 'unsafe_condition',
  'Unsafe Act': 'unsafe_act',
  Feedback: 'feedback',
  Grievance: 'grievance',
  'Speak Up': 'speak_up',
  Suggestion: 'suggestion'
};

const payloadSchema = z.object({
  clientSubmissionId: z.string().min(16).max(64).regex(/^[a-z0-9-]+$/i),
  siteId: z.string().min(2).max(96).regex(/^[a-z0-9][a-z0-9_-]+$/i),
  type: z.enum(REPORT_TYPES),
  category: z.string().trim().max(100).nullable(),
  anonymous: z.boolean(),
  employeeNo: z.string().trim().min(1).max(80).nullable(),
  area: z.string().trim().max(200),
  department: z.string().trim().max(120).nullable(),
  incidentAt: z.string().min(1).max(64).refine((value) => !Number.isNaN(new Date(value).getTime()), 'Invalid incident date.'),
  description: z.string().trim().min(8).max(1200),
  immediateAction: z.string().trim().max(600),
  severity: z.enum(['Low', 'Medium', 'High']).nullable(),
  clientSubmittedAt: z.string().min(1).max(64).refine((value) => !Number.isNaN(new Date(value).getTime()), 'Invalid submission date.')
}).superRefine((value, context) => {
  if (value.anonymous && value.type !== 'Speak Up') {
    context.addIssue({ code: 'custom', path: ['anonymous'], message: 'Anonymous submission is only available for Speak Up.' });
  }
  if (value.anonymous && value.employeeNo) {
    context.addIssue({ code: 'custom', path: ['employeeNo'], message: 'Anonymous reports must not include employee identity.' });
  }
  if (!value.anonymous && !value.employeeNo) {
    context.addIssue({ code: 'custom', path: ['employeeNo'], message: 'Select an employee profile for this report.' });
  }
});

type ReportPayload = z.infer<typeof payloadSchema>;
type AdminClient = NonNullable<ReturnType<typeof getAdminSupabase>>;
type ValidatedAttachment = { file: File; mime: 'image/jpeg' | 'image/png' | 'image/webp'; extension: 'jpg' | 'png' | 'webp' };

function jsonError(status: number, code: string, error: string) {
  return NextResponse.json({ ok: false, code, error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function sameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return false;
  if (!origin) return true;
  try {
    return new URL(origin).host.toLowerCase() === request.nextUrl.host.toLowerCase();
  } catch {
    return false;
  }
}

function requestHost(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const rawHost = forwardedHost?.split(',')[0]?.trim() || request.nextUrl.host;
  return rawHost.split(':')[0].toLowerCase().replace(/\.$/, '');
}

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || 'unknown';
}

async function parsePayload(request: NextRequest): Promise<{ raw: unknown; attachment: File | null }> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const raw = form.get('payload');
    const file = form.get('attachment');
    if (typeof raw !== 'string') throw new Error('Missing report payload.');
    return { raw: JSON.parse(raw) as unknown, attachment: file instanceof File ? file : null };
  }
  if (!contentType.includes('application/json')) throw new Error('Use JSON or multipart form data.');
  return { raw: await request.json() as unknown, attachment: null };
}

async function validateAttachment(file: File | null): Promise<ValidatedAttachment | null> {
  if (!file) return null;
  if (file.size < 1 || file.size > 12 * 1024 * 1024) throw new Error('Photo attachment must be between 1 byte and 12 MB.');
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isJpeg = file.type === 'image/jpeg' && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const isPng = file.type === 'image/png' && header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47 && header[4] === 0x0d && header[5] === 0x0a && header[6] === 0x1a && header[7] === 0x0a;
  const isWebp = file.type === 'image/webp' && String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
  if (isJpeg) return { file, mime: 'image/jpeg', extension: 'jpg' };
  if (isPng) return { file, mime: 'image/png', extension: 'png' };
  if (isWebp) return { file, mime: 'image/webp', extension: 'webp' };
  throw new Error('Photo must be a valid JPEG, PNG, or WebP image.');
}

async function consumeRateLimit(admin: AdminClient, request: NextRequest, host: string, tenantId: string): Promise<boolean | null> {
  const windowMs = 60 * 60 * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const salt = process.env.SAFEX_REPORT_RATE_LIMIT_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!salt) return null;
  const key = createHmac('sha256', salt).update(`${host}|${tenantId}|${clientIp(request)}|${windowStart.toISOString()}`).digest('hex');
  const { data, error } = await admin.rpc('safex_consume_report_limit', {
    p_bucket_key: key,
    p_window_start: windowStart.toISOString(),
    p_limit: 24
  });
  if (error) return null;
  return data === true;
}

async function findExistingReport(admin: AdminClient, tenantId: string, reportRef: string) {
  return admin.from('reports').select('id, report_ref, site_id, created_at').eq('tenant_id', tenantId).eq('report_ref', reportRef).maybeSingle();
}

async function ensureAttachment(admin: AdminClient, attachment: ValidatedAttachment | null, tenantId: string, siteId: string, reportId: string, clientSubmissionId: string): Promise<string | null> {
  if (!attachment) return null;
  const { data: existing, error: lookupError } = await admin.from('report_attachments').select('id').eq('report_id', reportId).maybeSingle();
  if (lookupError) return 'Could not check report attachment status.';
  if (existing) return null;

  const storagePath = `${tenantId}/${siteId}/${clientSubmissionId}.${attachment.extension}`;
  const { error: uploadError } = await admin.storage.from(ATTACHMENT_BUCKET).upload(storagePath, attachment.file, {
    cacheControl: '3600',
    contentType: attachment.mime,
    upsert: true
  });
  if (uploadError) return 'Private photo storage is not ready. The report remains queued for retry.';

  const { error: insertError } = await admin.from('report_attachments').insert({
    tenant_id: tenantId,
    site_id: siteId,
    report_id: reportId,
    original_storage_path: storagePath,
    review_state: 'pending'
  });
  if (!insertError) return null;

  const { data: racedAttachment } = await admin.from('report_attachments').select('id').eq('report_id', reportId).maybeSingle();
  if (racedAttachment) return null;
  await admin.storage.from(ATTACHMENT_BUCKET).remove([storagePath]);
  return 'Could not save the private photo record. The report remains queued for retry.';
}

export async function POST(request: NextRequest) {
  if (!sameOriginRequest(request)) return jsonError(403, 'CROSS_ORIGIN_REJECTED', 'Cross-origin report submission is not allowed.');

  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) return jsonError(413, 'REPORT_TOO_LARGE', 'Report data or its optional photo exceeds the allowed size.');

  if (process.env.SAFEX_REPORT_SUBMISSIONS_ENABLED !== 'true') {
    return jsonError(503, 'REPORT_BACKEND_DISABLED', 'Reports are saved on this device, but database sync is not configured on the Safex server yet.');
  }
  const admin = getAdminSupabase();
  if (!admin) return jsonError(503, 'REPORT_BACKEND_DISABLED', 'Database sync is not configured on the Safex server yet.');

  const host = requestHost(request);
  if (!host || host.length > 253 || host === 'localhost') return jsonError(404, 'TENANT_NOT_FOUND', 'No verified tenant is configured for this host.');
  const { data: domain, error: domainError } = await admin.from('tenant_domains').select('tenant_id').eq('domain', host).not('verified_at', 'is', null).maybeSingle();
  if (domainError || !domain?.tenant_id) return jsonError(404, 'TENANT_NOT_FOUND', 'No verified tenant is configured for this host.');

  const rateLimit = await consumeRateLimit(admin, request, host, domain.tenant_id);
  if (rateLimit === null) return jsonError(503, 'REPORT_RATE_LIMIT_UNAVAILABLE', 'Secure report submission is not fully configured. This report remains queued on this device.');
  if (!rateLimit) return jsonError(429, 'REPORT_RATE_LIMITED', 'Too many reports were submitted from this connection. Try syncing later.');

  let raw: unknown;
  let uploadFile: File | null;
  try {
    ({ raw, attachment: uploadFile } = await parsePayload(request));
  } catch {
    return jsonError(400, 'INVALID_REPORT_BODY', 'Report data could not be read.');
  }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return jsonError(422, 'REPORT_VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Report data is invalid.');
  const payload: ReportPayload = parsed.data;
  let attachment: ValidatedAttachment | null;
  try {
    attachment = await validateAttachment(uploadFile);
  } catch (error) {
    return jsonError(422, 'ATTACHMENT_VALIDATION_FAILED', error instanceof Error ? error.message : 'Photo attachment is invalid.');
  }

  const siteRefIsUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.siteId);
  let siteQuery = admin.from('sites').select('id, tenant_id').eq('tenant_id', domain.tenant_id).eq('active', true);
  siteQuery = siteRefIsUuid ? siteQuery.eq('id', payload.siteId) : siteQuery.eq('slug', payload.siteId);
  const { data: site, error: siteError } = await siteQuery.maybeSingle();
  if (siteError || !site?.id) return jsonError(422, 'SITE_NOT_AVAILABLE', 'The selected site is not active for this tenant.');

  const reportRef = `OFFLINE-${payload.clientSubmissionId}`;
  const { data: existing, error: existingError } = await findExistingReport(admin, domain.tenant_id, reportRef);
  if (existingError) return jsonError(503, 'REPORT_LOOKUP_UNAVAILABLE', 'The report database is temporarily unavailable.');
  if (existing && existing.site_id !== site.id) return jsonError(409, 'SUBMISSION_ID_CONFLICT', 'This report submission ID was already used for a different site.');

  let reporterEmployeeId: string | null = null;
  if (!payload.anonymous && !existing) {
    const { data: employee, error: employeeError } = await admin.from('employees')
      .select('id')
      .eq('tenant_id', domain.tenant_id)
      .eq('site_id', site.id)
      .eq('employee_no', payload.employeeNo)
      .eq('active', true)
      .maybeSingle();
    if (employeeError || !employee?.id) return jsonError(422, 'EMPLOYEE_NOT_AVAILABLE', 'Select an active employee profile for the selected site before syncing.');
    reporterEmployeeId = employee.id;
  }

  let reportId: string;
  let createdAt: string;
  if (existing) {
    reportId = existing.id;
    createdAt = existing.created_at;
  } else {
    const { data: report, error: insertError } = await admin.from('reports').insert({
      tenant_id: domain.tenant_id,
      site_id: site.id,
      reporter_employee_id: reporterEmployeeId,
      report_ref: reportRef,
      report_type: REPORT_TYPE_DB[payload.type],
      report_category: payload.category,
      anonymous: payload.anonymous,
      area: payload.area || null,
      department: payload.department || null,
      occurred_at: new Date(payload.incidentAt).toISOString(),
      severity: payload.severity,
      short_description: payload.description.slice(0, 120),
      description: payload.description,
      immediate_action: payload.immediateAction || null,
      status: 'open',
      client_submitted_at: new Date(payload.clientSubmittedAt).toISOString()
    }).select('id, created_at').single();

    if (insertError || !report?.id) {
      if (insertError?.code === '23505') {
        const { data: racedReport } = await findExistingReport(admin, domain.tenant_id, reportRef);
        if (racedReport?.id && racedReport.site_id === site.id) {
          reportId = racedReport.id;
          createdAt = racedReport.created_at;
        } else {
          return jsonError(503, 'REPORT_SAVE_UNAVAILABLE', 'The report could not be saved yet. It remains queued on this device.');
        }
      } else {
        return jsonError(503, 'REPORT_SAVE_UNAVAILABLE', 'The report could not be saved yet. It remains queued on this device.');
      }
    } else {
      reportId = report.id;
      createdAt = report.created_at;
    }
  }

  const attachmentError = await ensureAttachment(admin, attachment, domain.tenant_id, site.id, reportId, payload.clientSubmissionId);
  if (attachmentError) return jsonError(503, 'REPORT_ATTACHMENT_SAVE_UNAVAILABLE', attachmentError);

  return NextResponse.json({ ok: true, reportId, reportRef, createdAt, duplicate: Boolean(existing) }, {
    status: existing ? 200 : 201,
    headers: { 'Cache-Control': 'no-store' }
  });
}
