'use client'
/**
 * Viewer 3D pour panorama 360° équirectangulaire avec composition (NPCs + Items).
 *
 * Rendu Three.js :
 *   - SphereGeometry inversée (normales pointées vers l'intérieur) avec le pano
 *     équirectangulaire comme texture → le joueur est au centre et voit autour
 *   - Pour chaque placement (NPC/Item) : Sprite à la position sphérique
 *     (theta, phi) convertie en coord 3D cartésienne sur la sphère
 *   - Les sprites font face à la caméra automatiquement (Three.Sprite = billboard)
 *
 * Contrôles :
 *   - Drag souris horizontale → rotation yaw (theta)
 *   - Drag souris verticale → rotation pitch (phi), clipé à ±89° pour pas flipper
 *   - Molette → zoom (FOV)
 *
 * Optimisations :
 *   - Cleanup propre au démontage (dispose textures, geometries)
 *   - Re-render uniquement sur changements de props clés
 */
import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { Npc, Item } from '@/types'
import type { SceneComposition } from '../types'

export interface Pano360ViewerProps {
  panoramaUrl: string
  composition?: SceneComposition
  npcs?: Npc[]
  items?: Item[]
  /** Hauteur du viewer en px. Défaut 500. */
  height?: number
  /** Largeur en px. Défaut 100% (responsive). */
  width?: number | string
  /** FOV initial (champ de vision vertical). Défaut 75°. */
  initialFov?: number
}

/** Convertit coords sphériques (theta degrés, phi degrés, rayon) en vec3 Three.js. */
function sphericalToCartesian(theta: number, phi: number, radius: number): THREE.Vector3 {
  // theta = azimuth (0 = +Z front), phi = elevation (0 = horizon)
  const thetaRad = THREE.MathUtils.degToRad(theta)
  const phiRad = THREE.MathUtils.degToRad(phi)
  const x = radius * Math.cos(phiRad) * Math.sin(thetaRad)
  const y = radius * Math.sin(phiRad)
  const z = radius * Math.cos(phiRad) * Math.cos(thetaRad)
  return new THREE.Vector3(x, y, z)
}

/**
 * Charge une image et retire son fond uniforme (sample les 4 coins pour deviner
 * la couleur de fond, puis rend alpha=0 pour tout pixel proche de cette couleur).
 * Marche pour portraits sur fond gris #808080, noir, ou toute couleur unie aux bords.
 * Ajoute un léger feathering sur les pixels "limite" pour adoucir les bords.
 */
function loadCutoutTexture(url: string): Promise<THREE.CanvasTexture> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const d = imgData.data
      const W = canvas.width, H = canvas.height

      // Sample les 4 coins pour deviner la couleur de fond
      const corners = [
        [0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1],
      ]
      let bgR = 0, bgG = 0, bgB = 0
      for (const [cx, cy] of corners) {
        const i = (cy * W + cx) * 4
        bgR += d[i]; bgG += d[i + 1]; bgB += d[i + 2]
      }
      bgR /= 4; bgG /= 4; bgB /= 4

      // Seuils : hard-transparent sous 25 de distance, feathering jusqu'à 55
      const HARD = 25, SOFT = 55
      for (let i = 0; i < d.length; i += 4) {
        const dr = Math.abs(d[i] - bgR)
        const dg = Math.abs(d[i + 1] - bgG)
        const db = Math.abs(d[i + 2] - bgB)
        const dist = Math.max(dr, dg, db)
        if (dist < HARD) {
          d[i + 3] = 0
        } else if (dist < SOFT) {
          // Feathering linéaire
          const t = (dist - HARD) / (SOFT - HARD)
          d[i + 3] = Math.round(d[i + 3] * t)
        }
      }
      ctx.putImageData(imgData, 0, 0)

      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.needsUpdate = true
      resolve(tex)
    }
    img.onerror = () => reject(new Error(`Failed to load cutout texture: ${url}`))
    img.src = url
  })
}

export default function Pano360Viewer({
  panoramaUrl, composition, npcs = [], items = [], height = 500, width = '100%', initialFov = 75,
}: Pano360ViewerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const { clientWidth, clientHeight } = mount
    const w = clientWidth || 800
    const h = clientHeight || height

    // ── Scene / Camera / Renderer ──
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(initialFov, w / h, 0.1, 1000)
    camera.position.set(0, 0, 0.01) // Légèrement décalé pour éviter le clipping à l'origine

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(w, h)
    mount.appendChild(renderer.domElement)

    // ── Sphère panorama (inversée) ──
    const sphereGeo = new THREE.SphereGeometry(500, 64, 32)
    sphereGeo.scale(-1, 1, 1) // Inverse les normales → texture visible depuis l'intérieur
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0x808080 }) // Placeholder gray jusqu'au load
    const sphere = new THREE.Mesh(sphereGeo, sphereMat)
    scene.add(sphere)

    // Chargement async de la texture
    const texLoader = new THREE.TextureLoader()
    texLoader.setCrossOrigin('anonymous')
    const texture = texLoader.load(panoramaUrl,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        sphereMat.map = tex
        sphereMat.color.set(0xffffff) // Reset color to neutral pour que la texture s'affiche correctement
        sphereMat.needsUpdate = true
      },
      undefined,
      (err) => console.warn('[Pano360Viewer] Failed to load pano texture:', err),
    )

    // ── Sprites pour NPCs et Items ──
    const spriteGroup = new THREE.Group()
    scene.add(spriteGroup)

    /**
     * Ajoute un sprite en chargeant l'image avec suppression du fond (cutout).
     * Le sprite est créé avec un placeholder transparent, puis mis à jour dès
     * que la cutout texture est prête (évite un flash de l'image brute).
     */
    function addSprite(imgUrl: string, theta: number, phi: number, scale: number, flip = false) {
      const mat = new THREE.SpriteMaterial({ transparent: true, opacity: 0 })
      const sprite = new THREE.Sprite(mat)
      const pos = sphericalToCartesian(theta, phi, 100)
      sprite.position.copy(pos)
      const baseSize = 30 * scale
      sprite.scale.set(baseSize * (flip ? -1 : 1), baseSize, 1)
      spriteGroup.add(sprite)
      // Async : preprocess pour retirer le fond, puis update le material
      loadCutoutTexture(imgUrl)
        .then(tex => {
          mat.map = tex
          mat.opacity = 1
          mat.needsUpdate = true
        })
        .catch(err => console.warn('[Pano360Viewer] cutout failed:', err))
    }

    if (composition) {
      composition.npcs.forEach(p => {
        const npc = npcs.find(n => n.id === p.npc_id)
        if (npc?.portrait_url) addSprite(npc.portrait_url, p.theta, p.phi, p.scale, p.flip)
      })
      composition.items.forEach(p => {
        const url = p.custom_url ?? items.find(i => i.id === p.item_id)?.illustration_url
        if (url) addSprite(url, p.theta, p.phi, p.scale)
      })
    }

    // ── Contrôles souris (drag to rotate + wheel to zoom) ──
    let yaw = 0   // theta rotation around Y axis (horizontal)
    let pitch = 0 // phi rotation around X axis (vertical)
    let isDragging = false
    let dragStart = { x: 0, y: 0, yaw: 0, pitch: 0 }

    function onMouseDown(e: MouseEvent) {
      isDragging = true
      dragStart = { x: e.clientX, y: e.clientY, yaw, pitch }
    }
    function onMouseMove(e: MouseEvent) {
      if (!isDragging) return
      const sensitivity = 0.3
      yaw = dragStart.yaw - (e.clientX - dragStart.x) * sensitivity
      pitch = dragStart.pitch - (e.clientY - dragStart.y) * sensitivity
      pitch = Math.max(-89, Math.min(89, pitch))
    }
    function onMouseUp() { isDragging = false }
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      camera.fov = Math.max(30, Math.min(110, camera.fov + (e.deltaY > 0 ? 3 : -3)))
      camera.updateProjectionMatrix()
    }

    renderer.domElement.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

    // ── Render loop ──
    let animId: number
    function animate() {
      animId = requestAnimationFrame(animate)
      // Applique yaw/pitch à la caméra (regarde vers un point sur la sphère)
      const lookTarget = sphericalToCartesian(yaw, pitch, 10)
      camera.lookAt(lookTarget)
      renderer.render(scene, camera)
    }
    animate()

    // ── Resize ──
    function onResize() {
      if (!mount) return
      const nw = mount.clientWidth || 800
      const nh = mount.clientHeight || height
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
      renderer.setSize(nw, nh)
    }
    window.addEventListener('resize', onResize)

    // ── Cleanup ──
    return () => {
      cancelAnimationFrame(animId)
      renderer.domElement.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      renderer.domElement.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', onResize)
      sphereGeo.dispose()
      sphereMat.dispose()
      texture.dispose()
      spriteGroup.children.forEach(child => {
        if (child instanceof THREE.Sprite) {
          child.material.map?.dispose()
          child.material.dispose()
        }
      })
      renderer.dispose()
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
  }, [panoramaUrl, composition, npcs, items, height, initialFov])

  return (
    <div ref={mountRef}
      style={{ width, height, background: '#000', borderRadius: '6px', overflow: 'hidden', position: 'relative', cursor: 'grab' }}
    />
  )
}
