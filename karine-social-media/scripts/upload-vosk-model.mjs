#!/usr/bin/env node
/**
 * Upload du modèle Vosk FR sur Supabase Storage de Karine.
 *
 * Pourquoi : on évite la dépendance externe à ccoreilly.github.io pour le
 * modèle de reconnaissance vocale (cf. memory project_karine_voice_recognition_parked).
 *
 * Utilisation :
 *   node --env-file=.env.local scripts/upload-vosk-model.mjs \
 *     "/c/Users/didie/Downloads/vosk-model-small-fr-pguyot-0.3.tar.gz"
 *
 * Le script :
 *   1. S'assure que le bucket `static-assets` existe (le crée en public sinon)
 *   2. Upload le fichier .tar.gz avec Cache-Control 1 an (immutable)
 *   3. Affiche l'URL publique finale à copier dans useVoskCommands.ts
 *
 * Requiert : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY dans .env.local
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    '❌ Manque NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY (.env.local).',
  );
  process.exit(1);
}

const FILE = process.argv[2];
if (!FILE) {
  console.error(
    'Usage : node --env-file=.env.local scripts/upload-vosk-model.mjs <chemin/fichier.tar.gz>',
  );
  process.exit(1);
}

const BUCKET = 'static-assets';
const PATH = 'vosk/vosk-model-small-fr-pguyot-0.3.tar.gz';

const supabase = createClient(url, key);

// 1. Bucket en public (créé s'il n'existe pas)
const { data: buckets, error: lErr } = await supabase.storage.listBuckets();
if (lErr) {
  console.error('❌ listBuckets:', lErr.message);
  process.exit(1);
}
const exists = buckets?.some((b) => b.name === BUCKET);
if (!exists) {
  console.log(`📦 Création du bucket public "${BUCKET}"…`);
  // Pas de fileSizeLimit explicite : on garde le défaut du projet (le
  // modèle ~44 Mo passe largement sous les limites Supabase Pro/Free).
  // Passer un fileSizeLimit > limite serveur fait échouer la création.
  const { error: cErr } = await supabase.storage.createBucket(BUCKET, {
    public: true,
  });
  if (cErr) {
    console.error('❌ createBucket:', cErr.message);
    process.exit(1);
  }
  console.log(`✅ Bucket "${BUCKET}" créé.`);
} else {
  console.log(`📦 Bucket "${BUCKET}" déjà présent.`);
}

// 2. Upload avec Cache-Control 1 an (immutable : le contenu d'un modèle
// donné ne change jamais — si on update le modèle, on change le path).
const buf = readFileSync(FILE);
const mb = (buf.length / 1024 / 1024).toFixed(1);
console.log(`📤 Upload ${mb} Mo vers ${BUCKET}/${PATH}…`);
const { error: uErr } = await supabase.storage
  .from(BUCKET)
  .upload(PATH, buf, {
    // Supabase SDK n'accepte qu'une valeur numérique en secondes (string),
    // pas la syntaxe HTTP complète "31536000, immutable". 1 an = 31536000 s.
    cacheControl: '31536000',
    contentType: 'application/gzip',
    upsert: true, // permet de relancer le script sans erreur
  });
if (uErr) {
  console.error('❌ upload:', uErr.message);
  process.exit(1);
}

// 3. URL publique
const {
  data: { publicUrl },
} = supabase.storage.from(BUCKET).getPublicUrl(PATH);

console.log('');
console.log('✅ Upload OK');
console.log('');
console.log('URL publique à copier dans MODEL_URL :');
console.log(`   ${publicUrl}`);
console.log('');
