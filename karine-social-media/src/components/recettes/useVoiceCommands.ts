'use client';

import { useEffect, useRef, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type VoiceCommand = 'next' | 'prev' | 'timer';

/**
 * Commandes vocales (Web Speech API) pour la cuisine mains libres.
 * FR : "suivant / ok / c'est bon / terminé" → next, "précédent / retour"
 * → prev, "minuteur / chrono" → timer.
 *
 * - `enabled` : écoute active.
 * - `muted` : ignore les résultats (ex: pendant que la voix de Karine parle,
 *   pour ne pas s'auto-déclencher) — mais garde la reco vivante.
 * - Best-effort : `supported=false` si le navigateur ne gère pas (iOS souvent).
 */
export function useVoiceCommands({
  enabled,
  muted,
  onCommand,
}: {
  enabled: boolean;
  muted: boolean;
  onCommand: (cmd: VoiceCommand) => void;
}): { supported: boolean; listening: boolean; error: string | null } {
  const recRef = useRef<any>(null);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // Démarre à false (serveur ET 1er rendu client) pour éviter un mismatch
  // d'hydratation, puis détecte le support APRÈS le montage.
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setSupported(
      !!((window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition),
    );
  }, []);

  useEffect(() => {
    if (!enabled || !supported) return;
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'fr-FR';
    rec.continuous = true;
    rec.interimResults = true;
    let stopped = false;

    rec.onresult = (e: any) => {
      // Ignore pendant la narration (anti auto-déclenchement : sinon le
      // micro capterait la voix ElevenLabs dans l'enceinte et la
      // narration peut prononcer "suivant", "après", etc. dans son texte).
      if (mutedRef.current) return;
      const res = e.results[e.results.length - 1];
      const t = String(res?.[0]?.transcript ?? '').toLowerCase();
      // "minuteur/chrono" en premier (sinon "ok" pourrait primer).
      if (/\b(minuteur|chrono|timer)\b/.test(t)) {
        onCommandRef.current('timer');
      } else if (
        /\b(pr[ée]c[ée]dent|pr[ée]c[ée]dente|retour|arri[èe]re|reviens|recule|avant|back|previous)\b/.test(
          t,
        )
      ) {
        onCommandRef.current('prev');
      } else if (
        /\b(suivant|suivante|ok|okay|c'?est bon|c'?est fait|termin[ée]?|finie?|prochaine?|suite|ensuite|apr[èe]s|puis|continue|vas?-?y|allez|go|next|voil[àa])\b/.test(
          t,
        )
      ) {
        // Vocabulaire élargi 2026-06-13 : Karine et ses patientes disent
        // naturellement "et après", "suite", "ensuite", "puis", "voilà",
        // "vas-y" pendant la cuisine. La regex précédente n'en capturait
        // qu'un sous-ensemble (suivant / ok / c'est bon / terminé /
        // prochaine / next), d'où l'impression d'écoute aléatoire.
        onCommandRef.current('next');
      }
    };
    rec.onstart = () => {
      setListening(true);
      setError(null);
    };
    // La reco s'arrête seule régulièrement → on relance tant qu'on est actif.
    rec.onend = () => {
      setListening(false);
      if (!stopped) {
        try {
          rec.start();
        } catch {
          /* déjà démarrée */
        }
      }
    };
    rec.onerror = (e: any) => {
      const err = String(e?.error ?? '');
      // 'not-allowed' / 'service-not-allowed' = permission refusée ;
      // 'audio-capture' = pas de micro. Les autres (no-speech, aborted,
      // network) sont normaux → onend relancera, on ne les affiche pas.
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setError('Micro refusé. Autorise le micro pour ce site dans Chrome.');
        // CRITIQUE : sans ce flag, onend() en cascade va rappeler
        // rec.start() en boucle infinie → Chrome marque la session comme
        // "poisoned" pendant ~30 min → tous les start() suivants
        // échouent même APRÈS correction de la permission. Le user doit
        // alors fermer/relancer Chrome. Bug 2026-06-13.
        stopped = true;
      } else if (err === 'audio-capture') {
        setError('Aucun micro détecté sur cet appareil.');
        stopped = true;
      }
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      /* noop */
    }
    return () => {
      stopped = true;
      try {
        rec.stop();
      } catch {
        /* noop */
      }
      recRef.current = null;
      setListening(false);
    };
  }, [enabled, supported]);

  return { supported, listening, error };
}
