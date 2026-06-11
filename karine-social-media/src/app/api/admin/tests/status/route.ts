import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { requireAdmin } from '@/lib/admin-guard';

export const runtime = 'nodejs';

const RESULT_FILE = path.join(process.cwd(), 'tests', 'last-run.json');
const STATUS_FILE = path.join(process.cwd(), 'tests', 'last-run.status');

/**
 * GET /api/admin/tests/status
 *
 * Renvoie l'état du dernier run + le rapport JSON Playwright si dispo.
 * Polling depuis la page admin /admin/tests.
 */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  let status: unknown = null;
  let result: unknown = null;
  try {
    const raw = await fs.readFile(STATUS_FILE, 'utf-8');
    status = JSON.parse(raw);
  } catch {
    // pas encore de run
  }
  try {
    const raw = await fs.readFile(RESULT_FILE, 'utf-8');
    result = JSON.parse(raw);
  } catch {
    // pas encore de résultat
  }
  return NextResponse.json({ status, result });
}
