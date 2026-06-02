'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  CreditCard,
  FileText,
  Gavel,
  Mail,
  Save,
  ShieldCheck,
} from 'lucide-react';
import type { LegalSettings } from '@/data/legal-settings';

type Field = {
  key: keyof LegalSettings;
  label: string;
  placeholder: string;
  textarea?: boolean;
};

type Section = {
  key: string;
  label: string;
  icon: typeof Building2;
  fields: Field[];
};

const SECTIONS: Section[] = [
  {
    key: 'company',
    label: 'Identité de la société éditrice',
    icon: Building2,
    fields: [
      { key: 'companyName', label: 'Raison sociale', placeholder: 'Ex. Karine Diététique SAS' },
      { key: 'legalForm', label: 'Forme juridique', placeholder: 'SAS / SARL / Auto-entrepreneur' },
      { key: 'capitalSocial', label: 'Capital social (€)', placeholder: 'Ex. 5 000' },
      { key: 'siegeSocial', label: 'Siège social (adresse complète)', placeholder: '12 rue des Lilas, 75011 Paris', textarea: true },
      { key: 'rcsCity', label: 'Ville du RCS', placeholder: 'Paris' },
      { key: 'rcsNumber', label: 'Numéro RCS', placeholder: '912 345 678' },
      { key: 'siret', label: 'SIRET (14 chiffres)', placeholder: '91234567800012' },
      { key: 'vatNumber', label: 'N° TVA intracommunautaire', placeholder: 'FR12 912345678' },
    ],
  },
  {
    key: 'director',
    label: 'Direction de la publication',
    icon: ShieldCheck,
    fields: [
      { key: 'directorName', label: 'Nom complet', placeholder: 'Ex. Karine Piffaretti' },
      { key: 'directorFunction', label: 'Fonction', placeholder: 'Présidente, Gérante…' },
    ],
  },
  {
    key: 'contact',
    label: 'Contact',
    icon: Mail,
    fields: [
      { key: 'contactEmail', label: 'Email de contact public', placeholder: 'contact@karine-dietetique.fr' },
    ],
  },
  {
    key: 'legal',
    label: 'Médiation et juridiction',
    icon: Gavel,
    fields: [
      { key: 'mediatorName', label: 'Médiateur de la consommation (nom + coordonnées)', placeholder: 'Ex. MEDICYS, 73 boulevard de Clichy, 75009 Paris', textarea: true },
      { key: 'mediatorUrl', label: 'Site web du médiateur', placeholder: 'https://www.medicys.fr' },
      { key: 'courtJurisdiction', label: 'Tribunal compétent (ville)', placeholder: 'Paris' },
    ],
  },
  {
    key: 'bank',
    label: 'Coordonnées bancaires (admin uniquement)',
    icon: CreditCard,
    fields: [
      { key: 'bankHolderName', label: 'Titulaire du compte', placeholder: 'Ex. Karine Piffaretti' },
      { key: 'bankIban', label: 'IBAN', placeholder: 'FR76 1234 5678 9012 3456 7890 123' },
      { key: 'bankBic', label: 'BIC / SWIFT', placeholder: 'AGRIFRPP' },
      { key: 'bankName', label: 'Nom de la banque', placeholder: 'Crédit Agricole' },
    ],
  },
];

export function LegalSettingsView({ initial }: { initial: LegalSettings }) {
  const router = useRouter();
  const [values, setValues] = useState<LegalSettings>(initial);
  const [savingField, setSavingField] = useState<keyof LegalSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<keyof LegalSettings | null>(null);

  async function commit(field: keyof LegalSettings, newValue: string) {
    const current = values[field] ?? '';
    if (newValue === current) return;

    setSavingField(field);
    setError(null);
    setValues((prev) => ({ ...prev, [field]: newValue || null }));
    try {
      const res = await fetch('/api/admin/legal-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: newValue }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Échec sauvegarde');
      setSavedField(field);
      window.setTimeout(() => setSavedField(null), 1500);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setValues((prev) => ({ ...prev, [field]: (current || null) }));
    } finally {
      setSavingField(null);
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {SECTIONS.map((section) => {
        const Icon = section.icon;
        const isBank = section.key === 'bank';
        return (
          <section
            key={section.key}
            className={`overflow-hidden rounded-2xl shadow-sm ${
              isBank
                ? 'border-2 border-tangerine/30 bg-tangerine/5'
                : 'bg-admin-surface'
            }`}
          >
            <header className="flex items-center gap-3 border-b border-admin-border bg-admin-soft/40 px-4 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-admin-primary/15 text-admin-primary-dark">
                <Icon className="h-4 w-4" strokeWidth={2.2} />
              </span>
              <h3 className="text-sm font-bold uppercase tracking-wider text-admin-ink">
                {section.label}
              </h3>
              {isBank && (
                <span className="ml-auto rounded-full bg-tangerine/20 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-tangerine">
                  Confidentiel
                </span>
              )}
            </header>

            <ul className="divide-y divide-admin-border">
              {section.fields.map((field) => (
                <li key={field.key} className="px-4 py-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-admin-ink">
                      {field.label}
                    </span>
                    {field.textarea ? (
                      <textarea
                        defaultValue={values[field.key] ?? ''}
                        onBlur={(e) => commit(field.key, e.target.value.trim())}
                        disabled={savingField === field.key}
                        placeholder={field.placeholder}
                        rows={2}
                        maxLength={1000}
                        className="w-full resize-none rounded-lg border border-admin-primary/30 bg-white px-3 py-2 text-sm text-admin-ink shadow-sm focus:border-admin-primary focus:outline-none focus:ring-2 focus:ring-admin-primary/30"
                      />
                    ) : (
                      <input
                        type="text"
                        defaultValue={values[field.key] ?? ''}
                        onBlur={(e) => commit(field.key, e.target.value.trim())}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        disabled={savingField === field.key}
                        placeholder={field.placeholder}
                        maxLength={1000}
                        className="w-full rounded-lg border border-admin-primary/30 bg-white px-3 py-2 text-sm text-admin-ink shadow-sm focus:border-admin-primary focus:outline-none focus:ring-2 focus:ring-admin-primary/30"
                      />
                    )}
                  </label>
                  {savingField === field.key && (
                    <p className="mt-1 text-[0.65rem] text-admin-ink-soft">
                      Sauvegarde…
                    </p>
                  )}
                  {savedField === field.key && (
                    <p className="mt-1 flex items-center gap-1 text-[0.65rem] font-semibold text-sage">
                      <Save className="h-3 w-3" />
                      Enregistré
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="flex items-center gap-1.5 text-xs text-admin-ink-soft">
        <FileText className="h-3.5 w-3.5" />
        Les modifications sont sauvegard&eacute;es automatiquement &agrave; chaque
        clic en dehors d&apos;un champ.
      </p>
    </div>
  );
}
