import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
} from '@/data/app-settings';

/**
 * Lecture des paramètres globaux de l'app. Lit la singleton row (id=1) de
 * app_settings. Fail-safe : renvoie les défauts si la table n'existe pas encore
 * (migration pas appliquée) ou si la requête échoue. Jamais d'exception remontée
 * pour éviter de casser une page si la DB a un hic.
 */
export async function getAppSettings(): Promise<AppSettings> {
  try {
    const supabase = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('app_settings')
      .select('patient_relance_cooldown_days, show_calories_in_counter')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return DEFAULT_APP_SETTINGS;
    return {
      patientRelanceCooldownDays:
        typeof data.patient_relance_cooldown_days === 'number'
          ? data.patient_relance_cooldown_days
          : DEFAULT_APP_SETTINGS.patientRelanceCooldownDays,
      showCaloriesInCounter:
        typeof data.show_calories_in_counter === 'boolean'
          ? data.show_calories_in_counter
          : DEFAULT_APP_SETTINGS.showCaloriesInCounter,
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}
