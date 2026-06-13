/**
 * Helpers cuisine guidée (client) : détection de durée dans une étape,
 * formatage du minuteur, bip de fin.
 */

/**
 * Extrait une durée en SECONDES depuis le texte d'une étape.
 * Gère "45 min", "10 minutes", "1 h", "1h30", "2 heures". Renvoie la PLUS
 * LONGUE durée trouvée (= généralement la cuisson, celle qui mérite un
 * minuteur), ou null si aucune.
 */
export function parseTimerSeconds(text: string): number | null {
  let best = 0;
  // Heures (+ minutes éventuelles : "1h30", "1 h 30", "2 heures")
  const h = text.match(/(\d+)\s*h(?:eures?)?\s*(\d{1,2})?\b/i);
  if (h) {
    const hours = Number(h[1]);
    const mins = h[2] ? Number(h[2]) : 0;
    best = Math.max(best, hours * 3600 + mins * 60);
  }
  // Minutes : "45 min", "10 minutes"
  const m = text.match(/(\d+)\s*min(?:ute)?s?\b/i);
  if (m) best = Math.max(best, Number(m[1]) * 60);
  return best > 0 ? best : null;
}

/** Durée lisible : "M:SS" ou "H:MM:SS". */
export function formatTimer(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

/**
 * Extrait une température de cuisson du texte d'une étape.
 * Gère "180°C", "180 °C", "210 degrés", "th. 6", "thermostat 6/7".
 * Renvoie un libellé prêt à afficher ("180 °C", "Th. 6") ou null.
 */
export function parseTemperature(text: string): string | null {
  const c = text.match(/(\d{2,3})\s*°?\s*(?:c\b|celsius|degr[ée]s?)/i);
  if (c) return `${c[1]} °C`;
  const deg = text.match(/(\d{2,3})\s*°(?!\s*[cf])/i);
  if (deg) return `${deg[1]} °C`;
  const th = text.match(/th(?:ermostat)?\.?\s*(\d(?:\s*[/-]\s*\d)?)/i);
  if (th) return `Th. ${th[1].replace(/\s+/g, '')}`;
  return null;
}

/** Libellé court d'une durée pour un bouton ("45 min", "1 h 30"). */
export function durationLabel(totalSec: number): string {
  const m = Math.round(totalSec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest > 0 ? `${h} h ${rest}` : `${h} h`;
}

/**
 * Bips de fin de minuteur + vibration. Sonne pendant 10 SECONDES, un bip
 * par seconde (10 bips au total), pour ne pas rater l'alerte si Karine est
 * loin du téléphone. Retourne une fonction pour stopper la séquence (appelée
 * par les boutons Stop / +1 min du widget timer).
 *
 * Best-effort : si l'AudioContext ou la vibration n'est pas dispo (mode strict
 * privacy, navigateur exotique), on échoue silencieusement — le visuel
 * "⏰ Terminé" du badge suffit comme fallback.
 */
export function timerAlert(): () => void {
  const REPEATS = 10;
  const INTERVAL_MS = 1000;
  let stopped = false;
  const cancels: Array<() => void> = [];

  // ─── Vibration : 1 vibration de 300 ms par seconde pendant 10 s ───
  // navigator.vibrate ne sait pas répéter un pattern, on programme 10
  // setTimeout indépendants qu'on peut clear individuellement.
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([300]); // 1er bip immédiat
      for (let i = 1; i < REPEATS; i++) {
        const id = setTimeout(() => {
          if (!stopped) navigator.vibrate?.([300]);
        }, i * INTERVAL_MS);
        cancels.push(() => clearTimeout(id));
      }
    }
  } catch {
    /* noop */
  }

  // ─── Audio : 10 oscillateurs courts programmés sur la timeline ctx ───
  // On programme TOUS les bips en une fois sur l'AudioContext, qui les
  // joue à l'heure prévue même si le JS est busy. Pour stopper, on close()
  // le ctx → tous les oscillateurs futurs sont coupés net.
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    for (let i = 0; i < REPEATS; i++) {
      const offset = i * (INTERVAL_MS / 1000);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, ctx.currentTime + offset);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.3);
      o.start(ctx.currentTime + offset);
      o.stop(ctx.currentTime + offset + 0.3);
    }
    // Libère l'AudioContext après la fin naturelle (10 s + petit buffer).
    const closeId = setTimeout(() => {
      ctx.close().catch(() => {});
    }, REPEATS * INTERVAL_MS + 500);
    cancels.push(() => clearTimeout(closeId));
    cancels.push(() => {
      ctx.close().catch(() => {});
    });
  } catch {
    /* audio indispo : la vibration + le visuel suffisent */
  }

  return () => {
    if (stopped) return;
    stopped = true;
    cancels.forEach((fn) => {
      try {
        fn();
      } catch {
        /* noop */
      }
    });
  };
}
