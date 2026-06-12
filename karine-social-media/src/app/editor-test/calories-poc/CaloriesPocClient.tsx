'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Download, RotateCcw, Smartphone, Monitor, User } from 'lucide-react';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { showToast } from '@/lib/toast';

/**
 * POC editor /editor-test/calories-poc — outil de positionnement
 * libre pour itérer le layout de /mes-calories.
 *
 * Fonctionnalites :
 *  - Toggle viewport Mobile (390×844) / PC (1280×900)
 *  - Tous les elements de /mes-calories en absolute positioning
 *  - Click = selectionner, drag = bouger, handle bas-droit = resizer
 *  - Panneau inputs pour x/y/width/height precis
 *  - Sauvegarde auto en localStorage par device
 *  - Bouton "Exporter JSON" pour reprendre les valeurs dans le code
 */

type Element = {
  key: string;
  label: string;
  /** Type de rendu : image OU placeholder colore + texte */
  kind: 'image' | 'placeholder';
  src?: string;
  bg?: string;
  text?: string;
  /** Position en px depuis le coin haut-gauche du device frame. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** z-index, par defaut 1 */
  z?: number;
};

type Device = 'mobile' | 'pc';
const DEVICE_W: Record<Device, number> = { mobile: 390, pc: 1280 };
const DEVICE_H: Record<Device, number> = { mobile: 844, pc: 900 };

const DEFAULT_ELEMENTS: Record<Device, Element[]> = {
  mobile: [
    { key: 'couronne', label: 'Couronne', kind: 'image', src: '/images/icons/cal-courone.webp', x: 20, y: 60, width: 280, height: 280 },
    { key: 'fee', label: 'Fée', kind: 'image', src: '/images/icons/fee-logo.webp', x: -10, y: 50, width: 110, height: 110, z: 5 },
    { key: 'cercle-text', label: 'Cercle texte (Restant 2309)', kind: 'placeholder', bg: 'transparent', text: '♡ RESTANT\n2309\n/ 2309 kcal\nObjectif atteint ♡', x: 80, y: 130, width: 160, height: 150, z: 4 },
    { key: 'depensees', label: 'Carte Dépensées', kind: 'placeholder', bg: '#FFFFFF', text: 'DÉPENSÉES\n0\nkcal', x: 290, y: 80, width: 90, height: 160 },
    { key: 'branche', label: 'Branche (dans Dépensées)', kind: 'image', src: '/images/icons/cal-branche.webp', x: 290, y: 200, width: 80, height: 80 },
    { key: 'glucides', label: 'Tuile Glucides', kind: 'placeholder', bg: '#FDF6E8', text: 'GLUCIDES\n0/259g', x: 15, y: 360, width: 110, height: 100 },
    { key: 'proteines', label: 'Tuile Protéines', kind: 'placeholder', bg: '#FBEDE5', text: 'PROTÉINES\n0/134g', x: 140, y: 360, width: 110, height: 100 },
    { key: 'lipides', label: 'Tuile Lipides', kind: 'placeholder', bg: '#F4F6EA', text: 'LIPIDES\n0/82g', x: 265, y: 360, width: 110, height: 100 },
    { key: 'ble', label: 'Icône blé', kind: 'image', src: '/images/icons/cal-ble.webp', x: 65, y: 420, width: 40, height: 40 },
    { key: 'feuille', label: 'Icône feuille', kind: 'image', src: '/images/icons/cal-feuille.webp', x: 190, y: 420, width: 40, height: 40 },
    { key: 'olive', label: 'Icône olive', kind: 'image', src: '/images/icons/cal-olive.webp', x: 315, y: 420, width: 40, height: 40 },
    { key: 'donut', label: 'Donut Répartition', kind: 'placeholder', bg: '#FFFFFF', text: 'DONUT\n0%', x: 15, y: 500, width: 360, height: 120 },
    { key: 'tasse', label: 'Tasse aquarelle', kind: 'image', src: '/images/icons/cal-tasse.webp', x: 280, y: 510, width: 90, height: 110, z: 3 },
    { key: 'evolution', label: 'Histogramme évolution', kind: 'placeholder', bg: '#FFFFFF', text: 'MON ÉVOLUTION (Lun..Dim) + moyenne', x: 15, y: 640, width: 360, height: 150 },
    { key: 'slogan', label: 'Slogan', kind: 'placeholder', bg: '#FFFFFF', text: '💡 Chaque petit choix compte,\nsoyez fière de vous ♡', x: 15, y: 810, width: 360, height: 50 },
    { key: 'fee2', label: 'Fée slogan', kind: 'image', src: '/images/icons/fee-logo.webp', x: 290, y: 800, width: 80, height: 80, z: 5 },
  ],
  pc: [
    { key: 'couronne', label: 'Couronne', kind: 'image', src: '/images/icons/cal-courone.webp', x: 80, y: 60, width: 380, height: 380 },
    { key: 'fee', label: 'Fée', kind: 'image', src: '/images/icons/fee-logo.webp', x: 40, y: 70, width: 160, height: 160, z: 5 },
    { key: 'cercle-text', label: 'Cercle texte (Restant)', kind: 'placeholder', bg: 'transparent', text: '♡ RESTANT\n2309\n/ 2309 kcal\nObjectif atteint ♡', x: 180, y: 170, width: 220, height: 180, z: 4 },
    { key: 'depensees', label: 'Carte Dépensées', kind: 'placeholder', bg: '#FFFFFF', text: 'DÉPENSÉES\n0\nkcal', x: 500, y: 100, width: 160, height: 220 },
    { key: 'branche', label: 'Branche (dans Dépensées)', kind: 'image', src: '/images/icons/cal-branche.webp', x: 510, y: 270, width: 110, height: 110 },
    { key: 'glucides', label: 'Tuile Glucides', kind: 'placeholder', bg: '#FDF6E8', text: 'GLUCIDES\n0/259g', x: 700, y: 100, width: 170, height: 130 },
    { key: 'proteines', label: 'Tuile Protéines', kind: 'placeholder', bg: '#FBEDE5', text: 'PROTÉINES\n0/134g', x: 900, y: 100, width: 170, height: 130 },
    { key: 'lipides', label: 'Tuile Lipides', kind: 'placeholder', bg: '#F4F6EA', text: 'LIPIDES\n0/82g', x: 1100, y: 100, width: 170, height: 130 },
    { key: 'ble', label: 'Icône blé', kind: 'image', src: '/images/icons/cal-ble.webp', x: 800, y: 180, width: 50, height: 50 },
    { key: 'feuille', label: 'Icône feuille', kind: 'image', src: '/images/icons/cal-feuille.webp', x: 1000, y: 180, width: 50, height: 50 },
    { key: 'olive', label: 'Icône olive', kind: 'image', src: '/images/icons/cal-olive.webp', x: 1200, y: 180, width: 50, height: 50 },
    { key: 'donut', label: 'Donut Répartition', kind: 'placeholder', bg: '#FFFFFF', text: 'DONUT\n0%', x: 700, y: 280, width: 400, height: 160 },
    { key: 'tasse', label: 'Tasse aquarelle', kind: 'image', src: '/images/icons/cal-tasse.webp', x: 1000, y: 290, width: 120, height: 140, z: 3 },
    { key: 'evolution', label: 'Histogramme évolution', kind: 'placeholder', bg: '#FFFFFF', text: 'MON ÉVOLUTION + moyenne', x: 80, y: 480, width: 800, height: 200 },
    { key: 'slogan', label: 'Slogan', kind: 'placeholder', bg: '#FFFFFF', text: '💡 Chaque petit choix compte,\nsoyez fière de vous ♡', x: 80, y: 720, width: 800, height: 80 },
    { key: 'fee2', label: 'Fée slogan', kind: 'image', src: '/images/icons/fee-logo.webp', x: 750, y: 700, width: 130, height: 130, z: 5 },
  ],
};

const LS_KEY = 'karine_calories_poc_v1';

export function CaloriesPocClient() {
  const [device, setDevice] = useState<Device>('mobile');
  const [elements, setElements] = useState<Record<Device, Element[]>>(DEFAULT_ELEMENTS);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // Charge depuis localStorage au mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<Device, Element[]>;
      if (parsed.mobile && parsed.pc) setElements(parsed);
    } catch {
      /* ignore */
    }
  }, []);

  // Sauvegarde a chaque changement
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(elements));
    } catch {
      /* quota / private mode */
    }
  }, [elements]);

  function updateElement(key: string, patch: Partial<Element>) {
    setElements((prev) => ({
      ...prev,
      [device]: prev[device].map((el) => (el.key === key ? { ...el, ...patch } : el)),
    }));
  }

  function reset() {
    // Règle projet ⛔ : pas de window.confirm/alert. ConfirmModal thémé.
    setConfirmReset(true);
  }

  function copyJson() {
    navigator.clipboard.writeText(JSON.stringify(elements, null, 2));
    showToast('JSON copié dans le presse-papier ✓');
  }

  const currentElements = elements[device];
  const selected = currentElements.find((el) => el.key === selectedKey);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#FAF0EB]">
      {/* === Zone canvas === */}
      <div className="relative flex flex-1 items-start justify-center overflow-auto p-6">
        {/* Toolbar haut */}
        <div className="absolute left-1/2 top-2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 shadow-md ring-1 ring-coral-soft/40">
          <button
            type="button"
            onClick={() => setDevice('mobile')}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
              device === 'mobile' ? 'bg-coral text-white' : 'text-ink-soft hover:bg-coral-soft/30'
            }`}
          >
            <Smartphone className="size-3.5" /> Mobile 390×844
          </button>
          <button
            type="button"
            onClick={() => setDevice('pc')}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
              device === 'pc' ? 'bg-coral text-white' : 'text-ink-soft hover:bg-coral-soft/30'
            }`}
          >
            <Monitor className="size-3.5" /> PC 1280×900
          </button>
          <span className="mx-1 h-4 w-px bg-coral-soft/40" />
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-ink-soft hover:bg-coral-soft/30"
            title="Réinitialiser"
          >
            <RotateCcw className="size-3.5" /> Reset
          </button>
          <button
            type="button"
            onClick={() => setExportOpen((o) => !o)}
            className="flex items-center gap-1 rounded-full bg-coral px-2.5 py-1 text-xs font-semibold text-white"
          >
            <Download className="size-3.5" /> Exporter
          </button>
        </div>

        {/* Device frame — overflow:visible pour permettre aux
            elements d'etre positionnes EN DEHORS du cadre device.
            Le bg + rounded restent contenus dans le frame, mais les
            elements draggables peuvent deborder. */}
        <div
          className="relative mt-12 rounded-3xl bg-[#FAEAE5] shadow-2xl ring-1 ring-coral/30"
          style={{
            width: DEVICE_W[device],
            height: DEVICE_H[device],
            minWidth: DEVICE_W[device],
            backgroundImage: `url(${device === 'pc' ? '/images/fond-accueil-desktop-v3.png' : '/images/fond-accueil-v3.png'})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            overflow: 'visible',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedKey(null);
          }}
        >
          {/* Header decoratif fixe (non draggable, non resizable).
              Replique exact du AppHeader : flèche retour rond blanc
              à gauche, "Karine diététique / Mes calories" centre script,
              icône profil rond à droite. Pour info uniquement —
              cette zone est reservee et NE DOIT PAS recevoir d'elements. */}
          <PocHeader />

          {currentElements.map((el) => (
            <DraggableElement
              key={el.key}
              el={el}
              isSelected={selectedKey === el.key}
              onSelect={() => setSelectedKey(el.key)}
              onUpdate={(p) => updateElement(el.key, p)}
              deviceW={DEVICE_W[device]}
              deviceH={DEVICE_H[device]}
            />
          ))}
        </div>
      </div>

      {/* === Panneau lateral === */}
      <aside className="flex w-72 shrink-0 flex-col border-l border-coral-soft/30 bg-white">
        <div className="border-b border-coral-soft/30 px-4 py-3">
          <h2 className="text-sm font-bold text-coral-dark">
            {selected ? selected.label : 'Aucun élément sélectionné'}
          </h2>
          <p className="text-[0.65rem] text-ink-soft">
            Clique sur un élément du device pour éditer.
          </p>
        </div>

        {selected ? (
          <div className="space-y-3 overflow-y-auto p-4">
            <NumInput label="X (px)" value={selected.x} onChange={(v) => updateElement(selected.key, { x: v })} />
            <NumInput label="Y (px)" value={selected.y} onChange={(v) => updateElement(selected.key, { y: v })} />
            <NumInput label="Largeur (px)" value={selected.width} onChange={(v) => updateElement(selected.key, { width: Math.max(20, v) })} />
            <NumInput label="Hauteur (px)" value={selected.height} onChange={(v) => updateElement(selected.key, { height: Math.max(20, v) })} />
            <NumInput label="z-index" value={selected.z ?? 1} onChange={(v) => updateElement(selected.key, { z: v })} />

            {/* Aperçu type */}
            <div className="rounded-lg bg-coral-soft/10 px-3 py-2 text-xs text-ink-soft">
              <p>
                <strong>Type :</strong> {selected.kind}
              </p>
              {selected.src && (
                <p className="truncate">
                  <strong>Source :</strong> {selected.src.split('/').pop()}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-coral-dark">
              Tous les éléments
            </p>
            <ul className="space-y-1">
              {currentElements.map((el) => (
                <li key={el.key}>
                  <button
                    type="button"
                    onClick={() => setSelectedKey(el.key)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-coral-soft/20"
                  >
                    <span className="truncate">{el.label}</span>
                    <span className="shrink-0 text-[0.6rem] text-ink-soft">
                      {Math.round(el.x)},{Math.round(el.y)} · {Math.round(el.width)}×{Math.round(el.height)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      {/* === Modale export === */}
      {exportOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
          onClick={() => setExportOpen(false)}
        >
          <div
            className="m-4 max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-coral-soft/30 px-4 py-3">
              <h3 className="text-base font-bold text-coral-dark">
                Export JSON (mobile + PC)
              </h3>
              <button
                type="button"
                onClick={copyJson}
                className="flex items-center gap-1 rounded-full bg-coral px-3 py-1.5 text-xs font-semibold text-white"
              >
                <Copy className="size-3.5" /> Copier
              </button>
            </header>
            <pre className="max-h-[60vh] overflow-auto bg-coral-soft/10 p-4 text-[0.65rem]">
              {JSON.stringify(elements, null, 2)}
            </pre>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmReset}
        title="Réinitialiser ?"
        message="Les positions reviennent à leurs valeurs par défaut. Ta config en cours sera perdue."
        confirmLabel="Réinitialiser"
        cancelLabel="Annuler"
        variant="danger"
        onConfirm={() => {
          setElements(DEFAULT_ELEMENTS);
          setConfirmReset(false);
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

function NumInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-xs font-semibold text-ink">
      {label}
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="mt-1 w-full rounded-md border border-coral-soft/40 bg-white px-2 py-1.5 text-sm focus:border-coral focus:outline-none"
      />
    </label>
  );
}

// =====================================================================
// Header decoratif fixe (non draggable, non resizable)
// =====================================================================

function PocHeader() {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-[20] flex items-start justify-between px-3 pt-3"
      aria-hidden
    >
      {/* Fleche retour rond blanc */}
      <div className="grid size-10 place-items-center rounded-full bg-white/95 text-coral shadow ring-1 ring-coral-soft/30">
        <ArrowLeft className="size-4" strokeWidth={2.5} />
      </div>

      {/* Titre centre : "Karine diététique" script + "Mes calories" script */}
      <div className="flex flex-col items-center pt-1">
        <span
          className="text-lg leading-none"
          style={{ fontFamily: 'var(--font-script, cursive)', color: '#C76B4A' }}
        >
          Karine <span className="text-emerald-600">diététique</span>
        </span>
        <span className="-mt-0.5 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-ink-soft">
          diététique
        </span>
        <span
          className="mt-0.5 text-base italic leading-none"
          style={{ fontFamily: 'var(--font-script, cursive)', color: '#C76B4A' }}
        >
          Mes calories
        </span>
      </div>

      {/* Profil rond blanc */}
      <div className="grid size-10 place-items-center rounded-full bg-white/95 text-ink-soft shadow ring-1 ring-coral-soft/30">
        <User className="size-4" strokeWidth={2} />
      </div>
    </div>
  );
}

// =====================================================================
// Element draggable + resizable
// =====================================================================

function DraggableElement({
  el,
  isSelected,
  onSelect,
  onUpdate,
  deviceW,
  deviceH,
}: {
  el: Element;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (p: Partial<Element>) => void;
  deviceW: number;
  deviceH: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'idle' | 'drag' | 'resize'>('idle');
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; x: number; y: number; w: number; h: number } | null>(null);

  function onMouseDownDrag(e: React.MouseEvent) {
    e.stopPropagation();
    onSelect();
    setMode('drag');
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      x: el.x,
      y: el.y,
      w: el.width,
      h: el.height,
    };
  }

  function onMouseDownResize(e: React.MouseEvent) {
    e.stopPropagation();
    onSelect();
    setMode('resize');
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      x: el.x,
      y: el.y,
      w: el.width,
      h: el.height,
    };
  }

  useEffect(() => {
    if (mode === 'idle') return;
    function onMove(e: MouseEvent) {
      const s = dragStartRef.current;
      if (!s) return;
      const dx = e.clientX - s.mouseX;
      const dy = e.clientY - s.mouseY;
      if (mode === 'drag') {
        // Pas de borne : l'utilisateur peut sortir totalement du
        // cadre device si besoin (utile pour deco / debordement
        // intentionnel comme la fee qui depasse a gauche).
        onUpdate({
          x: s.x + dx,
          y: s.y + dy,
        });
      } else if (mode === 'resize') {
        onUpdate({
          width: Math.max(20, s.w + dx),
          height: Math.max(20, s.h + dy),
        });
      }
    }
    function onUp() {
      setMode('idle');
      dragStartRef.current = null;
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [mode, onUpdate, deviceW, deviceH]);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: el.x,
    top: el.y,
    width: el.width,
    height: el.height,
    zIndex: el.z ?? 1,
    cursor: mode === 'drag' ? 'grabbing' : 'grab',
  };

  return (
    <div
      ref={ref}
      style={style}
      onMouseDown={onMouseDownDrag}
      className={`select-none ${isSelected ? 'outline outline-2 outline-coral' : 'hover:outline hover:outline-1 hover:outline-coral/40'}`}
    >
      {el.kind === 'image' && el.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={el.src}
          alt=""
          draggable={false}
          className="pointer-events-none size-full object-contain"
        />
      ) : (
        <div
          className="flex size-full items-center justify-center whitespace-pre-line rounded-xl p-2 text-center text-[0.65rem] font-semibold leading-tight shadow-sm ring-1 ring-coral-soft/30"
          style={{ background: el.bg || '#FFFFFF', color: '#3D2820' }}
        >
          {el.text || el.label}
        </div>
      )}

      {/* Handle resize bas-droite */}
      {isSelected && (
        <button
          type="button"
          onMouseDown={onMouseDownResize}
          aria-label="Redimensionner"
          className="absolute -bottom-2 -right-2 z-10 size-4 cursor-nwse-resize rounded-full bg-coral ring-2 ring-white"
        />
      )}
    </div>
  );
}
