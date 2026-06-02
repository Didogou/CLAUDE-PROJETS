/**
 * Type des informations légales/business. Singleton (1 seule ligne en DB).
 *
 * IMPORTANT : pour les pages publiques (mentions, CGU, CGV, confidentialité),
 * utiliser `PublicLegalSettings` qui EXCLUT les champs bancaires sensibles.
 */
export type LegalSettings = {
  // Identité société
  companyName: string | null;
  legalForm: string | null;
  capitalSocial: string | null;
  siegeSocial: string | null;
  rcsCity: string | null;
  rcsNumber: string | null;
  siret: string | null;
  vatNumber: string | null;
  // Direction
  directorName: string | null;
  directorFunction: string | null;
  // Contact
  contactEmail: string | null;
  // Médiation / juridiction
  mediatorName: string | null;
  mediatorUrl: string | null;
  courtJurisdiction: string | null;
  // Bancaire (admin only — JAMAIS exposé sur les pages publiques)
  bankHolderName: string | null;
  bankIban: string | null;
  bankBic: string | null;
  bankName: string | null;
};

/** Version publique sans les champs bancaires (pour pages /cgu, /cgv, etc.) */
export type PublicLegalSettings = Omit<
  LegalSettings,
  'bankHolderName' | 'bankIban' | 'bankBic' | 'bankName'
>;

export const PUBLIC_LEGAL_KEYS: (keyof PublicLegalSettings)[] = [
  'companyName',
  'legalForm',
  'capitalSocial',
  'siegeSocial',
  'rcsCity',
  'rcsNumber',
  'siret',
  'vatNumber',
  'directorName',
  'directorFunction',
  'contactEmail',
  'mediatorName',
  'mediatorUrl',
  'courtJurisdiction',
];
