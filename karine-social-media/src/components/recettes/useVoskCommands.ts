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
} {
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    let model: Model | null = null;
    let recognizer: KaldiRecognizer | null = null;
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let recognizerNode: ScriptProcessorNode | null = null;
    let lastDispatchedText = '';
    let lastDispatchedAt = 0;

    async function init() {
      try {
        setLoading(true);
        setError(null);

        // Import dynamique : vosk-browser pèse + a du WASM, ne pas
        // l'embarquer dans le bundle initial. Lazy load au moment où
        // l'utilisatrice active "Mains libres".
        const { createModel } = await import('vosk-browser');
        model = await createModel(MODEL_URL);
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
        const msg = String((e as Error)?.message ?? e ?? '');
        if (/permission|denied|not[- ]allowed/i.test(msg)) {
          setError('Micro refusé. Autorise le micro pour ce site.');
        } else if (/network|fetch|load|model/i.test(msg)) {
          setError(
            'Impossible de charger le modèle vocal (vérifier la connexion).',
          );
        } else {
          setError('Reconnaissance vocale indisponible sur cet appareil.');
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
      try {
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

  return { supported, listening, error, loading };
}
