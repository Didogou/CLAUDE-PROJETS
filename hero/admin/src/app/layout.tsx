import type { Metadata } from 'next'
import './globals.css'
import SystemServicesWidget from '@/components/SystemServicesWidget'

export const metadata: Metadata = {
  title: 'HERO — Admin',
  description: 'Interface d\'administration du générateur de livres DYEH',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" {...{ antidoteapi_jsconnect: 'true' } as any}>
      <head />
      <body>
        <div style={{ display: 'flex', minHeight: '100vh', background: '#0d0d0d' }}>
          {/* Icon rail (caché temporairement — décommenter pour restaurer) */}
          {/*
          <aside style={{
            width: '60px', background: '#111', borderRight: '1px solid #222',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '1rem 0', gap: '0.5rem', flexShrink: 0, zIndex: 10,
          }}>
            <a href="/" title="HERO" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', borderRadius: '8px', color: '#d4a84c', fontSize: '1.2rem', textDecoration: 'none', marginBottom: '0.5rem', fontWeight: 'bold' }}>⚔</a>
            <div style={{ width: '32px', height: '1px', background: '#333', margin: '0.25rem 0' }} />
            <a href="/projects" title="Projets" style={railIcon}>🗂</a>
            <a href="/projects/new" title="Nouveau projet" style={railIcon}>✨</a>
            <div style={{ flex: 1 }} />
          </aside>
          */}
          <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {children}
          </main>
        </div>
        {/* Widget flottant pour démarrer/arrêter ComfyUI, rembg, Kohya */}
        <SystemServicesWidget />
      </body>
    </html>
  )
}

const railIcon: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: '40px', height: '40px', borderRadius: '8px',
  color: '#888', fontSize: '1.1rem', textDecoration: 'none',
  transition: 'background 0.15s, color 0.15s',
}
