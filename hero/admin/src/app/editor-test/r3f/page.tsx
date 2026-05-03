'use client'
/**
 * POC React Three Fiber — scènes 3D React déclaratives.
 * URL : http://localhost:3000/editor-test/r3f
 *
 * Cas d'usage Hero : panorama 360° interactif (déjà partiellement avec
 * Pano360Viewer), objets 3D dans la scène (item rotatif sur fiche objet,
 * carte 3D du monde…), effets shader custom.
 *
 * Stack : @react-three/fiber (renderer React) + @react-three/drei (helpers).
 * Three.js déjà installé (r184) — on l'utilise tel quel ici (pas vanta).
 */

import React, { useRef, useState, Suspense } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment, useTexture, Sphere, Box, Float } from '@react-three/drei'
import * as THREE from 'three'

type DemoKey = 'spinning_cube' | 'pano_360' | 'item_showcase'

const DEMO_LABELS: Record<DemoKey, string> = {
  spinning_cube: '📦 Cube rotatif (basique)',
  pano_360: '🌐 Panorama 360° interactif',
  item_showcase: '💎 Item showcase (Float + Env)',
}

export default function R3FTestPage() {
  const [demoKey, setDemoKey] = useState<DemoKey>('item_showcase')
  const [autoRotate, setAutoRotate] = useState(true)

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          POC React Three Fiber — scènes 3D React
        </h1>
        <p style={{ color: '#9898b4', fontSize: 13, marginBottom: 16 }}>
          3 démos : cube basique (sanity check WebGL), panorama 360° (alternative
          à Pano360Viewer maison), item showcase (float + environment lighting).
          <strong style={{ color: '#d4a84c' }}> Drag pour orbiter</strong>, scroll pour zoomer.
        </p>

        {/* Stage */}
        <div style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16/9',
          background: '#000',
          border: '1px solid #2a2a30',
          borderRadius: 8,
          marginBottom: 16,
          overflow: 'hidden',
        }}>
          <Canvas
            camera={{ position: [0, 0, demoKey === 'pano_360' ? 0.1 : 5], fov: 60 }}
            gl={{ antialias: true }}
          >
            <Suspense fallback={null}>
              {demoKey === 'spinning_cube' && <SpinningCubeDemo autoRotate={autoRotate} />}
              {demoKey === 'pano_360' && <Pano360Demo />}
              {demoKey === 'item_showcase' && <ItemShowcaseDemo />}
            </Suspense>
            <OrbitControls
              enableZoom={demoKey !== 'pano_360' || true}
              enablePan={demoKey !== 'pano_360'}
              autoRotate={autoRotate && demoKey !== 'pano_360'}
              autoRotateSpeed={0.8}
              // Pano 360 : on inverse pour que drag = "tourner la tête" (POV)
              reverseOrbit={demoKey === 'pano_360'}
            />
          </Canvas>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <Section title="Démo">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(Object.keys(DEMO_LABELS) as DemoKey[]).map(k => (
                <button
                  key={k}
                  onClick={() => setDemoKey(k)}
                  style={{ ...btnStyle, background: demoKey === k ? '#EC4899' : '#1a1a1e' }}
                >
                  {DEMO_LABELS[k]}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Contrôle">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#ede9df', cursor: 'pointer' }}>
              <input type="checkbox" checked={autoRotate} onChange={e => setAutoRotate(e.target.checked)} disabled={demoKey === 'pano_360'} />
              Auto-rotation
            </label>
          </Section>

          <Section title="À évaluer">
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#9898b4', lineHeight: 1.7 }}>
              <li>API React déclarative (vs three.js impératif)</li>
              <li>drei = lib de helpers (Sphere/Box/Float/Env/OrbitControls/…)</li>
              <li>Bundle ~150 kb (three déjà inclus pour Pano360Viewer)</li>
              <li>Suspense pour textures async</li>
              <li>Cas d&apos;usage Hero : item showcase, pano 360 réécrit</li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  )
}

// ── Démos individuelles ─────────────────────────────────────────────────

function SpinningCubeDemo({ autoRotate }: { autoRotate: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null)
  useFrame((_, delta) => {
    if (autoRotate && meshRef.current) {
      meshRef.current.rotation.x += delta * 0.5
      meshRef.current.rotation.y += delta * 0.5
    }
  })
  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      <Box ref={meshRef} args={[2, 2, 2]}>
        <meshStandardMaterial color="#EC4899" metalness={0.3} roughness={0.4} />
      </Box>
    </>
  )
}

function Pano360Demo() {
  // Texture équirectangulaire publique (image 360° de paysage). useTexture
  // retourne une instance immutable pour le linter ; on en fait une copie
  // via useMemo pour pouvoir setter mapping = Equirectangular sans warn.
  const baseTex = useTexture('https://threejs.org/examples/textures/2294472375_24a3b8ef46_o.jpg')
  const texture = React.useMemo(() => {
    const t = baseTex.clone()
    t.mapping = THREE.EquirectangularReflectionMapping
    return t
  }, [baseTex])
  return (
    <>
      <Sphere args={[100, 60, 40]} scale={[-1, 1, 1]}>
        <meshBasicMaterial map={texture} side={THREE.BackSide} />
      </Sphere>
    </>
  )
}

function ItemShowcaseDemo() {
  return (
    <>
      <Environment preset="sunset" />
      <Float speed={1.5} rotationIntensity={1} floatIntensity={1.5}>
        <mesh>
          <icosahedronGeometry args={[1.5, 1]} />
          <meshStandardMaterial color="#d4a84c" metalness={0.9} roughness={0.1} />
        </mesh>
      </Float>
      <Float speed={2} rotationIntensity={2} floatIntensity={2} position={[2.5, 0, 0]}>
        <mesh>
          <torusKnotGeometry args={[0.5, 0.15, 100, 16]} />
          <meshStandardMaterial color="#EC4899" metalness={0.8} roughness={0.15} />
        </mesh>
      </Float>
      <Float speed={1} rotationIntensity={0.5} floatIntensity={1} position={[-2.5, 0, 0]}>
        <mesh>
          <octahedronGeometry args={[0.8]} />
          <meshStandardMaterial color="#10B981" metalness={0.7} roughness={0.2} />
        </mesh>
      </Float>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 12, background: '#0f0f13', border: '1px solid #2a2a30', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#d4a84c', textTransform: 'uppercase' }}>{title}</div>
      {children}
    </div>
  )
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  padding: '2rem',
  background: '#0d0d0d',
  color: '#ede9df',
  fontFamily: 'Inter, -apple-system, sans-serif',
}

const btnStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: '#1a1a1e',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  color: '#ede9df',
  fontSize: 12,
  fontFamily: 'inherit',
  cursor: 'pointer',
}
