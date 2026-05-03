import { NextRequest, NextResponse } from 'next/server'
import { spawn, exec, type ChildProcess } from 'node:child_process'
import * as net from 'node:net'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// ── Définition des services contrôlables ────────────────────────────────────

interface ServiceDef {
  label: string
  port: number
  cwd: string
  cmd: string
  args: string[]
  /** Ligne descriptive pour la doc */
  description: string
}

const SERVICES: Record<string, ServiceDef> = {
  comfyui: {
    label: 'ComfyUI',
    port: 8188,
    cwd: 'C:\\Users\\didie\\Documents\\Projets\\CLAUDE-PROJETS\\ComfyUI',
    cmd: 'C:\\Users\\didie\\Documents\\Projets\\CLAUDE-PROJETS\\ComfyUI\\venv\\Scripts\\python.exe',
    args: ['main.py'],
    description: 'Génération images & vidéos (Stable Diffusion + Wan + LoRAs)',
  },
  rembg: {
    label: 'rembg',
    port: 8189,
    cwd: 'C:\\Users\\didie\\Documents\\Projets\\CLAUDE-PROJETS\\ComfyUI',
    cmd: 'C:\\Users\\didie\\Documents\\Projets\\CLAUDE-PROJETS\\ComfyUI\\venv\\Scripts\\python.exe',
    args: ['rembg_server.py'],
    description: 'Détourage automatique + fond gris pour portraits PNJ',
  },
  kohya: {
    label: 'Kohya_ss',
    port: 7860,
    cwd: 'C:\\Users\\didie\\Documents\\Projets\\CLAUDE-PROJETS\\ComfyUI\\kohya_ss',
    cmd: 'C:\\Users\\didie\\Documents\\Projets\\CLAUDE-PROJETS\\ComfyUI\\kohya_ss\\gui.bat',
    args: [],
    description: 'Entraînement de LoRAs personnalisés (optionnel)',
  },
}

// ── État global (singleton module-level) ────────────────────────────────────
// Tracking des PIDs des process spawnés DEPUIS l'admin. Si le service tourne
// déjà (lancé manuellement avant), on connait le port mais pas le PID.

interface RunningProcess {
  pid: number
  startedAt: number
  child?: ChildProcess
  /** Buffer circulaire des dernières lignes stdout/stderr (pour log preview) */
  recentLogs: string[]
}

// Persisté à travers les hot-reloads de Next.js dev via globalThis
declare global {
  // eslint-disable-next-line no-var
  var __HERO_SERVICES_STATE: Record<string, RunningProcess> | undefined
}

const state: Record<string, RunningProcess> = globalThis.__HERO_SERVICES_STATE ?? {}
globalThis.__HERO_SERVICES_STATE = state

const MAX_LOG_LINES = 80

// ── Helpers ────────────────────────────────────────────────────────────────

function checkPort(port: number, host = '127.0.0.1', timeoutMs = 1500): Promise<boolean> {
  return new Promise(resolve => {
    const sock = new net.Socket()
    let resolved = false
    const done = (ok: boolean) => {
      if (resolved) return
      resolved = true
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
    sock.connect(port, host)
  })
}

function killProcessTreeWindows(pid: number): Promise<void> {
  return new Promise(resolve => {
    exec(`taskkill /PID ${pid} /T /F`, () => resolve())
  })
}

// ── GET : statut de tous les services ──────────────────────────────────────

export async function GET() {
  try {
    const out = await Promise.all(
      Object.entries(SERVICES).map(async ([name, def]) => {
        let running = false
        try {
          running = await checkPort(def.port)
        } catch (e) {
          console.warn(`[system] checkPort ${def.port} failed:`, e)
        }
        const tracked = state[name]
        return {
          name,
          label: def.label,
          port: def.port,
          description: def.description,
          running,
          managed: !!tracked,
          pid: tracked?.pid,
          uptime_ms: tracked ? Date.now() - tracked.startedAt : null,
          recent_logs: tracked?.recentLogs.slice(-30) ?? [],
        }
      }),
    )
    return NextResponse.json({ services: out })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[system/services GET] error:', msg)
    return NextResponse.json({ error: msg, services: [] }, { status: 500 })
  }
}

// ── POST : start / stop ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { action: 'start' | 'stop'; service: string }
  const def = SERVICES[body.service]
  if (!def) return NextResponse.json({ error: `Service inconnu: ${body.service}` }, { status: 400 })

  if (body.action === 'start') {
    // Déjà actif sur le port ?
    const isUp = await checkPort(def.port)
    if (isUp) {
      return NextResponse.json({ ok: true, alreadyRunning: true, message: `${def.label} déjà actif sur le port ${def.port}` })
    }
    try {
      console.log(`[system] Starting ${def.label} : ${def.cmd} ${def.args.join(' ')} (cwd=${def.cwd})`)
      // .bat / .cmd nécessitent shell:true sur Windows (EINVAL sinon)
      const isBatch = /\.(bat|cmd)$/i.test(def.cmd)
      const child = spawn(def.cmd, def.args, {
        cwd: def.cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: isBatch,
      })
      const proc: RunningProcess = {
        pid: child.pid ?? -1,
        startedAt: Date.now(),
        child,
        recentLogs: [],
      }
      const pushLog = (line: string) => {
        proc.recentLogs.push(line)
        if (proc.recentLogs.length > MAX_LOG_LINES) {
          proc.recentLogs.splice(0, proc.recentLogs.length - MAX_LOG_LINES)
        }
      }
      child.stdout?.on('data', (chunk: Buffer) => {
        chunk.toString('utf-8').split('\n').forEach(l => l.trim() && pushLog(l))
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        chunk.toString('utf-8').split('\n').forEach(l => l.trim() && pushLog(`[err] ${l}`))
      })
      child.on('exit', code => {
        pushLog(`[exited] code=${code}`)
        // Garde l'entrée pour les logs mais marque comme arrêté
        if (state[body.service]?.pid === proc.pid) {
          delete state[body.service]
        }
      })
      child.unref() // détache du process Next.js
      state[body.service] = proc
      return NextResponse.json({ ok: true, pid: proc.pid, message: `${def.label} démarré (PID ${proc.pid})` })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `Start failed: ${msg}` }, { status: 500 })
    }
  }

  if (body.action === 'stop') {
    const tracked = state[body.service]
    if (!tracked) {
      return NextResponse.json({
        error: `${def.label} n'a pas été lancé depuis l'admin (PID inconnu). Arrête-le manuellement dans son terminal.`,
      }, { status: 400 })
    }
    try {
      await killProcessTreeWindows(tracked.pid)
      delete state[body.service]
      return NextResponse.json({ ok: true, message: `${def.label} arrêté` })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `Stop failed: ${msg}` }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'action doit être start | stop' }, { status: 400 })
}
