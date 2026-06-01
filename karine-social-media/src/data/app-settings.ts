// Type client-safe (pas d'imports server-only ici).

export type AppSettings = {
  patientRelanceCooldownDays: number;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  patientRelanceCooldownDays: 3,
};
