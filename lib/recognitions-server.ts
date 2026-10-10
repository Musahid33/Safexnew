import 'server-only';
import { getAdminSupabase } from '@/lib/supabase/admin';

export type RecognitionDb = {
  id: string;
  employee_name: string;
  reward_for: string;
  image_url: string | null;
  artwork_index: number;
  consent_confirmed: boolean;
  is_published: boolean;
  sort_order: number;
};

export function mapRecognition(row: RecognitionDb) {
  return {
    id: row.id,
    employeeName: row.employee_name,
    rewardFor: row.reward_for,
    imageUrl: row.image_url,
    artworkIndex: row.artwork_index
  };
}

/** This deployment is scoped to ONE configured tenant; no client-supplied tenant IDs. */
export async function recognitionStore() {
  const admin = getAdminSupabase();
  const slug = process.env.SAFEX_TENANT_SLUG?.trim();
  if (!admin || !slug) return null;
  const { data, error } = await admin.from('tenants').select('id').eq('slug', slug).eq('active', true).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { admin, tenantId: data.id as string };
}
