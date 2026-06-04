import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-guard';
import { getAppSettings } from '@/lib/app-settings';

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const settings = await getAppSettings();
    return NextResponse.json({ settings });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH partiel des settings. Body au format snake_case DB :
 *   { patient_relance_cooldown_days?: number }
 * Validation : 0..365 jours.
 */
export async function PATCH(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const json = await request.json().catch(() => ({}));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const update: Record<string, any> = {};

    if (json.patient_relance_cooldown_days !== undefined) {
      const v = Number(json.patient_relance_cooldown_days);
      if (!Number.isInteger(v) || v < 0 || v > 365) {
        return NextResponse.json(
          { error: 'patient_relance_cooldown_days doit être entre 0 et 365' },
          { status: 400 },
        );
      }
      update.patient_relance_cooldown_days = v;
    }

    if (json.show_calories_in_counter !== undefined) {
      if (typeof json.show_calories_in_counter !== 'boolean') {
        return NextResponse.json(
          { error: 'show_calories_in_counter doit être boolean' },
          { status: 400 },
        );
      }
      update.show_calories_in_counter = json.show_calories_in_counter;
    }

    if (json.calorie_tracker_enabled !== undefined) {
      if (typeof json.calorie_tracker_enabled !== 'boolean') {
        return NextResponse.json(
          { error: 'calorie_tracker_enabled doit être boolean' },
          { status: 400 },
        );
      }
      update.calorie_tracker_enabled = json.calorie_tracker_enabled;
    }

    if (json.water_tracker_enabled !== undefined) {
      if (typeof json.water_tracker_enabled !== 'boolean') {
        return NextResponse.json(
          { error: 'water_tracker_enabled doit être boolean' },
          { status: 400 },
        );
      }
      update.water_tracker_enabled = json.water_tracker_enabled;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'Aucun paramètre à mettre à jour' },
        { status: 400 },
      );
    }

    const supabase = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('app_settings')
      .update(update)
      .eq('id', 1);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
