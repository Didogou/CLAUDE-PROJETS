'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChefHat,
  Mic,
  MicOff,
  PartyPopper,
  Pause,
  Play,
  Plus,
  Soup,
  Square,
  Timer,
  Utensils,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
// Migration 2026-06-13 : Vosk WASM local au lieu de Web Speech API
// (envoyait l'audio chez Google → non documenté CNIL). Vosk = tout en
// local sur l'appareil, pas de bip "activation" Chrome toutes les 30 s.
// Cf. memory project_karine_voice_recognition_parked.md
import { useVoskCommands, type VoskStage } from './useVoskCommands';
import {
  durationLabel,
  formatTimer,
  parseTemperature,
  parseTimerSeconds,
  timerAlert,
} from './cooking-helpers';

export type CookUtensil = { slug: string; label: string; imageUrl: string | null };
export type CookIngredient = {
  label: string;
  quantity: number | null;
  unit: string | null;
  /** Vignette Ciqual (aquarelle) si l'ingrédient est lié à Ciqual. */
  imageUrl: string | null;
};
export type CookStepData = {
  text: string;
  audioUrl: string | null;
  utensils: CookUtensil[];
  ingredients: CookIngredient[];
};

/**
 * Cuisine guidée — un écran par étape, voix jouée automatiquement.
 * Données réelles de la fiche (préparation structurée + voix ElevenLabs).
 */
export function RecipeCookView({
  title,
  steps,
  backHref,
}: {
  title: string;
  steps: CookStepData[];
  backHref: string;
}) {
  const total = steps.length;
  // -1 = intro · 0..total-1 = étapes · total = fin
  const [idx, setIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  // « Avec ma voix » : narration ElevenLabs ON par défaut.
  const [voiceOn, setVoiceOn] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Tracker des étapes dont la voix a déjà été jouée (au moins une fois).
  // Permet d'autoplay UNIQUEMENT à la 1re visite d'une étape — si on
  // revient en arrière (bouton ←), pas de relance automatique : il faut
  // un clic explicite sur ▶ pour ré-écouter. UX validée 2026-06-13.
  const playedStepsRef = useRef<Set<number>>(new Set());

  // Joue la voix de l'étape courante (si jamais entendue ET narration ON).
  // À chaque changement d'idx : pause/reset NET de l'audio précédent
  // (évite overlap son + capture micro parasite sur la transition).
  useEffect(() => {
    if (idx < 0 || idx >= total) return;
    const a = audioRef.current;
    if (!a) return;
    // Coupe TOUJOURS l'audio précédent en premier (idempotent).
    try {
      a.pause();
      a.currentTime = 0;
    } catch {
      /* certains navigateurs throw si src vide */
    }
    if (!voiceOn) return;
    const url = steps[idx]?.audioUrl;
    if (!url) return;
    a.src = url;
    a.currentTime = 0;
    // Autoplay UNIQUEMENT à la 1re visite. Sur retour en arrière, on a
    // chargé la source (clic ▶ marche) mais on ne re-joue pas tout seul.
    if (!playedStepsRef.current.has(idx)) {
      playedStepsRef.current.add(idx);
      a.play().catch(() => {
        /* autoplay bloqué : l'utilisatrice utilisera le bouton ▶ */
      });
    }
  }, [idx, steps, total, voiceOn]);

  // Fenêtre de transition entre étapes : on mute le micro pendant 600 ms
  // après chaque changement d'idx pour couvrir la zone "vieille narration
  // pausée mais nouvelle pas encore démarrée" + le temps que le SR
  // restart si jamais Chrome décide de le relancer pile à ce moment.
  // Évite que la reco capte un mot orphelin pendant le swap.
  const [navTransition, setNavTransition] = useState(false);
  useEffect(() => {
    setNavTransition(true);
    const t = setTimeout(() => setNavTransition(false), 600);
    return () => clearTimeout(t);
  }, [idx]);

  // Verrou plein écran : empêche le body de scroller / rebondir (iOS
  // « rubber-band »). On fige le body en position:fixed + overscroll:none
  // tant que la cuisine guidée est ouverte, et on restaure à la sortie.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const saved = {
      htmlOverflow: html.style.overflow,
      overflow: body.style.overflow,
      overscroll: body.style.overscrollBehavior,
      position: body.style.position,
      width: body.style.width,
      height: body.style.height,
      top: body.style.top,
      scrollY: window.scrollY,
    };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    body.style.position = 'fixed';
    body.style.top = `-${saved.scrollY}px`;
    body.style.width = '100%';
    body.style.height = '100%';
    return () => {
      html.style.overflow = saved.htmlOverflow;
      body.style.overflow = saved.overflow;
      body.style.overscrollBehavior = saved.overscroll;
      body.style.position = saved.position;
      body.style.top = saved.top;
      body.style.width = saved.width;
      body.style.height = saved.height;
      window.scrollTo(0, saved.scrollY);
    };
  }, []);

  function togglePlay() {
    const a = audioRef.current;
    if (!a || !a.src) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  // ── Mains libres (commandes vocales) ──
  const [handsFree, setHandsFree] = useState(false);

  // Toggle mains libres : à l'activation, on demande le micro via un GESTE
  // (getUserMedia dans le handler de clic). Sinon Chrome ne montre jamais la
  // popup de permission pour SpeechRecognition démarré depuis un effet.
  function toggleHandsFree() {
    const next = !handsFree;
    if (next && typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => stream.getTracks().forEach((t) => t.stop()))
        .catch(() => {
          /* refus géré ensuite par l'erreur de la reco */
        });
    }
    setHandsFree(next);
  }

  // ── Minuteur (persiste à travers les étapes ; tourne panneau fermé) ──
  const [timerEndsAt, setTimerEndsAt] = useState<number | null>(null);
  const [timerTotal, setTimerTotal] = useState(0);
  const [timerOpen, setTimerOpen] = useState(false);
  const [, forceTick] = useState(0);
  const alertedRef = useRef(false);
  // Stocke la fonction de stop retournée par timerAlert() pour pouvoir
  // couper la séquence de 10 bips (1 par seconde) quand l'utilisatrice
  // clique Stop ou +1 min avant la fin naturelle.
  const alertStopRef = useRef<(() => void) | null>(null);
  // True pendant les 10 s de bips de fin de minuteur. Sert à muter le
  // micro pour qu'il ne capte pas les bips en larsen → sinon la reco
  // boucle (chaque bip = échec → onend → restart → re-bip → boucle).
  const [alertActive, setAlertActive] = useState(false);

  useEffect(() => {
    if (timerEndsAt == null) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [timerEndsAt]);

  const remaining =
    timerEndsAt == null ? 0 : Math.max(0, Math.ceil((timerEndsAt - Date.now()) / 1000));

  useEffect(() => {
    if (timerEndsAt != null && remaining === 0 && !alertedRef.current) {
      alertedRef.current = true;
      setAlertActive(true);
      alertStopRef.current = timerAlert();
      // Désarme l'état muet automatiquement après la durée des bips
      // (10 s — cf. timerAlert). Si Karine clique Stop ou +1 min avant,
      // l'autre branche désarmera plus tôt.
      const t = setTimeout(() => setAlertActive(false), 10_500);
      return () => clearTimeout(t);
    }
  }, [remaining, timerEndsAt]);

  // Cleanup global : si on quitte la cuisine pendant les bips, on coupe.
  useEffect(() => {
    return () => {
      alertStopRef.current?.();
      alertStopRef.current = null;
    };
  }, []);

  function startTimer(sec: number) {
    if (sec <= 0) return;
    alertStopRef.current?.();
    alertStopRef.current = null;
    setAlertActive(false);
    alertedRef.current = false;
    setTimerTotal(sec);
    setTimerEndsAt(Date.now() + sec * 1000);
    setTimerOpen(true);
  }
  function stopTimer() {
    alertStopRef.current?.();
    alertStopRef.current = null;
    setAlertActive(false);
    setTimerEndsAt(null);
    setTimerOpen(false);
    alertedRef.current = false;
  }

  // ── Commandes vocales → navigation / minuteur ──
  // enabled dès l'intro (idx = -1) → la permission micro est demandée
  // quand on active « Mains libres », et l'indicateur s'affiche tout de suite.
  const {
    supported: voiceSupported,
    listening: voiceListening,
    error: voiceError,
    loading: voiceLoading,
    loadProgress: voiceLoadProgress,
    loadStage: voiceLoadStage,
  } = useVoskCommands({
    enabled: handsFree && idx < total,
    // Muté pendant la narration (anti auto-déclenchement), pendant les
    // 10 bips de fin de timer (anti-larsen) et pendant la fenêtre de
    // transition entre étapes (couvre le gap entre vieille narration
    // pausée et nouvelle pas encore démarrée → évite qu'un mot orphelin
    // déclenche next/prev par erreur).
    muted: playing || alertActive || navTransition,
    onCommand: (cmd) => {
      if (cmd === 'next') setIdx((i) => i + 1);
      else if (cmd === 'prev') setIdx((i) => Math.max(0, i - 1));
      else if (cmd === 'timer') {
        const sec = idx >= 0 && idx < total ? parseTimerSeconds(steps[idx].text) : null;
        if (sec) startTimer(sec);
      }
    },
  });

  // 100svh (small viewport height) au lieu de 100dvh : Safari iOS gère mieux
  // svh quand le body est en position:fixed (cf. useEffect plus haut). Avec
  // dvh la hauteur variait pendant le scroll de la barre URL → le footer
  // ("Suivant") sortait du viewport. svh fige à la hauteur "barres système
  // visibles" — prévisible et stable.
  return (
    <main className="mx-auto flex h-[100svh] w-full max-w-md flex-col overflow-hidden overscroll-none bg-[radial-gradient(circle_at_50%_30%,#fff7fa_0%,#fdeef2_42%,#f6d3de_100%)]">
      <RevealKeyframes />
      {/* Élément audio unique, piloté par étape */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />

      {idx === -1 && (
        <Intro
          title={title}
          total={total}
          backHref={backHref}
          voiceOn={voiceOn}
          onToggleVoice={() => setVoiceOn((v) => !v)}
          handsFree={handsFree}
          onToggleHandsFree={toggleHandsFree}
          voiceSupported={voiceSupported}
          voiceListening={voiceListening}
          voiceLoading={voiceLoading}
          voiceLoadProgress={voiceLoadProgress}
          voiceLoadStage={voiceLoadStage}
          voiceError={voiceError}
          onStart={() => setIdx(0)}
        />
      )}

      {idx >= 0 && idx < total && (
        <Step
          step={steps[idx]}
          index={idx}
          total={total}
          title={title}
          backHref={backHref}
          voiceOn={voiceOn}
          handsFree={handsFree}
          voiceListening={voiceListening}
          playing={playing}
          onTogglePlay={togglePlay}
          onStartTimer={startTimer}
          timerRemaining={remaining}
          timerActive={timerEndsAt != null}
          ovenTempHint={(() => {
            // Reporte la dernière température vue (ex. « Préchauffez à 180°C »)
            // sur les étapes suivantes (« Enfournez 35 min ») qui ne la répètent pas.
            let t: string | null = null;
            for (let j = 0; j <= idx; j++) {
              const x = parseTemperature(steps[j]?.text ?? '');
              if (x) t = x;
            }
            return t;
          })()}
          onPrev={() => setIdx((i) => Math.max(0, i - 1))}
          onNext={() => setIdx((i) => i + 1)}
        />
      )}

      {idx === total && (
        <Done title={title} backHref={backHref} onRestart={() => setIdx(0)} />
      )}

      {/* Minuteur flottant : visible tant qu'il tourne, MÊME panneau fermé
          et même en changeant d'étape (l'état vit ici). */}
      {timerEndsAt != null && (
        <TimerWidget
          remaining={remaining}
          total={timerTotal}
          open={timerOpen}
          onToggleOpen={() => setTimerOpen((o) => !o)}
          onAddMinute={() => {
            // Coupe la séquence de bips en cours si on rajoute du temps.
            alertStopRef.current?.();
            alertStopRef.current = null;
            setAlertActive(false);
            setTimerEndsAt((e) => {
              alertedRef.current = false;
              return e == null ? e : e + 60_000;
            });
          }}
          onStop={stopTimer}
        />
      )}
    </main>
  );
}

/* ============================== Intro ============================== */

function Intro({
  title,
  total,
  backHref,
  voiceOn,
  onToggleVoice,
  handsFree,
  onToggleHandsFree,
  voiceSupported,
  voiceListening,
  voiceLoading,
  voiceLoadProgress,
  voiceLoadStage,
  voiceError,
  onStart,
}: {
  title: string;
  total: number;
  backHref: string;
  voiceOn: boolean;
  onToggleVoice: () => void;
  handsFree: boolean;
  onToggleHandsFree: () => void;
  voiceSupported: boolean;
  voiceListening: boolean;
  voiceLoading: boolean;
  voiceLoadProgress: number;
  voiceLoadStage: VoskStage;
  voiceError: string | null;
  onStart: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <Link
        href={backHref}
        aria-label="Retour à la recette"
        className="absolute left-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/80 text-ink-soft shadow-sm"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>
      <span className="grid h-20 w-20 place-items-center rounded-full bg-coral-soft/50 text-coral-dark shadow-sm">
        <ChefHat className="h-10 w-10" />
      </span>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-coral">
          Recette guidée
        </p>
        <h1 className="mt-1 font-script text-4xl leading-tight text-coral-dark">
          {title}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">{total} étapes</p>
      </div>

      {/* Options : narration vocale + pilotage mains libres. */}
      <div className="flex flex-col items-stretch gap-2">
        <IntroToggle
          label="Avec ma voix"
          on={voiceOn}
          onToggle={onToggleVoice}
          iconOn={<Volume2 className="h-4 w-4" />}
          iconOff={<VolumeX className="h-4 w-4" />}
        />
        <IntroToggle
          label="Mains libres"
          on={handsFree}
          onToggle={onToggleHandsFree}
          iconOn={<Mic className="h-4 w-4" />}
          iconOff={<MicOff className="h-4 w-4" />}
          disabled={!voiceSupported}
        />
        {!voiceSupported && (
          <p className="max-w-[16rem] text-center text-[0.65rem] italic text-ink-soft">
            Commandes vocales non disponibles sur ce navigateur (essaie Chrome).
          </p>
        )}
        {voiceSupported && handsFree && (
          <div className="max-w-[18rem] text-center text-[0.65rem]">
            {voiceError ? (
              <p className="font-semibold text-rose-600">⚠ {voiceError}</p>
            ) : voiceLoading ? (
              // Premier chargement : ~44 Mo de modèle vocal local à
              // télécharger. Mis en cache (Service Worker → Cache API)
              // ensuite, ré-utilisable indéfiniment sans nouveau DL.
              //
              // Sur Android, la phase "extracting" (décompression Kaldi +
              // init matrices) peut durer 10-30 s après le DL. Sans
              // changer le message, Karine voyait la barre figée à 100 %
              // et croyait que c'était planté.
              <div className="space-y-1.5">
                <p className="text-ink-soft">
                  {voiceLoadStage === 'downloading' && (
                    <>
                      Téléchargement du modèle vocal local…{' '}
                      <span className="font-semibold text-coral-dark">
                        {Math.round(voiceLoadProgress * 100)}%
                      </span>
                    </>
                  )}
                  {voiceLoadStage === 'extracting' && (
                    <>Préparation du moteur vocal…</>
                  )}
                  {voiceLoadStage === 'starting-mic' && (
                    <>Connexion au microphone…</>
                  )}
                </p>
                {/* Barre de progression : remplie au prorata du DL pendant
                    la phase 'downloading'. Sur les phases suivantes
                    (extracting / starting-mic), on garde 100 % rempli +
                    pulse pour indiquer une activité indéterminée. */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-coral-soft/30">
                  <div
                    className={`h-full rounded-full bg-coral transition-[width] duration-150 ease-out ${
                      voiceLoadStage !== 'downloading' ? 'animate-pulse' : ''
                    }`}
                    style={{
                      width:
                        voiceLoadStage === 'downloading'
                          ? `${Math.max(2, voiceLoadProgress * 100)}%`
                          : '100%',
                    }}
                  />
                </div>
                <p className="italic text-ink-soft/80">
                  {voiceLoadStage === 'extracting'
                    ? 'Décompression du modèle… (10-30 s sur mobile)'
                    : 'Une seule fois, puis tout sera local et sans connexion.'}
                </p>
              </div>
            ) : voiceListening ? (
              <p className="flex items-center justify-center gap-1 font-semibold text-emerald-600">
                <Mic className="h-3 w-3 animate-pulse" /> Micro actif — dis «&nbsp;suivant&nbsp;», «&nbsp;minuteur&nbsp;»…
              </p>
            ) : (
              <p className="italic text-ink-soft">Préparation du micro… (autorise-le si demandé)</p>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onStart}
        className="flex items-center gap-2 rounded-full bg-coral px-8 py-3.5 text-base font-bold text-white shadow-[0_10px_24px_-10px_rgba(226,120,141,0.9)] transition hover:bg-coral-dark active:scale-95"
      >
        Commencer <ArrowRight className="h-5 w-5" />
      </button>
      <p className="text-xs italic text-ink-soft">
        {voiceOn ? 'La voix te guide à chaque étape 🌸' : 'Lecture silencieuse 🌸'}
      </p>
    </div>
  );
}

/* ============================== Étape ============================== */

function Step({
  step,
  index,
  total,
  backHref,
  voiceOn,
  handsFree,
  voiceListening,
  playing,
  onTogglePlay,
  onStartTimer,
  timerRemaining,
  timerActive,
  ovenTempHint,
  onPrev,
  onNext,
}: {
  step: CookStepData;
  index: number;
  total: number;
  title: string;
  backHref: string;
  voiceOn: boolean;
  handsFree: boolean;
  voiceListening: boolean;
  playing: boolean;
  onTogglePlay: () => void;
  onStartTimer: (sec: number) => void;
  timerRemaining: number;
  timerActive: boolean;
  ovenTempHint: string | null;
  onPrev: () => void;
  onNext: () => void;
}) {
  const isLast = index === total - 1;
  const uCount = step.utensils.length;
  // Durée détectée dans le texte de l'étape → propose un minuteur.
  const timerSec = parseTimerSeconds(step.text);

  // Étape « cuisson / attente » : pas d'ingrédient mais une durée. On
  // affiche alors l'ustensile en grand avec un compteur transparent
  // par-dessus (+ la température si c'est un four).
  const isCookingStep = step.ingredients.length === 0 && timerSec != null;
  const ovenUtensil =
    step.utensils.find((u) => /four/i.test(u.slug) || /four/i.test(u.label)) ??
    null;
  const isOven = !!ovenUtensil || /\bfour\b|enfourn|pr[ée]chauff/i.test(step.text);
  // Température : celle de l'étape, sinon celle reportée du préchauffage.
  const ovenTemp = isOven ? parseTemperature(step.text) ?? ovenTempHint : null;
  const bigUtensil = ovenUtensil ?? step.utensils[0] ?? null;
  // Étape de préchauffage (four, sans minuteur) → même présentation centrale
  // (ustensile + température) mais SANS compteur.
  const isPreheatStep =
    step.ingredients.length === 0 && timerSec == null && isOven;
  const showUtensilCenter = isCookingStep || isPreheatStep;

  // Plus de calcul dynamique de taille d'image : on met une taille fixe
  // en rem et on rend la liste TOUJOURS scrollable. C'est plus prévisible
  // sur iOS Safari (le ResizeObserver + clientHeight était unreliable en
  // PWA standalone iOS — needsScroll restait false alors qu'il fallait
  // scroller, → bouton "Suivant" hors viewport).
  //
  // Image carrée 3rem (~48 px en base 16) : taille sympa en cuisine,
  // lisible sur tous écrans, pas de cabriole layout selon le nombre
  // d'ingrédients.

  return (
    // min-h-0 ESSENTIEL : sans ça, ce flex item enfant de <main h-svh>
    // garde sa min-height: auto (spec CSS flexbox) → s'étire à la taille
    // de son contenu (header + center + footer) qui dépasse 100svh →
    // <main overflow-hidden> rogne en bas → footer (bouton "Suivant")
    // invisible. La cascade min-h-0 sur les enfants ne pouvait rien
    // faire tant que ce wrapper n'avait pas min-h-0 lui-même.
    <div className="flex min-h-0 flex-1 flex-col">
      {/* shrink-0 : sur iOS Safari, sans ça, le calcul de min-h-0 sur le
          div frère (zone scrollable) était faussé — Safari comptait le
          header dans la cascade flex au lieu de le détacher. Conséquence
          observée : la liste d'ingrédients ne pouvait pas calculer sa
          vraie hauteur dispo → needsScroll restait false alors qu'il
          fallait scroller → le footer (bouton "Suivant") sortait du
          viewport. Le sticky top-0 reste pour le comportement de
          scroll, shrink-0 garantit qu'il ne grandit pas en flex. */}
      <header className="sticky top-0 z-10 flex shrink-0 flex-col items-center gap-1 bg-blush/85 px-4 pb-1.5 pt-2 backdrop-blur">
        <div className="flex w-full items-center">
          <Link
            href={backHref}
            aria-label="Quitter"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/80 text-ink-soft shadow-sm"
          >
            <X className="h-5 w-5" />
          </Link>
          <p className="min-w-0 flex-1 truncate text-center text-xs font-bold text-ink">
            Étape {index + 1}/{total}
          </p>
          {voiceOn ? (
            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={playing ? 'Pause' : 'Réécouter'}
              disabled={!step.audioUrl}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/80 text-coral shadow-sm disabled:opacity-40"
            >
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </button>
          ) : (
            <span aria-hidden className="h-8 w-8 shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? 'w-4 bg-coral' : i < index ? 'w-1.5 bg-coral' : 'w-1.5 bg-coral-soft/50'
              }`}
            />
          ))}
        </div>
        {handsFree && (
          <span className="flex items-center gap-1 text-[0.6rem] font-semibold uppercase tracking-wider text-coral">
            {playing ? (
              <>
                <Volume2 className="h-3 w-3" /> voix…
              </>
            ) : voiceListening ? (
              <>
                <Mic className="h-3 w-3 animate-pulse" /> à l&apos;écoute
              </>
            ) : (
              <>
                <MicOff className="h-3 w-3" /> micro inactif
              </>
            )}
          </span>
        )}
      </header>

      <div key={index} className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-5 pt-4">
        {!showUtensilCenter && step.utensils.length > 0 && (
          <section>
            <SectionHeading>Ustensiles</SectionHeading>
            <div className="mt-3 flex flex-wrap items-start justify-center gap-6">
              {step.utensils.map((u, i) => (
                <div
                  key={u.slug}
                  className="cook-rise flex w-16 flex-col items-center gap-1.5"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  {u.imageUrl ? (
                    // Illustration détourée (fond transparent) → pas de cadre,
                    // juste une ombre portée.
                    <img
                      src={u.imageUrl}
                      alt={u.label}
                      className="h-14 w-14 object-contain drop-shadow-[0_6px_8px_rgba(120,60,75,0.22)]"
                    />
                  ) : (
                    // Placeholder discret : cercle doux, petite icône estompée.
                    <span className="grid h-14 w-14 place-items-center rounded-full bg-coral-soft/20 text-coral/70">
                      <Utensils className="h-6 w-6" />
                    </span>
                  )}
                  <span className="text-center text-xs font-medium leading-tight text-ink">
                    {u.label}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {showUtensilCenter ? (
          <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
            {/* Titre de l'ustensile, en gros */}
            {bigUtensil && (
              <p className="font-script text-4xl leading-tight text-coral-dark">
                {capitalizeFirst(bigUtensil.label)}
              </p>
            )}

            {/* Température (four) — juste SOUS LE TITRE, sans fond */}
            {ovenTemp && (
              <span className="text-2xl font-bold text-coral-dark">
                {ovenTemp}
              </span>
            )}

            {/* Ustensile en grand */}
            {bigUtensil?.imageUrl ? (
              <img
                src={bigUtensil.imageUrl}
                alt={bigUtensil.label}
                className="h-44 w-44 object-contain drop-shadow-[0_12px_18px_rgba(120,60,75,0.28)]"
              />
            ) : (
              <span className="grid h-44 w-44 place-items-center rounded-full bg-coral-soft/20 text-coral-dark">
                <Timer className="h-20 w-20" />
              </span>
            )}

            {/* Compteur + bouton Start, sous l'ustensile — uniquement si
                l'étape a une durée (pas sur un simple préchauffage). */}
            {isCookingStep && (
              <button
                type="button"
                onClick={() => onStartTimer(timerSec ?? 0)}
                className="flex flex-col items-center gap-2 active:scale-95"
              >
                <span className="font-mono text-6xl font-extrabold tabular-nums text-coral-dark/80 drop-shadow-[0_2px_6px_rgba(255,255,255,0.9)]">
                  {formatTimer(timerActive ? timerRemaining : (timerSec ?? 0))}
                </span>
                {!timerActive && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-coral px-6 py-2 text-base font-bold text-white shadow-[0_8px_20px_-8px_rgba(226,120,141,0.9)]">
                    <Play className="h-4 w-4" /> Start
                  </span>
                )}
              </button>
            )}
          </section>
        ) : step.ingredients.length > 0 ? (
          <section
            className={`flex min-h-0 flex-1 flex-col${
              step.utensils.length === 0 ? ' pt-16' : ''
            }`}
          >
            {/* Grand titre script + cœur (bien plus gros) à droite */}
            <div className="flex shrink-0 items-center justify-center gap-3">
              <span className="font-script text-4xl leading-tight text-coral-dark">
                Préparer les ingrédients
              </span>
              <img
                src="/cooking/coeur.webp"
                alt=""
                aria-hidden
                className="h-20 w-auto drop-shadow-[0_5px_9px_rgba(120,60,75,0.24)]"
              />
            </div>

            {/* Liste aérée : rangées sans cadre, simples filets de séparation.
                Image fixe 3rem à gauche, quantité corail + nom à droite.
                Liste TOUJOURS scrollable (overflow-y-auto) — plus simple
                et robuste que les calculs JS dynamiques qui foiraient sur
                iOS Safari/PWA (le ResizeObserver ne se déclenchait pas
                au bon moment, needsScroll restait false → bouton "Suivant"
                hors viewport).
                Fondu blanc TOUJOURS visible en bas pour suggérer le scroll. */}
            <div className="relative mt-2 flex min-h-0 flex-1 flex-col">
              <ul className="flex min-h-0 flex-1 flex-col divide-y divide-coral-soft/30 overflow-y-auto overscroll-contain pb-4">
                {step.ingredients.map((ing, i) => (
                  <li
                    key={`${ing.label}-${i}`}
                    className="cook-rise flex shrink-0 items-center gap-4 py-2 pl-4 pr-2"
                    style={{ animationDelay: `${(uCount + 1 + i) * 110}ms` }}
                  >
                    {/* Image carrée 3rem : taille fixe, plus de dépendance
                        sur un compute() JS unreliable en iOS. */}
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center">
                      {ing.imageUrl ? (
                        <img
                          src={ing.imageUrl}
                          alt=""
                          className="h-12 w-12 object-contain drop-shadow-[0_5px_7px_rgba(120,60,75,0.15)]"
                        />
                      ) : (
                        // Placeholder : cercle doux + icône estompée.
                        <span className="grid h-12 w-12 place-items-center rounded-full bg-coral-soft/20 text-coral/60">
                          <Soup className="h-5 w-5" />
                        </span>
                      )}
                    </div>
                    {/* Quantité + unité ENSEMBLE, à droite de l'image. Largeur
                        mini fixe → les noms restent alignés sans déborder. */}
                    {ing.quantity != null && (
                      <div className="flex min-w-[2.75rem] shrink-0 items-baseline justify-center gap-1 text-coral">
                        <span className="text-2xl font-bold leading-none">
                          {qtyNumber(ing)}
                        </span>
                        {ing.unit && (
                          <span className="text-xs text-coral-dark/70">{ing.unit}</span>
                        )}
                      </div>
                    )}
                    {/* Nom : passe à la ligne si trop long, jamais rogné. */}
                    <div className="min-w-0 flex-1 pl-1 pr-1">
                      <p className="text-lg leading-tight text-ink [overflow-wrap:anywhere]">
                        {capitalizeFirst(ing.label)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              {/* Fondu blanc en bas TOUJOURS visible : signale qu'il peut
                  y avoir plus de contenu à scroller (même si la liste tient
                  entièrement à l'écran, ça donne juste un fondu décoratif).
                  pointer-events:none pour ne pas bloquer le scroll touch. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-white/95 via-white/40 to-transparent"
              />
            </div>
          </section>
        ) : null}

      </div>

      {/* Bloc bas : pas de cadre/bouton — juste un dégradé blanc qui monte
          du bas (extérieur) vers le haut (intérieur), fondu dans la page.
          ⚠️ paddingBottom inclut env(safe-area-inset-bottom) : sur iPhone
          la home indicator (la barre noire en bas) empiète ~34 px sur
          l'écran ; sans cette safe-area, le bouton "Suivant" / "Terminer"
          est rogné par cette zone sur les étapes chargées.
          ⚠️ Footer compacté 2026-06-13 quand un minuteur est présent :
          pt-3 au lieu de pt-6, h-[8dvh] au lieu de h-[12dvh] pour
          l'instruction, mt réduits — sinon le bouton "Suivant" devenait
          peu accessible (4-5 cm sous le pouce). */}
      <div
        className={`shrink-0 bg-gradient-to-t from-white via-white/80 to-transparent px-5 ${
          !isCookingStep && timerSec ? 'pt-3' : 'pt-5'
        }`}
        style={{
          // max(plancher, calc) : sur iPhone en mode PWA standalone,
          // env(safe-area-inset-bottom) renvoie parfois 0 (bug Safari
          // 17.x) → footer rogné par la home indicator. Le max garantit
          // au moins 2rem de marge en bas dans tous les cas, et utilise
          // la safe-area réelle quand elle est correcte.
          paddingBottom: 'max(2rem, calc(1rem + env(safe-area-inset-bottom)))',
        }}
      >
        <SectionHeading>Instruction</SectionHeading>
        <div
          className={`cook-rise mt-1.5 flex min-h-0 items-start gap-3 overflow-y-auto overscroll-contain ${
            !isCookingStep && timerSec ? 'h-[8dvh]' : 'h-[11dvh]'
          }`}
          style={{ animationDelay: `${(uCount + 1 + step.ingredients.length) * 110}ms` }}
        >
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-coral text-sm font-bold text-white">
            {index + 1}
          </span>
          <p className="text-base leading-snug text-ink sm:text-lg">{step.text}</p>
        </div>
        {/* Minuteur proposé si une durée est détectée — sauf sur les étapes
            de cuisson, qui ont déjà leur gros compteur central. Bouton
            compact (py-1.5 + text-xs) pour gagner ~20 px verticaux et
            laisser le bouton "Suivant" dans la zone confortable du pouce. */}
        {!isCookingStep && timerSec && (
          <button
            type="button"
            onClick={() => onStartTimer(timerSec)}
            className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-full bg-coral-soft/15 px-3 py-1.5 text-xs font-semibold text-coral-dark transition hover:bg-coral-soft/30 active:scale-[0.98]"
          >
            <Timer className="h-3.5 w-3.5" />
            Minuteur · {durationLabel(timerSec)}
          </button>
        )}
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={onPrev}
            disabled={index === 0}
            aria-label="Étape précédente"
            className="flex shrink-0 items-center justify-center rounded-full bg-white/70 p-3.5 text-coral-dark transition disabled:opacity-30"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={onNext}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-coral py-3.5 text-base font-bold text-white shadow-[0_12px_28px_-12px_rgba(226,120,141,0.95)] transition hover:bg-coral-dark active:scale-[0.98]"
          >
            {isLast ? (
              <>
                <Check className="h-5 w-5" /> Terminer
              </>
            ) : (
              <>
                Suivant <ArrowRight className="h-5 w-5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================== Fin ============================== */

function Done({
  title,
  backHref,
  onRestart,
}: {
  title: string;
  backHref: string;
  onRestart: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <span className="grid h-20 w-20 place-items-center rounded-full bg-sage/20 text-sage shadow-sm">
        <PartyPopper className="h-10 w-10" />
      </span>
      <div>
        <h1 className="font-script text-4xl text-coral-dark">Bravo&nbsp;!</h1>
        <p className="mt-2 text-sm text-ink-soft">{title} est prête. Bon appétit 🌸</p>
      </div>
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onRestart}
          className="rounded-full bg-coral px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-coral-dark active:scale-95"
        >
          Recommencer
        </button>
        <Link href={backHref} className="rounded-full px-4 py-2 text-xs font-semibold text-ink-soft hover:text-ink">
          Retour à la recette
        </Link>
      </div>
    </div>
  );
}

/* ============================== Pièces ============================== */

function IntroToggle({
  label,
  on,
  onToggle,
  iconOn,
  iconOff,
  disabled = false,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  iconOn: React.ReactNode;
  iconOff: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className="flex items-center justify-between gap-3 rounded-full bg-white/80 px-4 py-2 shadow-sm ring-1 ring-coral-soft/40 transition disabled:opacity-40"
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold text-coral-dark">
        {on ? iconOn : iconOff} {label}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${
          on ? 'bg-coral' : 'bg-coral-soft/60'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
            on ? 'left-[1.125rem]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}

/** Minuteur flottant : badge + petit panneau (Stop / +1 min). */
function TimerWidget({
  remaining,
  total,
  open,
  onToggleOpen,
  onAddMinute,
  onStop,
}: {
  remaining: number;
  total: number;
  open: boolean;
  onToggleOpen: () => void;
  onAddMinute: () => void;
  onStop: () => void;
}) {
  const done = remaining <= 0;
  const pct = total > 0 ? Math.min(100, ((total - remaining) / total) * 100) : 0;
  return (
    <div className="fixed bottom-24 right-4 z-30 flex flex-col items-end gap-2">
      {open && (
        <div className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-xl ring-1 ring-coral-soft/40">
          <button
            type="button"
            onClick={onAddMinute}
            className="flex items-center gap-1 rounded-full bg-coral-soft/50 px-2.5 py-1 text-xs font-semibold text-coral-dark"
          >
            <Plus className="h-3 w-3" /> 1 min
          </button>
          <button
            type="button"
            onClick={onStop}
            className="flex items-center gap-1 rounded-full bg-rose-500 px-2.5 py-1 text-xs font-semibold text-white"
          >
            <Square className="h-3 w-3" /> Stop
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={onToggleOpen}
        aria-label="Minuteur"
        className={`relative flex items-center gap-2 overflow-hidden rounded-full px-4 py-2.5 text-base font-bold shadow-lg ring-2 transition ${
          done
            ? 'animate-pulse bg-rose-500 text-white ring-white/50'
            : 'bg-white text-coral-dark ring-coral-soft/60'
        }`}
      >
        {!done && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 bg-coral-soft/40"
            style={{ width: `${pct}%` }}
          />
        )}
        <Timer className="relative h-5 w-5" />
        <span className="relative tabular-nums">
          {done ? '⏰ Terminé' : formatTimer(remaining)}
        </span>
      </button>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-3 text-coral">
      <span aria-hidden className="h-px w-8 bg-gradient-to-r from-transparent to-coral-soft" />
      <span className="font-script text-2xl leading-none">{children}</span>
      <span aria-hidden className="h-px w-8 bg-gradient-to-l from-transparent to-coral-soft" />
    </div>
  );
}

/** Met une majuscule à la première lettre (sans toucher au reste). */
function capitalizeFirst(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

const FRACTIONS: Record<number, string> = { 0.5: '½', 0.25: '¼', 0.75: '¾', 0.33: '⅓' };
/** Le nombre seul (sans unité), avec jolies fractions. */
function qtyNumber(ing: CookIngredient): string {
  if (ing.quantity == null) return '';
  return FRACTIONS[ing.quantity] ?? String(ing.quantity).replace('.', ',');
}
function fmtQty(ing: CookIngredient): string {
  if (ing.quantity == null) return '';
  const q = FRACTIONS[ing.quantity] ?? String(ing.quantity).replace('.', ',');
  return ing.unit ? `${q} ${ing.unit}` : q;
}

function RevealKeyframes() {
  return (
    <style>{`
      @keyframes cookRise { from { opacity:0; transform: translateY(0.6rem); } to { opacity:1; transform:none; } }
      .cook-rise { opacity:0; animation: cookRise 0.42s ease-out forwards; }
      @media (prefers-reduced-motion: reduce) { .cook-rise { animation:none; opacity:1; } }
    `}</style>
  );
}
