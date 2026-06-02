import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type {
  LegalSettings,
  PublicLegalSettings,
} from '@/data/legal-settings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFull(row: any): LegalSettings {
  return {
    companyName: row.company_name,
    legalForm: row.legal_form,
    capitalSocial: row.capital_social,
    siegeSocial: row.siege_social,
    rcsCity: row.rcs_city,
    rcsNumber: row.rcs_number,
    siret: row.siret,
    vatNumber: row.vat_number,
    directorName: row.director_name,
    directorFunction: row.director_function,
    contactEmail: row.contact_email,
    mediatorName: row.mediator_name,
    mediatorUrl: row.mediator_url,
    courtJurisdiction: row.court_jurisdiction,
    bankHolderName: row.bank_holder_name,
    bankIban: row.bank_iban,
    bankBic: row.bank_bic,
    bankName: row.bank_name,
  };
}

function toPublic(full: LegalSettings): PublicLegalSettings {
  // Strip explicite des champs bancaires
  return {
    companyName: full.companyName,
    legalForm: full.legalForm,
    capitalSocial: full.capitalSocial,
    siegeSocial: full.siegeSocial,
    rcsCity: full.rcsCity,
    rcsNumber: full.rcsNumber,
    siret: full.siret,
    vatNumber: full.vatNumber,
    directorName: full.directorName,
    directorFunction: full.directorFunction,
    contactEmail: full.contactEmail,
    mediatorName: full.mediatorName,
    mediatorUrl: full.mediatorUrl,
    courtJurisdiction: full.courtJurisdiction,
  };
}

const EMPTY_FULL: LegalSettings = {
  companyName: null, legalForm: null, capitalSocial: null, siegeSocial: null,
  rcsCity: null, rcsNumber: null, siret: null, vatNumber: null,
  directorName: null, directorFunction: null, contactEmail: null,
  mediatorName: null, mediatorUrl: null, courtJurisdiction: null,
  bankHolderName: null, bankIban: null, bankBic: null, bankName: null,
};

/** Toutes les valeurs y compris bancaires — RÉSERVÉ AU SERVEUR ADMIN. */
export async function getLegalSettingsForAdmin(): Promise<LegalSettings> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('legal_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) return EMPTY_FULL;
  return mapFull(data);
}

/** Version publique (sans champs bancaires) pour les 4 pages légales. */
export async function getPublicLegalSettings(): Promise<PublicLegalSettings> {
  const full = await getLegalSettingsForAdmin();
  return toPublic(full);
}

export async function updateLegalSettings(args: {
  patch: Partial<LegalSettings>;
  adminId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = { updated_by: args.adminId };
  const p = args.patch;
  if ('companyName' in p) update.company_name = p.companyName;
  if ('legalForm' in p) update.legal_form = p.legalForm;
  if ('capitalSocial' in p) update.capital_social = p.capitalSocial;
  if ('siegeSocial' in p) update.siege_social = p.siegeSocial;
  if ('rcsCity' in p) update.rcs_city = p.rcsCity;
  if ('rcsNumber' in p) update.rcs_number = p.rcsNumber;
  if ('siret' in p) update.siret = p.siret;
  if ('vatNumber' in p) update.vat_number = p.vatNumber;
  if ('directorName' in p) update.director_name = p.directorName;
  if ('directorFunction' in p) update.director_function = p.directorFunction;
  if ('contactEmail' in p) update.contact_email = p.contactEmail;
  if ('mediatorName' in p) update.mediator_name = p.mediatorName;
  if ('mediatorUrl' in p) update.mediator_url = p.mediatorUrl;
  if ('courtJurisdiction' in p) update.court_jurisdiction = p.courtJurisdiction;
  if ('bankHolderName' in p) update.bank_holder_name = p.bankHolderName;
  if ('bankIban' in p) update.bank_iban = p.bankIban;
  if ('bankBic' in p) update.bank_bic = p.bankBic;
  if ('bankName' in p) update.bank_name = p.bankName;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('legal_settings')
    .update(update)
    .eq('id', 1);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}
