import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type {
  BackgroundOverride,
  BackgroundVariantKey,
} from '@/data/background-images';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): BackgroundOverride {
  return {
    variant: row.variant as BackgroundVariantKey,
    portraitUrl: row.portrait_url,
    paysageUrl: row.paysage_url,
    updatedAt: row.updated_at,
  };
}

/** Mapping variant → URLs personnalisées (vide si pas configuré). */
export async function getBackgroundOverrides(): Promise<
  Map<BackgroundVariantKey, BackgroundOverride>
> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('background_images')
    .select('*');
  const map = new Map<BackgroundVariantKey, BackgroundOverride>();
  if (error) {
    console.warn('[background-images] getOverrides', error);
    return map;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    const o = mapRow(row);
    map.set(o.variant, o);
  }
  return map;
}

export async function upsertBackground(args: {
  variant: BackgroundVariantKey;
  portraitUrl?: string | null;
  paysageUrl?: string | null;
  adminId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { updated_by: args.adminId };
  if ('portraitUrl' in args) patch.portrait_url = args.portraitUrl;
  if ('paysageUrl' in args) patch.paysage_url = args.paysageUrl;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('background_images')
    .upsert({ variant: args.variant, ...patch }, { onConflict: 'variant' });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}
