'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, CheckCircle2, AlertCircle, Loader2, Database } from 'lucide-react';
import type { CiqualStats } from '@/lib/ciqual';

type ImportResult = {
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  errors: string[];
  detectedColumns: Record<string, string>;
  sheetUsed: string | null;
  allSheets: string[];
};

type Props = { initialStats: CiqualStats };

export function CiqualImportPanel({ initialStats }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [replaceAll, setReplaceAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('replaceAll', replaceAll ? '1' : '0');
      const res = await fetch('/api/admin/ciqual/import', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || `Erreur ${res.status}`);
        if (json?.detectedColumns || json?.allSheets) {
          setResult({
            totalRows: 0,
            importedRows: 0,
            skippedRows: 0,
            errors: [json.error || ''],
            detectedColumns: json.detectedColumns ?? {},
            sheetUsed: json.sheetUsed ?? null,
            allSheets: json.allSheets ?? [],
          });
        }
      } else {
        setResult(json);
        // Refresh la page pour mettre à jour les stats.
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau');
    } finally {
      setBusy(false);
    }
  }

  const stats = initialStats;
  const hasData = stats.totalFoods > 0;

  return (
    <div className="space-y-4">
      {/* Carte état actuel */}
      <section className="rounded-2xl border border-admin-border bg-white p-4">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-admin-primary">
          <Database className="size-4" />
          État de la base
        </h3>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <Stat label="Aliments" value={stats.totalFoods.toLocaleString('fr-FR')} />
          <Stat label="Groupes" value={String(stats.groupsCount)} />
          <Stat
            label="Dernier import"
            value={
              stats.lastImportAt
                ? new Date(stats.lastImportAt).toLocaleDateString('fr-FR')
                : '—'
            }
          />
        </div>
      </section>

      {/* Carte upload */}
      <section className="rounded-2xl border border-admin-border bg-white p-4">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-admin-primary">
          <Upload className="size-4" />
          Importer un fichier XLSX
        </h3>
        <form onSubmit={handleUpload} className="mt-3 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-admin-ink-soft">
              Fichier Ciqual (.xlsx, 20 Mo max)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
              className="mt-1 block w-full rounded-lg border border-admin-border bg-admin-soft/30 px-2 py-1.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-admin-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-admin-primary-dark disabled:opacity-50"
            />
            {file && (
              <p className="mt-1 text-xs text-admin-ink-soft">
                {file.name} ({(file.size / 1024 / 1024).toFixed(2)} Mo)
              </p>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={replaceAll}
              onChange={(e) => setReplaceAll(e.target.checked)}
              disabled={busy}
              className="mt-0.5"
            />
            <span>
              <strong>Remplacer toute la base</strong> avant l&rsquo;import (recommandé
              pour un fichier complet).
              {!replaceAll && (
                <span className="block text-xs text-admin-ink-soft">
                  Sinon, mise à jour ligne par ligne (upsert sur <code>alim_code</code>).
                </span>
              )}
            </span>
          </label>

          <button
            type="submit"
            disabled={!file || busy}
            className="inline-flex items-center gap-2 rounded-full bg-admin-primary px-4 py-2 text-sm font-semibold text-white shadow hover:bg-admin-primary-dark disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Import en cours…
              </>
            ) : (
              <>
                <Upload className="size-4" />
                Lancer l&rsquo;import
              </>
            )}
          </button>

          {hasData && !busy && (
            <p className="text-xs text-admin-ink-soft">
              ⚠️ La base contient déjà {stats.totalFoods.toLocaleString('fr-FR')} aliments
              {replaceAll ? ' (ils seront supprimés)' : ''}.
            </p>
          )}
        </form>
      </section>

      {/* Carte résultat / erreur */}
      {error && !result && (
        <section className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-rose-600" />
          <div className="text-sm text-rose-800">
            <p className="font-semibold">Import impossible</p>
            <p className="mt-1">{error}</p>
          </div>
        </section>
      )}

      {result && (
        <section className="space-y-3 rounded-2xl border border-admin-border bg-admin-soft/40 p-4">
          <div className="flex items-start gap-3">
            {result.importedRows > 0 ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="mt-0.5 size-5 shrink-0 text-rose-600" />
            )}
            <div className="text-sm">
              <p className="font-semibold">
                {result.importedRows > 0
                  ? `${result.importedRows.toLocaleString('fr-FR')} aliments importés`
                  : 'Aucun aliment importé'}
              </p>
              <p className="text-xs text-admin-ink-soft">
                {result.totalRows.toLocaleString('fr-FR')} lignes lues —{' '}
                {result.skippedRows.toLocaleString('fr-FR')} ignorées (code ou nom manquant)
              </p>
            </div>
          </div>

          {(result.sheetUsed || result.allSheets.length > 0) && (
            <div className="rounded-lg border border-admin-border bg-white p-3 text-xs">
              <p>
                <strong>Onglet utilisé :</strong>{' '}
                <span className="font-mono text-admin-primary">
                  {result.sheetUsed ?? '— aucun —'}
                </span>
              </p>
              {result.allSheets.length > 1 && (
                <p className="mt-1 text-admin-ink-soft">
                  Onglets disponibles : {result.allSheets.join(', ')}
                </p>
              )}
            </div>
          )}

          <details className="rounded-lg border border-admin-border bg-white p-3 text-xs">
            <summary className="cursor-pointer font-semibold text-admin-primary">
              Colonnes détectées
            </summary>
            <ul className="mt-2 space-y-0.5">
              {Object.entries(result.detectedColumns).map(([key, col]) => (
                <li key={key}>
                  <strong className="font-mono">{key}</strong> →{' '}
                  <span
                    className={
                      col === '— manquant —' ? 'text-rose-600' : 'text-admin-ink-soft'
                    }
                  >
                    {col}
                  </span>
                </li>
              ))}
            </ul>
          </details>

          {result.errors.length > 0 && (
            <details className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs">
              <summary className="cursor-pointer font-semibold text-rose-700">
                Erreurs ({result.errors.length})
              </summary>
              <ul className="mt-2 space-y-1 text-rose-800">
                {result.errors.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-admin-soft/40 px-2 py-3">
      <p className="text-xs uppercase tracking-wider text-admin-ink-soft">{label}</p>
      <p className="mt-1 text-lg font-bold text-admin-primary-dark">{value}</p>
    </div>
  );
}
