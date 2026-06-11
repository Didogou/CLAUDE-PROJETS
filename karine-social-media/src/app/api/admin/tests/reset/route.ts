import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { requireAdmin } from '@/lib/admin-guard';

export const runtime = 'nodejs';

const RESULT_FILE = path.join(process.cwd(), 'tests', 'last-run.json');
const STATUS_FILE = path.join(process.cwd(), 'tests', 'last-run.status');

/**
 * POST /api/admin/tests/reset
 *
 * Vide les fichiers status + result. Permet à l'admin de débloquer
 * l'UI quand un run est resté en état "running" éternel (spawn perdu,
 * dev server crashé, etc.).
 */
export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;
  await fs.rm(STATUS_FILE, { force: true }).catch(() => {});
  await fs.rm(RESULT_FILE, { force: true }).catch(() => {});
  return NextResponse.json({ ok: true });
}
