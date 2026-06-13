import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { listVoices } from '@/lib/elevenlabs';

/** GET /api/admin/elevenlabs/voices → { voices: [{ id, name }] } */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const voices = await listVoices();
  return NextResponse.json({ voices });
}
