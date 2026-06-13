'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ExternalLink,
  RotateCcw,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

/**
 * Checklist manuelle des accès depuis la home en mode visiteur (non
 * connecté). Persistée en localStorage : chaque case cochée survit au
 * refresh, mais reste locale au navigateur (pas de partage entre
 * machines — c'est intentionnel, on teste depuis plusieurs devices).
 *
 * Structure : sections > items. Un item peut avoir :
 *  - `target` : URL ouvrable d'un clic (bouton "Ouvrir →")
 *  - `severity` : 'critical' (sécurité) | 'major' | 'minor'
 *  - `notes` : précisions ou pièges connus
 */

type Severity = 'critical' | 'major' | 'minor';

type Item = {
  id: string;
  label: string;
  expected: string;
  /** Si défini, bouton "Ouvrir →" qui pointe vers cette URL. */
  target?: string;
  severity: Severity;
  notes?: string;
};

type Section = {
  id: string;
  title: string;
  description?: string;
  items: Item[];
};

const CHECKLIST: Section[] = [
  {
    id: 'tuiles',
    title: 'Tuiles principales (4 grandes cartes)',
    description:
      'Chaque tuile est lockée ou non selon la capability `allowed_without_plan` (voir /admin/permissions). Pour un visiteur, l\'état attendu dépend de cette config.',
    items: [
      {
        id: 'tile-menus',
        label: 'Cliquer sur la tuile "Menu de la semaine"',
        expected:
          'Si capability menus.allowed_without_plan = false → tuile lockée (cadenas visible) ET clic redirige vers /login?next=/menus. Sinon → ouvre /menus.',
        target: '/menus',
        severity: 'critical',
      },
      {
        id: 'tile-recettes',
        label: 'Cliquer sur la tuile "Idées recettes"',
        expected:
          'Idem : si lockée → /login?next=/recettes. Sinon ouvre /recettes.',
        target: '/recettes',
        severity: 'critical',
      },
      {
        id: 'tile-conseils',
        label: 'Cliquer sur la tuile "Conseils santé"',
        expected: 'Idem : si lockée → /login?next=/conseils. Sinon /conseils.',
        target: '/conseils',
        severity: 'critical',
      },
      {
        id: 'tile-astuces',
        label: 'Cliquer sur la tuile "Astuces diététiques"',
        expected: 'Idem : si lockée → /login?next=/astuces. Sinon /astuces.',
        target: '/astuces',
        severity: 'critical',
      },
      {
        id: 'tile-cadenas-visible',
        label: 'Vérifier l\'icône cadenas sur les tuiles lockées',
        expected:
          'Icône 🔒 (ou équivalent) visible sur la tuile lockée ; non visible sur la tuile autorisée. Pas de tuile à la fois lockée ET sans cadenas.',
        severity: 'major',
      },
      {
        id: 'tile-burst-double',
        label: 'Double-cliquer rapidement sur "Recettes" (burst animation)',
        expected:
          'L\'animation burst ne joue qu\'une fois, pas de transition empilée, l\'historique browser n\'a pas 2 entrées /recettes.',
        target: '/recettes',
        severity: 'minor',
        notes:
          'La prop burstOnClick est active uniquement sur la tuile Recettes.',
      },
    ],
  },
  {
    id: 'header',
    title: 'Header (AppHeader)',
    description:
      'Le header est sticky. Burger à gauche, titre/wordmark centré, avatar/notif/flamme à droite.',
    items: [
      {
        id: 'hdr-burger',
        label: 'Cliquer sur l\'icône burger (menu)',
        expected:
          'Le drawer s\'ouvre. Il contient au minimum : "À propos", "Connexion", éventuellement "Idées". Aucun lien admin visible.',
        severity: 'critical',
      },
      {
        id: 'hdr-burger-spam',
        label: 'Spam-cliquer le burger 5x très vite',
        expected:
          'Le drawer toggle proprement (ouvert/fermé/ouvert/…) sans état incohérent, sans double overlay, sans freeze.',
        severity: 'minor',
      },
      {
        id: 'hdr-logo',
        label: 'Cliquer sur le logo / wordmark "Karine"',
        expected:
          'Reste sur la home (/) ou comportement défini. Pas d\'erreur.',
        target: '/',
        severity: 'minor',
      },
      {
        id: 'hdr-avatar',
        label: 'Cliquer sur l\'avatar/profil (icône à droite)',
        expected:
          'Redirige vers /login?next=/profil (ou ouvre /login). Pas d\'avatar pré-rempli sans cookie.',
        target: '/profil',
        severity: 'critical',
      },
      {
        id: 'hdr-notif',
        label: 'Cliquer sur l\'icône cloche (notifications)',
        expected:
          'Redirige /login?next=/notifications. Le badge "non lu" doit être à 0 ou absent.',
        target: '/notifications',
        severity: 'critical',
      },
      {
        id: 'hdr-flamme',
        label: 'Cliquer sur l\'icône flamme (calorie tracker)',
        expected:
          'Si feature ON globalement → redirige vers /login (cf. trackingBehavior="login" pour visiteur). Si feature OFF → icône cachée.',
        severity: 'critical',
        notes:
          'Vérifier dans /admin/parametres que calorieTrackerEnabled est actif pour tester ce cas.',
      },
    ],
  },
  {
    id: 'bottomnav',
    title: 'BottomNav (barre de navigation du bas)',
    description: 'Présente sur toutes les pages user, fixée en bas.',
    items: [
      {
        id: 'bn-home',
        label: 'Cliquer "Accueil"',
        expected: 'Reste / recharge la home /. Pas de scroll-up cassé.',
        target: '/',
        severity: 'major',
      },
      {
        id: 'bn-courses',
        label: 'Cliquer "Mes courses"',
        expected: 'Redirige /login?next=/courses (page protégée).',
        target: '/courses',
        severity: 'critical',
      },
      {
        id: 'bn-favoris',
        label: 'Cliquer "Favoris"',
        expected: 'Redirige /login?next=/favoris.',
        target: '/favoris',
        severity: 'critical',
      },
      {
        id: 'bn-camera',
        label: 'Cliquer le FAB caméra (au centre)',
        expected:
          'Sans auth → /login (ou alerte demandant la connexion). PAS d\'ouverture directe du picker d\'image.',
        severity: 'critical',
      },
      {
        id: 'bn-idee',
        label: 'Cliquer "Une idée ?" (ampoule)',
        expected:
          'Ouvre un formulaire ou redirige /login. Comportement défini, pas de modal fantôme.',
        severity: 'major',
      },
    ],
  },
  {
    id: 'saviezvous',
    title: 'Carrousel "Saviez-vous ?" (sous les tuiles)',
    description:
      'Affiché sous le grid des tuiles si des featured photos sont publiées.',
    items: [
      {
        id: 'sv-swipe',
        label: 'Swiper / scroller horizontalement le carrousel',
        expected: 'Défilement fluide, snap sur chaque carte, pas de jank.',
        severity: 'minor',
      },
      {
        id: 'sv-like',
        label: 'Cliquer ❤️ Like sur un saviez-vous',
        expected:
          'Sans auth → soit redirige /login, soit affiche une modale "Connectez-vous pour aimer". Le compteur ne doit PAS s\'incrémenter sans backend.',
        severity: 'critical',
      },
      {
        id: 'sv-like-spam',
        label: 'Spam-cliquer ❤️ 10x rapidement sans auth',
        expected:
          'Une seule redirection / une seule modale, pas de 10 logs serveur ni 10 toasts.',
        severity: 'major',
      },
      {
        id: 'sv-fav',
        label: 'Cliquer 🔖 Favoris sur un saviez-vous',
        expected: 'Sans auth → /login ou modale. Pareil que like.',
        severity: 'critical',
      },
    ],
  },
  {
    id: 'deeplinks',
    title: 'Deep-links directs (URL collée dans la barre)',
    description:
      'Simule un partage WhatsApp / lien externe. Chaque URL doit être protégée par le middleware Supabase, pas seulement par l\'UI.',
    items: [
      {
        id: 'dl-courses',
        label: 'Coller /courses dans la barre URL',
        expected: 'Redirige 307 → /login?next=/courses.',
        target: '/courses',
        severity: 'critical',
      },
      {
        id: 'dl-favoris',
        label: 'Coller /favoris',
        expected: 'Redirige 307 → /login?next=/favoris.',
        target: '/favoris',
        severity: 'critical',
      },
      {
        id: 'dl-calories',
        label: 'Coller /mes-calories',
        expected: 'Redirige /login?next=/mes-calories.',
        target: '/mes-calories',
        severity: 'critical',
      },
      {
        id: 'dl-stats',
        label: 'Coller /mes-stats',
        expected: 'Redirige /login?next=/mes-stats.',
        target: '/mes-stats',
        severity: 'critical',
      },
      {
        id: 'dl-repas',
        label: 'Coller /mes-repas',
        expected: 'Redirige /login?next=/mes-repas.',
        target: '/mes-repas',
        severity: 'critical',
      },
      {
        id: 'dl-profil',
        label: 'Coller /profil',
        expected: 'Redirige /login?next=/profil.',
        target: '/profil',
        severity: 'critical',
      },
      {
        id: 'dl-monplan',
        label: 'Coller /mon-plan',
        expected: 'Redirige /login?next=/mon-plan.',
        target: '/mon-plan',
        severity: 'critical',
      },
      {
        id: 'dl-notifs',
        label: 'Coller /notifications',
        expected: 'Redirige /login?next=/notifications.',
        target: '/notifications',
        severity: 'critical',
      },
      {
        id: 'dl-courses-hist',
        label: 'Coller /courses/historique',
        expected: 'Redirige /login?next=/courses/historique.',
        target: '/courses/historique',
        severity: 'critical',
      },
      {
        id: 'dl-admin',
        label: 'Coller /admin',
        expected:
          'Redirige /admin/login (ou /login). NE doit PAS afficher de contenu admin même 1 frame.',
        target: '/admin',
        severity: 'critical',
      },
      {
        id: 'dl-tutos',
        label: 'Coller /tutos',
        expected: 'Accessible publiquement OU redirige login (à confirmer).',
        target: '/tutos',
        severity: 'minor',
      },
    ],
  },
  {
    id: 'public',
    title: 'Pages publiques (doivent rester accessibles)',
    description:
      'Pages qui DOIVENT rester ouvertes au visiteur sans login (info légale, marketing).',
    items: [
      {
        id: 'pub-apropos',
        label: 'Accéder /a-propos',
        expected: 'Page À propos s\'affiche, pas de redirection.',
        target: '/a-propos',
        severity: 'major',
      },
      {
        id: 'pub-mentions',
        label: 'Accéder /mentions-legales',
        expected: 'Page mentions s\'affiche. Flèche retour → /a-propos.',
        target: '/mentions-legales',
        severity: 'major',
      },
      {
        id: 'pub-cgu',
        label: 'Accéder /cgu',
        expected: 'CGU affichées. Flèche retour → /a-propos.',
        target: '/cgu',
        severity: 'major',
      },
      {
        id: 'pub-cgv',
        label: 'Accéder /cgv',
        expected: 'CGV affichées. Flèche retour → /a-propos.',
        target: '/cgv',
        severity: 'major',
      },
      {
        id: 'pub-conf',
        label: 'Accéder /confidentialite',
        expected: 'Politique de confidentialité affichée. Flèche retour → /a-propos.',
        target: '/confidentialite',
        severity: 'major',
      },
      {
        id: 'pub-login',
        label: 'Accéder /login',
        expected: 'Formulaire de connexion affiché.',
        target: '/login',
        severity: 'critical',
      },
      {
        id: 'pub-signup',
        label: 'Accéder /signup',
        expected: 'Formulaire d\'inscription affiché.',
        target: '/signup',
        severity: 'critical',
      },
      {
        id: 'pub-forgot',
        label: 'Accéder /mot-de-passe-oublie',
        expected: 'Formulaire reset mot de passe.',
        target: '/mot-de-passe-oublie',
        severity: 'major',
      },
    ],
  },
  {
    id: 'flux-login',
    title: 'Flux de redirection après login',
    description:
      'Quand le visiteur est redirigé vers /login depuis une page protégée, après authentification il doit revenir sur la page initiale.',
    items: [
      {
        id: 'flx-redirect-back',
        label:
          'Cliquer "Mes courses" → arrive /login?next=/courses → se connecter avec un compte abonné',
        expected:
          'Après login réussi, redirige vers /courses (pas vers /).',
        severity: 'critical',
      },
      {
        id: 'flx-refresh-login',
        label: 'Sur /login?next=/favoris, faire F5',
        expected:
          'Reste sur /login?next=/favoris, le paramètre next est préservé.',
        severity: 'major',
      },
      {
        id: 'flx-back-after-login',
        label: 'Après login réussi, cliquer ⬅️ Back du navigateur',
        expected:
          'Ne revient PAS sur /login (sinon boucle). Le history.back doit aller à la page d\'avant le clic initial sur "Mes courses".',
        severity: 'major',
      },
    ],
  },
  {
    id: 'doubles',
    title: 'Comportement clics multiples / submits multiples',
    description:
      'Tout bouton qui déclenche une action sensible (navigation, form submit, modale) doit être idempotent.',
    items: [
      {
        id: 'dbl-tile',
        label: 'Triple-clic ultra rapide sur une tuile lockée',
        expected:
          'Une seule entrée history (back ne sort pas de la PWA en 1 clic), pas de double redirect.',
        severity: 'major',
      },
      {
        id: 'dbl-login-submit',
        label: 'Sur /login, spam-cliquer "Se connecter"',
        expected:
          'Bouton désactivé après 1er clic (state loading) OU le serveur idempotent. Pas de double session ni double email.',
        severity: 'critical',
      },
      {
        id: 'dbl-signup-submit',
        label: 'Sur /signup, spam-cliquer "Créer mon compte"',
        expected:
          'Bouton désactivé pendant submit. Pas de 2 utilisateurs créés.',
        severity: 'critical',
      },
      {
        id: 'dbl-back-multiple',
        label: 'Ouvrir /a-propos puis spam-cliquer la flèche retour',
        expected:
          'Une seule navigation vers /, pas 5 entrées history poppées.',
        severity: 'minor',
      },
    ],
  },
  {
    id: 'extras',
    title: 'Cas additionnels à vérifier',
    description:
      'Edge cases que je vois en lisant le code. À ajuster au fil des découvertes.',
    items: [
      {
        id: 'ext-as-visitor',
        label:
          'Connecté en admin, ouvrir /?as=visitor — la home doit s\'afficher comme un visiteur',
        expected:
          'Pas de redirect vers /admin. Le burger reste admin (?) ou bascule visiteur. À documenter.',
        target: '/?as=visitor',
        severity: 'minor',
      },
      {
        id: 'ext-noscript',
        label:
          'Désactiver JS dans le navigateur et recharger la home',
        expected:
          'Le contenu principal s\'affiche (Server Components). Les interactions (burger, like) sont dégradées mais pas cassées.',
        severity: 'minor',
      },
      {
        id: 'ext-mobile-360',
        label: 'Tester sur viewport 360x640 (mobile S)',
        expected:
          'Tuiles 2x2 lisibles, BottomNav non tronquée, header sticky propre. Pas de scroll horizontal.',
        severity: 'major',
      },
      {
        id: 'ext-mobile-rotate',
        label: 'Faire tourner l\'écran portrait → paysage',
        expected: 'Layout s\'adapte, pas de débordement, BottomNav reste en bas.',
        severity: 'minor',
      },
      {
        id: 'ext-prefetch',
        label:
          'Voir le Network tab : tous les Link prefetchent-ils des pages protégées ?',
        expected:
          'Le prefetch d\'une page protégée renvoie un 307 vers /login, pas le contenu protégé. Aucune donnée privée leakée dans le HTML prefetché.',
        severity: 'critical',
      },
      {
        id: 'ext-cookies-cleared',
        label:
          'Effacer tous les cookies, recharger /, vérifier l\'état affiché',
        expected:
          'Comportement "visiteur" cohérent : pas de favoris affichés, pas d\'avatar pré-rempli, pas de menu admin.',
        severity: 'critical',
      },
    ],
  },
];

const STORAGE_KEY = 'karine-admin-visitor-home-checklist-v1';

type SeverityMeta = { label: string; bg: string; text: string };
const SEVERITY: Record<Severity, SeverityMeta> = {
  critical: {
    label: 'Critique',
    bg: 'bg-red-100',
    text: 'text-red-800',
  },
  major: { label: 'Majeur', bg: 'bg-amber-100', text: 'text-amber-800' },
  minor: { label: 'Mineur', bg: 'bg-slate-100', text: 'text-slate-700' },
};

export function VisitorHomeChecklist() {
  // Map { itemId → checked } persistée en localStorage.
  const [state, setState] = useState<Record<string, boolean>>({});
  // Hydratation : on attend le mount avant de lire localStorage (sinon
  // mismatch SSR/CSR sur la 1re frame).
  const [hydrated, setHydrated] = useState(false);
  // Sections pliables. Ouvertes par défaut au premier affichage.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Mode "Confirmer ?" du bouton reset : 1er clic arme, 2e clic exécute.
  // Auto-désarmement après 4s (cf. useEffect) pour ne pas piéger la
  // prochaine action.
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw));
    } catch {
      /* localStorage indisponible (mode privé strict) → on reste à vide */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore : quota dépassé, mode privé, etc. */
    }
  }, [state, hydrated]);

  const allItems = useMemo(
    () => CHECKLIST.flatMap((s) => s.items.map((i) => ({ ...i, sectionId: s.id }))),
    [],
  );
  const checkedCount = useMemo(
    () => allItems.filter((i) => state[i.id]).length,
    [allItems, state],
  );
  const totalCount = allItems.length;
  const pct = totalCount === 0 ? 0 : Math.round((checkedCount / totalCount) * 100);

  // Compteur par sévérité — utile pour voir si on a couvert tous les critical.
  const bySev = useMemo(() => {
    const acc: Record<Severity, { done: number; total: number }> = {
      critical: { done: 0, total: 0 },
      major: { done: 0, total: 0 },
      minor: { done: 0, total: 0 },
    };
    for (const it of allItems) {
      acc[it.severity].total += 1;
      if (state[it.id]) acc[it.severity].done += 1;
    }
    return acc;
  }, [allItems, state]);

  const toggle = (id: string) =>
    setState((prev) => ({ ...prev, [id]: !prev[id] }));

  const toggleSection = (sid: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });

  const reset = () => {
    // Confirmation custom (jamais de window.confirm — règle projet).
    if (confirmReset) {
      setState({});
      setConfirmReset(false);
    } else {
      setConfirmReset(true);
    }
  };

  // Auto-désarme le mode "Confirmer ?" après 4s sans 2e clic pour
  // éviter de piéger la prochaine action de Karine.
  useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(t);
  }, [confirmReset]);

  return (
    <div className="space-y-4">
      {/* Barre de progression + compteurs */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-admin-border">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-admin-ink-soft">
              Progression globale
            </p>
            <p className="mt-0.5 text-2xl font-bold text-admin-primary-dark">
              {checkedCount}
              <span className="text-base font-semibold text-admin-ink-soft">
                {' '}
                / {totalCount}
              </span>
              <span className="ml-2 text-base font-semibold text-admin-ink-soft">
                ({pct}%)
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition ${
              confirmReset
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-admin-soft text-admin-ink-soft hover:bg-admin-soft/70'
            }`}
            title="Réinitialiser toutes les cases (local au navigateur)"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {confirmReset ? 'Confirmer ?' : 'Tout réinitialiser'}
          </button>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-admin-soft">
          <div
            className="h-full bg-admin-primary transition-all"
            style={{ width: `${pct}%` }}
            aria-label={`${pct}% complété`}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[0.7rem]">
          {(['critical', 'major', 'minor'] as Severity[]).map((sev) => {
            const meta = SEVERITY[sev];
            const { done, total } = bySev[sev];
            return (
              <span
                key={sev}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${meta.bg} ${meta.text}`}
              >
                {meta.label} : {done}/{total}
              </span>
            );
          })}
        </div>
      </div>

      {/* Avertissement contexte navigation privée */}
      <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600" />
        <p>
          Les ouvertures via le bouton{' '}
          <span className="font-semibold">« Ouvrir → »</span> se font dans un
          NOUVEL ONGLET. Si tu testes le comportement visiteur depuis un onglet
          admin, le 2e onglet HÉRITE de la session admin → tu seras redirigée
          vers /admin. Toujours tester depuis une fenêtre de navigation
          PRIVÉE, déconnectée, ou avec ?as=visitor sur la home.
        </p>
      </div>

      {/* Sections */}
      {CHECKLIST.map((section) => {
        const isCollapsed = collapsed.has(section.id);
        const sectionDone = section.items.filter((i) => state[i.id]).length;
        const sectionTotal = section.items.length;
        return (
          <section
            key={section.id}
            className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-admin-border"
          >
            <button
              type="button"
              onClick={() => toggleSection(section.id)}
              className="flex w-full items-center gap-2 border-b border-admin-border px-4 py-3 text-left transition hover:bg-admin-soft/30"
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4 text-admin-ink-soft" />
              ) : (
                <ChevronDown className="h-4 w-4 text-admin-ink-soft" />
              )}
              <h3 className="flex-1 font-bold text-admin-primary-dark">
                {section.title}
              </h3>
              <span className="rounded-full bg-admin-soft px-2 py-0.5 text-[0.7rem] font-semibold text-admin-ink-soft">
                {sectionDone}/{sectionTotal}
              </span>
            </button>
            {!isCollapsed && (
              <div className="divide-y divide-admin-border">
                {section.description && (
                  <p className="bg-admin-soft/20 px-4 py-2 text-xs italic text-admin-ink-soft">
                    {section.description}
                  </p>
                )}
                {section.items.map((item) => {
                  const checked = !!state[item.id];
                  const sev = SEVERITY[item.severity];
                  return (
                    <div
                      key={item.id}
                      className={`flex items-start gap-3 px-4 py-3 transition ${
                        checked ? 'bg-emerald-50/60' : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggle(item.id)}
                        aria-pressed={checked}
                        aria-label={
                          checked
                            ? 'Décocher ' + item.label
                            : 'Cocher ' + item.label
                        }
                        className={`mt-0.5 grid h-5 w-5 flex-none place-items-center rounded border-2 transition ${
                          checked
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : 'border-admin-border bg-white hover:border-admin-primary'
                        }`}
                      >
                        {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p
                            className={`text-sm font-semibold ${
                              checked ? 'text-admin-ink-soft line-through' : 'text-admin-ink'
                            }`}
                          >
                            {item.label}
                          </p>
                          <span
                            className={`inline-flex rounded-full px-1.5 py-0.5 text-[0.65rem] font-bold uppercase ${sev.bg} ${sev.text}`}
                          >
                            {sev.label}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-admin-ink-soft">
                          <span className="font-semibold text-admin-primary-dark">
                            Attendu :
                          </span>{' '}
                          {item.expected}
                        </p>
                        {item.notes && (
                          <p className="mt-1 text-[0.7rem] italic text-admin-ink-soft/80">
                            ⓘ {item.notes}
                          </p>
                        )}
                      </div>
                      {item.target && (
                        <a
                          href={item.target}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-admin-primary-dark"
                        >
                          Ouvrir
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
