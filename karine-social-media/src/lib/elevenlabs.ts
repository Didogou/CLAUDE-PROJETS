import 'server-only';

const API_BASE = 'https://api.elevenlabs.io/v1';

// Réglages voix — plus DOUX et plus POSÉ que le neutre (inspiré de Hero) :
//  - stability 0.5 : lecture chaleureuse/vivante (ni monotone, ni erratique)
//  - similarity_boost 0.85 : fidèle à la voix clonée de Karine
//  - style 0.15 : une touche de chaleur (pas plat)
//  - use_speaker_boost : rend la voix plus présente/ronde
//  - speed 0.85 : débit ralenti → plus de respiration entre les phrases
const VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.85,
  style: 0.15,
  use_speaker_boost: true,
  speed: 0.85,
} as const;

/**
 * Normalise le texte d'une étape pour une lecture TTS propre :
 *  - expanse les abréviations mal lues ("min" → "minutes", "°C" → "degrés") ;
 *  - garantit une ponctuation finale (le ton marque la fin de phrase).
 * PAS de « … » en tête : ElevenLabs le vocalise (« hein… ») au lieu d'une pause.
 */
export function normalizeForSpeech(text: string): string {
  let t = text.trim();
  // Degrés : "180°C" / "180 °C" → "180 degrés"
  t = t.replace(/(\d+)\s*°\s*c\b/gi, '$1 degrés');
  t = t.replace(/°\s*c\b/gi, ' degrés');
  // Minutes : "5 min" / "5 min." → "5 minutes" (singulier si 1)
  t = t.replace(/(\d+)\s*min\b\.?/gi, (_m, n: string) =>
    `${n} ${Number(n) === 1 ? 'minute' : 'minutes'}`,
  );
  // Secondes abrégées éventuelles : "30 sec" → "30 secondes"
  t = t.replace(/(\d+)\s*sec\b\.?/gi, (_m, n: string) =>
    `${n} ${Number(n) === 1 ? 'seconde' : 'secondes'}`,
  );
  // Ponctuation finale → intonation de fin de phrase claire.
  if (!/[.!?]$/.test(t)) t += '.';
  return t;
}

export type ElevenVoice = { id: string; name: string };

/**
 * Liste les voix du compte ElevenLabs (pour le sélecteur admin).
 * Renvoie [] si la clé est absente ou l'appel échoue (non bloquant).
 */
export async function listVoices(): Promise<ElevenVoice[]> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch(`${API_BASE}/voices`, {
      headers: { 'xi-api-key': apiKey },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      voices?: { voice_id: string; name: string }[];
    };
    return (data.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name }));
  } catch {
    return [];
  }
}

/**
 * Text-to-Speech ElevenLabs en REST (pas de SDK, pas de dépendance).
 *
 * Env requis :
 *   - ELEVENLABS_API_KEY  : clé API du compte ElevenLabs
 * Voix : `voiceId` en param (sélecteur admin), sinon fallback
 *   ELEVENLABS_VOICE_ID.
 *
 * Modèle `eleven_multilingual_v2` → bon rendu français. Retourne le mp3.
 */
export async function textToSpeech(
  text: string,
  voiceId?: string,
): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voice = voiceId?.trim() || process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY manquant (.env.local)');
  if (!voice) throw new Error('Aucune voix sélectionnée (ni ELEVENLABS_VOICE_ID)');

  if (!text.trim()) throw new Error('Texte vide');
  // Normalisation : abréviations expansées + ponctuation finale. PAS de
  // « … » en tête (ElevenLabs le lisait « hein… »).
  const spoken = normalizeForSpeech(text);

  const res = await fetch(`${API_BASE}/text-to-speech/${voice}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: spoken,
      model_id: 'eleven_multilingual_v2',
      output_format: 'mp3_44100_128',
      voice_settings: VOICE_SETTINGS,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
