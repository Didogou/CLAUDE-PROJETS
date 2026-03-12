import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'HERO — Admin',
  description: 'Interface d\'administration du générateur de livres DYEH',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <div style={{ display: 'flex', minHeight: '100vh' }}>
          <aside style={{
            width: '220px',
            background: 'var(--surface)',
            borderRight: '1px solid var(--border)',
            padding: '2rem 1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '2rem',
            flexShrink: 0,
          }}>
            <div>
              <h1 style={{
                fontSize: '1.5rem',
                fontWeight: 'bold',
                color: 'var(--accent)',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
              }}>⚔ HERO</h1>
              <p style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                Administration
              </p>
            </div>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <a href="/" style={navStyle}>📚 Livres</a>
              <a href="/books/new" style={navStyle}>✨ Nouveau livre</a>
            </nav>
          </aside>

          <main style={{ flex: 1, padding: '2rem 2.5rem', overflowY: 'auto' }}>
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}

const navStyle: React.CSSProperties = {
  padding: '0.6rem 0.75rem',
  borderRadius: '6px',
  color: 'var(--foreground)',
  textDecoration: 'none',
  fontSize: '0.9rem',
}
