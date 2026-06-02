import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type { Capability, CapabilityKey } from '@/data/capabilities';

/**
 * Lecture de toutes les capabilities (depuis le service-role pour bypasser
 * RLS — la lecture est publique de toute façon, mais on uniformise).
 *
 * Cache court (next: revalidate 60s) pour éviter un round-trip par check.
 */
export async function getAllCapabilities(): Promise<Capability[]> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('capabilities')
    .select('*')
    .order('group_label', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) {
    console.warn('[capabilities] getAll', error);
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    key: r.key as CapabilityKey,
    groupKey: r.group_key,
    groupLabel: r.group_label,
    label: r.label,
    description: r.description,
    allowedWithoutPlan: !!r.allowed_without_plan,
    sortOrder: r.sort_order ?? 0,
  }));
}

/**
 * Récupère la valeur `allowed_without_plan` d'une capability.
 * Renvoie `false` si la clé n'existe pas (défaut sécurisé : on bloque).
 */
export async function getCapabilityValue(
  key: CapabilityKey,
): Promise<boolean> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('capabilities')
    .select('allowed_without_plan')
    .eq('key', key)
    .maybeSingle();
  if (error || !data) return false;
  return !!data.allowed_without_plan;
}

/**
 * Update d'une capability depuis l'admin. Karine toggle, on persiste.
 */
export async function setCapabilityValue(args: {
  key: CapabilityKey;
  allowed: boolean;
  adminId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('capabilities')
    .update({
      allowed_without_plan: args.allowed,
      updated_by: args.adminId,
    })
    .eq('key', args.key);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}
