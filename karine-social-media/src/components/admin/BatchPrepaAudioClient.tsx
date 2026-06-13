'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Square, Loader2, Check, AlertCircle, RefreshCw, Mic } from 'lucide-react';

/**
 * Batch « préparations + voix Karine ».
 *
 * Pour chaque recette, séquentiellement :
 *   1. (si activé) POST extract-preparation { skipExisting:true }
 *      → Claude Vision extrait les étapes des fiches SANS preparation_steps.
 *   2. (si activé) POST generate-audio { voiceId, skipExisting:true }
 *      → ElevenLabs (Voix de Karine) sonorise les étapes SANS audioUrl.
 *
 * Tout est skip-déjà-fait : relançable sans re-payer Vision/ElevenLabs.
 * Séquentiel sur les recettes (les routes appellent déjà Vision/TTS en
 * série en interne) → évite de saturer les APIs.
 */

// Voix clonée de Karine dans le compte ElevenLabs (qldg… = "Voix de Karine").
const KARINE_VOICE_ID = 'qldgI4Q7iIA8Jpu0jOvi';

type StatusItem = {
  slug: string;
  title: string;
  sheets: number;
  sheetsNoSteps: number;
  steps: number;
  stepsNoAudio: number;
};
type Stats = {
  recipes: number;
  sheets: number;
  sheetsNoSteps: number;
  steps: number;
  stepsNoAudio: number;
};
type Phase = 'idle' | 'extract' | 'audio' | 'done' | 'error' | 'skipped';
type Row = StatusItem & { phase: Phase; msg?: string };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function BatchPrepaAudioClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progressIdx, setProgressIdx] = useState(0);

  const [voiceId, setVoiceId] = useState(KARINE_VOICE_ID);
  const [doExtract, setDoExtract] = useState(true);
  const [doAudio, setDoAudio] = useState(true);
  const [onlyTodo, setOnlyTodo] = useState(true);

  const stopRef = useRef(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/recipes/batch-prepa-status');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRows((data.items as StatusItem[]).map((it) => ({ ...it, phase: 'idle' as Phase })));
      setStats(data.stats as Stats);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function patch(idx: number, p: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...p } : r)));
  }

  async function run() {
    if (!doExtract && !doAudio) return;
    stopRef.current = false;
    setRunning(true);
    try {
      for (let i = 0; i < rows.length; i++) {
        if (stopRef.current) break;
        setProgressIdx(i);
        const r = rows[i];

        // Rien à faire sur cette recette compte tenu des options → skip rapide.
        const willExtract = doExtract && r.sheetsNoSteps > 0;
        const mightAudio = doAudio && (willExtract || r.stepsNoAudio > 0);
        if (!willExtract && !mightAudio) {
          patch(i, { phase: 'skipped', msg: 'déjà à jour' });
          continue;
        }

        try {
          let freshSteps = false;
          let extractMsg = '';
          if (willExtract) {
            patch(i, { phase: 'extract' });
            const ex = await fetch(
              `/api/admin/recipes/${encodeURIComponent(r.slug)}/extract-preparation`,
              { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ skipExisting: true }) },
            );
            const exd = await ex.json();
            if (!ex.ok) throw new Error(exd.error || `extraction ${ex.status}`);
            freshSteps = (exd.updated ?? 0) > 0;
            extractMsg = `extrait ${exd.updated ?? 0} fiche(s)`;
          }

          let audioMsg = '';
          if (doAudio && (freshSteps || r.stepsNoAudio > 0)) {
            patch(i, { phase: 'audio' });
            const au = await fetch(
              `/api/admin/recipes/${encodeURIComponent(r.slug)}/generate-audio`,
              {
                method: 'POST',
                headers: JSON_HEADERS,
                body: JSON.stringify({ voiceId: voiceId.trim() || undefined, skipExisting: true }),
              },
            );
            const aud = await au.json();
            if (!au.ok) throw new Error(aud.error || `voix ${au.status}`);
            audioMsg = `${aud.generated ?? 0} voix générée(s)`;
            if (Array.isArray(aud.errors) && aud.errors.length) {
              audioMsg += ` · ${aud.errors.length} err`;
            }
          }

          patch(i, {
            phase: 'done',
            msg: [extractMsg, audioMsg].filter(Boolean).join(' · ') || 'ok',
          });
        } catch (e) {
          patch(i, { phase: 'error', msg: e instanceof Error ? e.message : String(e) });
        }
      }
    } finally {
      stopRef.current = false;
      setRunning(false);
      void load(); // recharge les compteurs réels après le batch
    }
  }

  const doneCount = rows.filter((r) => r.phase === 'done').length;
  const errCount = rows.filter((r) => r.phase === 'error').length;
  const visible = onlyTodo
    ? rows.filter((r) => r.sheetsNoSteps > 0 || r.stepsNoAudio > 0 || r.phase !== 'idle')
    : rows;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Mic className="h-6 w-6" /> Préparations + voix de Karine
        </h1>
        <p className="text-sm text-gray-600">
          Extrait les étapes de préparation (Claude Vision) puis génère la voix
          de chaque étape avec la <strong>Voix de Karine</strong> (ElevenLabs).
          Skip systématique de ce qui est déjà fait — relançable à volonté.
        </p>
      </header>

      {stats && (
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-rose-50 p-3 text-sm sm:grid-cols-4">
          <div><strong>{stats.recipes}</strong> recettes</div>
          <div><strong>{stats.sheets}</strong> fiches</div>
          <div className={stats.sheetsNoSteps ? 'text-amber-700' : ''}>
            <strong>{stats.sheetsNoSteps}</strong> fiches sans étapes
          </div>
          <div className={stats.stepsNoAudio ? 'text-amber-700' : ''}>
            <strong>{stats.stepsNoAudio}</strong> étapes sans voix
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 p-4">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={doExtract}
            onChange={(e) => setDoExtract(e.target.checked)}
            disabled={running}
          />
          1. Extraire les préparations (Vision)
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={doAudio}
            onChange={(e) => setDoAudio(e.target.checked)}
            disabled={running}
          />
          2. Générer les voix (Karine)
        </label>
        <div className="flex flex-col">
          <label className="text-xs font-semibold text-gray-600">Voice ID (ElevenLabs)</label>
          <input
            type="text"
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            disabled={running}
            className="w-64 rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
          <input
            type="checkbox"
            checked={onlyTodo}
            onChange={(e) => setOnlyTodo(e.target.checked)}
          />
          Afficher seulement à traiter
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={running}
            className="flex items-center gap-1.5 rounded-md bg-gray-200 px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" /> Recharger
          </button>
          {running ? (
            <button
              type="button"
              onClick={() => (stopRef.current = true)}
              className="flex items-center gap-1.5 rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white"
            >
              <Square className="h-4 w-4" /> Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void run()}
              disabled={loading || (!doExtract && !doAudio)}
              className="flex items-center gap-1.5 rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Play className="h-4 w-4" /> Lancer le batch
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
          {loadError}
        </div>
      )}

      {running && (
        <p className="text-sm text-gray-600">
          Traitement {progressIdx + 1}/{rows.length} · {doneCount} OK · {errCount} erreurs…
          <span className="ml-1 text-xs">(les appels Vision/TTS sont longs, c&apos;est normal)</span>
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Recette</th>
                <th className="px-2 py-2 text-center">Fiches</th>
                <th className="px-2 py-2 text-center">Sans étapes</th>
                <th className="px-2 py-2 text-center">Étapes</th>
                <th className="px-2 py-2 text-center">Sans voix</th>
                <th className="px-3 py-2">État</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.slug} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium">{r.title}</td>
                  <td className="px-2 py-2 text-center">{r.sheets}</td>
                  <td className={`px-2 py-2 text-center ${r.sheetsNoSteps ? 'text-amber-700' : 'text-gray-300'}`}>
                    {r.sheetsNoSteps}
                  </td>
                  <td className="px-2 py-2 text-center">{r.steps}</td>
                  <td className={`px-2 py-2 text-center ${r.stepsNoAudio ? 'text-amber-700' : 'text-gray-300'}`}>
                    {r.stepsNoAudio}
                  </td>
                  <td className="px-3 py-2">
                    <PhaseBadge phase={r.phase} msg={r.msg} />
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                    {onlyTodo ? 'Tout est à jour 🎉' : 'Aucune recette.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PhaseBadge({ phase, msg }: { phase: Phase; msg?: string }) {
  if (phase === 'extract')
    return <span className="flex items-center gap-1 text-blue-600"><Loader2 className="h-4 w-4 animate-spin" /> extraction…</span>;
  if (phase === 'audio')
    return <span className="flex items-center gap-1 text-fuchsia-600"><Loader2 className="h-4 w-4 animate-spin" /> voix Karine…</span>;
  if (phase === 'done')
    return <span className="flex items-center gap-1 text-emerald-600"><Check className="h-4 w-4" /> {msg ?? 'ok'}</span>;
  if (phase === 'skipped')
    return <span className="text-gray-400">{msg ?? 'skip'}</span>;
  if (phase === 'error')
    return <span className="flex items-center gap-1 break-words text-rose-600"><AlertCircle className="h-4 w-4 shrink-0" /> {msg}</span>;
  return <span className="text-gray-300">—</span>;
}
