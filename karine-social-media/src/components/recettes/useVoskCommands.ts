'use client';

import { useEffect, useRef, useState } from 'react';
import type { Model, KaldiRecognizer } from 'vosk-browser';

/**
 * Reconnaissance vocale **100 % locale** via Vosk (WASM dans un Web Worker).
 *
 * Pourquoi Vosk plutôt que webkitSpeechRecognition ?
 *  - Aucun audio ne quitte l'appareil → conforme CNIL by-design (vs
 *    Web Speech API qui streame chez Google sans documentation).
 *  - Pas de bip "activation micro" système toutes les ~30 s (le bip
 *    Chrome se déclenche au démarrage du SR, Vosk reste en flux continu).
 *  - Marche hors-ligne une fois le modèle téléchargé+caché.
 *  - Pas de gap de re-démarrage → moins de commandes ratées.
 *
 * Contrepartie : 1er chargement = ~40 Mo de modèle à télécharger
 * (cache navigateur 1 an ensuite). On affiche un état `loading` à
 * l'utilisatrice pendant ce temps.
 *
 * Drop-in remplacement de useVoiceCommands : même API, + `loading`.
 */

export type VoiceCommand = 'next' | 'prev' | 'timer';

// Modèle FR small (~44 Mo) hébergé sur le Supabase Storage de Karine
// (bucket public `static-assets`). Cache-Control 1 an immutable : le
// modèle est DL une seule fois par l'utilisatrice, puis servi depuis le
// cache navigateur indéfiniment. Migration depuis ccoreilly.github.io
// faite le 2026-06-13 pour ne plus dépendre d'un tiers.
//
// Pour mettre à jour le modèle : upload une NOUVELLE version sous un
// path différent (ex: vosk-model-small-fr-0.4.tar.gz) plutôt qu'écraser
// — le cache navigateur immutable garderait sinon l'ancienne version.
const MODEL_URL =
  'https://umjdqwjgccodmjummoga.supabase.co/storage/v1/object/public/static-assets/vosk/vosk-model-small-fr-pguyot-0.3.tar.gz';

// Sample rate fixe 16 kHz, recommandé par Vosk pour la qualité/taille modèle.
const SAMPLE_RATE = 16000;

// Buffer audio anti-double-fire : Vosk peut renvoyer 2 fois le même
// résultat final dans une fenêtre courte. On dédup sur 1,5 s.
const DEDUP_WINDOW_MS = 1500;

/**
 * Télécharge un fichier en streaming avec callback de progression.
 * On préfère faire le fetch ici (et pas dans vosk-browser) pour :
 *   1. Afficher une vraie barre de progression à l'utilisatrice
 *   2. Bénéficier du Service Worker (cache-first pour le modèle Vosk)
 *   3. Voir les erreurs HTTP en clair (vs vosk-browser qui logge dans
 *      un Worker invisible)
 *
 * Retourne un blob URL utilisable par vosk-browser comme s'il s'agissait
 * du fichier distant (fetch local instantané, pas de second DL).
 */
async function fetchModelWithProgress(
  url: string,
  onProgress: (ratio: number) => void,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} sur le modèle vocal`);
  }
  const total = Number(response.headers.get('Content-Length') ?? 0);
  if (!response.body || !total) {
    // Pas de body streamable ou pas de Content-Length (le SW peut le
    // strip quand il sert depuis Cache API). Fallback : DL d'un bloc.
    const blob = await response.blob();
    onProgress(1);
    return URL.createObjectURL(blob);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (signal.aborted) {
      reader.cancel().catch(() => {});
      throw new DOMException('Aborted', 'AbortError');
    }
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded / total);
  }
  const blob = new Blob(chunks as BlobPart[], { type: 'application/gzip' });
  return URL.createObjectURL(blob);
}

export function useVoskCommands({
  enabled,
  muted,
  onCommand,
}: {
  enabled: boolean;
  muted: boolean;
  onCommand: (cmd: VoiceCommand) => void;
}): {
  supported: boolean;
  listening: boolean;
  error: string | null;
  /** True pendant le DL+init du modèle (5-30 s au 1er chargement). */
  loading: boolean;
  /** Progression du DL du modèle (0 à 1). 0 = pas commencé, 1 = terminé. */
  loadProgress: number;
} {
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);

  // Support : Web Worker + AudioContext + getUserMedia (vérifié au mount).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ok =
      typeof Worker !== 'undefined' &&
      typeof AudioContext !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia;
    setSupported(ok);
  }, []);

  useEffect(() => {
    if (!enabled || !supported) return;

    let cancelled = false;
    const abortController = new AbortController();
    let model: Model | null = null;
    let recognizer: KaldiRecognizer | null = null;
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let recognizerNode: ScriptProcessorNode | null = null;
    let blobUrl: string | null = null;
    let lastDispatchedText = '';
    let lastDispatchedAt = 0;

    async function init() {
      try {
        setLoading(true);
        setError(null);
        setLoadProgress(0);

        // 1. DL streamé du modèle avec progression visible. Le Service
        // Worker (public/sw.js) intercepte et sert depuis Cache API si
        // déjà téléchargé une fois → instantané au 2e usage.
        // On log explicitement les étapes pour faciliter le debug
        // ("ça ne télécharge pas" est silencieux sinon).
        console.log('[vosk] début DL modèle:', MODEL_URL);
        blobUrl = await fetchModelWithProgress(
          MODEL_URL,
          (ratio) => {
            if (!cancelled) setLoadProgress(ratio);
          },
          abortController.signal,
        );
        console.log('[vosk] modèle DL terminé, init vosk-browser…');
        if (cancelled) {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          return;
        }

        // 2. Lazy import vosk-browser (WASM + worker), puis init avec
        // l'URL blob locale (pas de second DL).
        const { createModel } = await import('vosk-browser');
        model = await createModel(blobUrl);
        // Le modèle est désormais chargé en mémoire du worker, on peut
        // libérer le blob URL (référencer une URL révoquée ne plante pas).
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
        console.log('[vosk] modèle Vosk prêt');
        if (cancelled) {
          model?.terminate();
          return;
        }

        recognizer = new model.KaldiRecognizer(SAMPLE_RATE);

        // On dispatch UNIQUEMENT sur résultats finaux ('result'), pas
        // sur les 'partialresult' : Vosk envoie un partial à chaque
        // syllabe ("s" → "sui" → "suivant"), ce qui matche plusieurs
        // fois la regex et déclencherait next plusieurs fois pour 1 mot.
        // Le compromis : ~300-500 ms de latence après la fin du mot.
        recognizer.on('result', (msg) => {
          if (msg.event !== 'result') return;
          if (mutedRef.current) return;
          const text = String(msg.result?.text ?? '').toLowerCase();
          if (!text) return;

          // Anti-doublon : si Vosk re-renvoie le même text dans 1,5 s,
          // on ignore (peut arriver après un long silence où il fait
          // un "flush" du buffer interne).
          const now = Date.now();
          if (text === lastDispatchedText && now - lastDispatchedAt < DEDUP_WINDOW_MS) {
            return;
          }
          lastDispatchedText = text;
          lastDispatchedAt = now;

          dispatchCommand(text);
        });

        // Demande le micro avec les params recommandés Vosk.
        // echoCancellation + noiseSuppression aident énormément en
        // cuisine (hotte, robot, four, etc.).
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1,
            sampleRate: SAMPLE_RATE,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        // Pipeline audio : MediaStream → AudioContext → ScriptProcessor
        //   → recognizer.acceptWaveform.
        //
        // ScriptProcessorNode est déprécié au profit d'AudioWorklet, mais
        // la doc vosk-browser le préconise encore (l'AudioWorklet exige
        // de servir un fichier .js séparé pour le worklet, plus
        // contraignant à intégrer Next.js). Fonctionne toujours en 2026
        // sur tous les navigateurs cibles.
        audioContext = new AudioContext();
        recognizerNode = audioContext.createScriptProcessor(4096, 1, 1);
        recognizerNode.onaudioprocess = (event) => {
          if (mutedRef.current) return;
          try {
            recognizer?.acceptWaveform(event.inputBuffer);
          } catch {
            /* frame perdue, pas grave, la suivante passera */
          }
        };
        source = audioContext.createMediaStreamSource(stream);
        source.connect(recognizerNode);
        // ScriptProcessor doit être connecté à destination pour que
        // onaudioprocess soit appelé (limitation de l'API).
        recognizerNode.connect(audioContext.destination);

        setLoading(false);
        setListening(true);
      } catch (e) {
        if (cancelled) return;
        setLoading(false);
        setListening(false);
        // Log explicite : on ne masque PAS l'erreur originale, c'est
        // essentiel pour diagnostiquer en prod ("ne télécharge pas").
        console.error('[vosk] init failed:', e);
        const msg = String((e as Error)?.message ?? e ?? '');
        if (/permission|denied|not[- ]allowed/i.test(msg)) {
          setError('Micro refusé. Autorise le micro pour ce site.');
        } else if (/HTTP|network|fetch|load|model|connect/i.test(msg)) {
          setError(
            `Impossible de charger le modèle vocal. Détail : ${msg.slice(0, 80)}`,
          );
        } else {
          setError(`Reconnaissance vocale indisponible. Détail : ${msg.slice(0, 80)}`);
        }
      }
    }

    init();

    // Cleanup complet : libère le micro, ferme l'AudioContext, termine
    // le Worker Vosk. Sans ça : fuite de RAM + le voyant micro système
    // (Android, macOS) reste allumé même après avoir désactivé "Mains
    // libres" → l'utilisatrice peut croire qu'on continue à écouter.
    return () => {
      cancelled = true;
      abortController.abort();
      try {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        recognizerNode?.disconnect();
        source?.disconnect();
        if (audioContext && audioContext.state !== 'closed') {
          audioContext.close().catch(() => {});
        }
        stream?.getTracks().forEach((t) => t.stop());
        recognizer?.remove();
        model?.terminate();
      } catch {
        /* noop */
      }
      setListening(false);
    };
  }, [enabled, supported]);

  function dispatchCommand(text: string) {
    // Ordre : timer en premier (sinon "ok" pourrait primer), puis prev
    // (mots plus spécifiques), puis next (qui a le vocabulaire le plus large).
    if (/\b(minuteur|chrono|timer)\b/.test(text)) {
      onCommandRef.current('timer');
    } else if (
      /\b(pr[ée]c[ée]dent|pr[ée]c[ée]dente|retour|arri[èe]re|reviens|recule|avant|back|previous)\b/.test(
        text,
      )
    ) {
      onCommandRef.current('prev');
    } else if (
      /\b(suivant|suivante|ok|okay|c'?est bon|c'?est fait|termin[ée]?|finie?|prochaine?|suite|ensuite|apr[èe]s|puis|continue|vas?-?y|allez|go|next|voil[àa])\b/.test(
        text,
      )
    ) {
      onCommandRef.current('next');
    }
  }

  return { supported, listening, error, loading, loadProgress };
}
