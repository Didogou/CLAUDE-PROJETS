import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { requireAdmin } from '@/lib/admin-guard';

export const runtime = 'nodejs';
// Permettre 5 minutes de run (Vercel limite par défaut)
export const maxDuration = 300;

const RESULT_FILE = path.join(process.cwd(), 'tests', 'last-run.json');
const STATUS_FILE = path.join(process.cwd(), 'tests', 'last-run.status');

/**
 * POST /api/admin/tests/run
 *
 * Spawn `npx playwright test --reporter=json`, écrit le résultat dans
 * tests/last-run.json et l'état dans tests/last-run.status (running →
 * done|failed). La page admin poll status pour mettre à jour l'UI.
 *
 * ⚠️ Marche en dev LOCAL UNIQUEMENT — Vercel serverless ne sait pas
 * spawner un browser. Pour la prod, lance les tests depuis GitHub
 * Actions (cf. .github/workflows/e2e.yml).
 */
export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;

  // Mutex : refuse de spawn 2 runs en parallèle (résultat corrompu).
  try {
    const existing = await fs.readFile(STATUS_FILE, 'utf-8');
    const prev = JSON.parse(existing) as { status?: string };
    if (prev.status === 'running') {
      return NextResponse.json(
        {
          error:
            'Un run est déjà en cours. Attends sa fin ou clique « Reset » si tu sais qu\'il est figé.',
        },
        { status: 409 },
      );
    }
  } catch {
    /* pas de fichier = pas de run précédent */
  }

  // Vide le résultat précédent pour éviter l'affichage fantôme
  // pendant que le nouveau run tourne.
  await fs.writeFile(RESULT_FILE, '{}').catch(() => {});
  // Marque l'état "running"
  await fs.writeFile(
    STATUS_FILE,
    JSON.stringify({ status: 'running', startedAt: new Date().toISOString() }),
  );

  // Spawn detaché : on ne bloque PAS la réponse HTTP.
  // shell: false pour éviter toute interprétation de PATH (sécurité).
  // Le résultat est lu via /api/admin/tests/status.
  const proc = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['playwright', 'test', '--reporter=json', '--project=chromium'],
    {
      cwd: process.cwd(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  // proc.on('error') = spawn échoué (npx introuvable, etc.) — sans
  // ça l'UI reste en "running" éternellement.
  proc.on('error', async (err) => {
    console.error('[tests/run] spawn error:', err);
    try {
      await fs.writeFile(
        STATUS_FILE,
        JSON.stringify({
          status: 'failed',
          exitCode: -1,
          finishedAt: new Date().toISOString(),
          stderr: `Spawn échoué : ${err.message}`,
        }),
      );
    } catch {
      /* */
    }
  });

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  proc.on('close', async (code) => {
    try {
      await fs.writeFile(RESULT_FILE, stdout || '{}');
      await fs.writeFile(
        STATUS_FILE,
        JSON.stringify({
          status: code === 0 ? 'done' : 'failed',
          exitCode: code,
          finishedAt: new Date().toISOString(),
          stderr: stderr.slice(-2000), // garde les 2 derniers ko d'erreur
        }),
      );
    } catch (e) {
      console.error('[tests/run] write result failed:', e);
    }
  });

  return NextResponse.json({ ok: true, status: 'started' });
}
