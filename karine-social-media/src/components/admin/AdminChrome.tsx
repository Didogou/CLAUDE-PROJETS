'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Menu,
  X,
  LayoutDashboard,
  ChefHat,
  ClipboardList,
  FileText,
  Leaf,
  Sparkles,
  Users,
  Settings,
  LogOut,
  ExternalLink,
  MessageSquare,
  HeartHandshake,
  Image as ImageIcon,
  Lightbulb,
  Shield,
  ShieldAlert,
  SlidersHorizontal,
  Apple,
  Scale,
  FlaskConical,
  Tag,
  Award,
  TrendingUp,
  Database,
  Download,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

// Un menu peut etre un lien direct, ou un groupe qui contient des
// sous-liens (rendus indentés). Les groupes ne sont pas cliquables.
type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };
type NavGroup = {
  label: string;
  icon: typeof LayoutDashboard;
  children: NavItem[];
};
type Section = NavItem | NavGroup;

function isGroup(s: Section): s is NavGroup {
  return 'children' in s;
}

const SECTIONS: Section[] = [
  { href: '/admin', label: 'Tableau de bord', icon: LayoutDashboard },
  { href: '/admin/recettes', label: 'Recettes', icon: ChefHat },
  { href: '/admin/recettes/nutriscore', label: 'Nutri-Score', icon: Award },
  { href: '/admin/labels', label: 'Labels diététiques', icon: Shield },
  {
    label: 'Ciqual',
    icon: Database,
    children: [
      { href: '/admin/recettes/ciqual-base', label: 'Base Ciqual', icon: Apple },
      { href: '/admin/recettes/audit-ciqual', label: 'Audit Ciqual IA', icon: FlaskConical },
      { href: '/admin/ciqual-aliases', label: 'Aliases', icon: Tag },
      { href: '/admin/portions', label: 'Portions', icon: Scale },
      { href: '/admin/ciqual', label: 'Import ANSES', icon: Download },
    ],
  },
  { href: '/admin/stats', label: 'Trafic', icon: TrendingUp },
  { href: '/admin/menus', label: 'Menus', icon: ClipboardList },
  { href: '/admin/conseils', label: 'Conseils', icon: Leaf },
  { href: '/admin/astuces', label: 'Astuces', icon: Sparkles },
  { href: '/admin/avis', label: 'Avis', icon: MessageSquare },
  { href: '/admin/moderation', label: 'Modération', icon: ShieldAlert },
  { href: '/admin/idees', label: 'Idées', icon: Lightbulb },
  { href: '/admin/le-saviez-vous', label: 'Le saviez-vous ?', icon: ImageIcon },
  { href: '/admin/patientes', label: 'Patientes', icon: HeartHandshake },
  { href: '/admin/abonnes', label: 'Abonnés', icon: Users },
  { href: '/admin/permissions', label: 'Permissions', icon: Shield },
  { href: '/admin/informations-legales', label: 'Infos légales & banque', icon: FileText },
  { href: '/admin/parse-tests', label: 'Tests parsing', icon: FlaskConical },
  { href: '/admin/parametres', label: 'Paramètres', icon: SlidersHorizontal },
  { href: '/admin/parametres/encouragements', label: 'Encouragements', icon: Sparkles },
  { href: '/admin/tests', label: 'Tests E2E', icon: FlaskConical },
  { href: '/admin/compte', label: 'Compte', icon: Settings },
];

// Tous les items "plats" (groupes deplies) pour recherche d'active state
const FLAT_ITEMS: NavItem[] = SECTIONS.flatMap((s) =>
  isGroup(s) ? s.children : [s],
);

function isActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(href + '/');
}

function currentTitle(pathname: string): string {
  const match = FLAT_ITEMS.find((s) => isActive(pathname, s.href));
  return match?.label ?? 'Admin';
}

export function AdminChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/admin';
  const [open, setOpen] = useState(false);
  // Groupes deplies par leur label. Vide par defaut → groupes plies.
  // Auto-deploiement si une sous-page est active : voir useMemo.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const title = currentTitle(pathname);

  const groupIsOpen = (label: string, hasActiveChild: boolean) =>
    hasActiveChild || openGroups.has(label);
  const toggleGroup = (label: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  return (
    <div className="min-h-screen bg-admin-bg text-admin-ink">
      {/* Top bar */}
      <header
        className="sticky top-0 z-30 flex items-center justify-between border-b border-admin-border bg-admin-surface/95 px-4 py-3 backdrop-blur"
        style={{
          // PWA iOS standalone : evite que le header passe sous l'island/notch.
          paddingTop: 'calc(0.75rem + env(safe-area-inset-top))',
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ouvrir le menu"
          className="grid h-10 w-10 place-items-center rounded-full text-admin-primary-dark transition hover:bg-admin-soft/50"
        >
          <Menu className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <h1 className="truncate text-base font-bold text-admin-ink-soft">{title}</h1>
        <Link
          href="/admin/compte"
          aria-label="Mon compte"
          className="grid h-9 w-9 place-items-center rounded-full bg-admin-primary text-sm font-bold text-white shadow-sm transition hover:scale-105"
        >
          K
        </Link>
      </header>

      {/* Drawer */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-admin-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-admin-border px-4 py-4">
              <div className="leading-none">
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.3em] text-admin-primary">
                  Espace admin
                </p>
                <span className="font-script text-3xl text-admin-primary-dark">Karine</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer le menu"
                className="grid h-9 w-9 place-items-center rounded-full text-admin-ink-soft hover:bg-admin-soft/50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-3">
              {SECTIONS.map((section, i) => {
                if (isGroup(section)) {
                  const GroupIcon = section.icon;
                  const hasActiveChild = section.children.some((c) => isActive(pathname, c.href));
                  const isOpenGroup = groupIsOpen(section.label, hasActiveChild);
                  return (
                    <div key={`group-${i}`} className="mb-1">
                      <button
                        type="button"
                        onClick={() => toggleGroup(section.label)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                          hasActiveChild
                            ? 'text-admin-primary-dark'
                            : 'text-admin-ink hover:bg-admin-soft/40'
                        }`}
                        aria-expanded={isOpenGroup}
                      >
                        <GroupIcon
                          className={`h-5 w-5 ${hasActiveChild ? 'text-admin-primary-dark' : 'text-admin-primary'}`}
                          strokeWidth={2.2}
                        />
                        <span className="flex-1 text-left">{section.label}</span>
                        {isOpenGroup ? (
                          <ChevronDown className="h-4 w-4 text-admin-ink-soft" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-admin-ink-soft" />
                        )}
                      </button>
                      {isOpenGroup && (
                        <div className="ml-3 border-l border-admin-border pl-2">
                          {section.children.map(({ href, label, icon: Icon }) => {
                            const active = isActive(pathname, href);
                            return (
                              <Link
                                key={href}
                                href={href}
                                onClick={() => setOpen(false)}
                                className={`mb-0.5 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[0.85rem] font-semibold transition ${
                                  active
                                    ? 'bg-admin-primary text-white shadow-sm'
                                    : 'text-admin-ink hover:bg-admin-soft/40'
                                }`}
                              >
                                <Icon
                                  className={`h-4 w-4 ${active ? 'text-white' : 'text-admin-primary'}`}
                                  strokeWidth={2.2}
                                />
                                {label}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }
                const { href, label, icon: Icon } = section;
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={`mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                      active
                        ? 'bg-admin-primary text-white shadow-sm'
                        : 'text-admin-ink hover:bg-admin-soft/40'
                    }`}
                  >
                    <Icon
                      className={`h-5 w-5 ${active ? 'text-white' : 'text-admin-primary'}`}
                      strokeWidth={2.2}
                    />
                    {label}
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-admin-border p-3">
              <Link
                href="/?as=visitor"
                onClick={() => setOpen(false)}
                className="mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-admin-ink-soft transition hover:bg-admin-soft/40"
              >
                <ExternalLink className="h-5 w-5" />
                Voir le site abonné
              </Link>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-admin-ink-soft transition hover:bg-admin-soft/40"
                >
                  <LogOut className="h-5 w-5" />
                  Déconnexion
                </button>
              </form>
            </div>
          </aside>
        </>
      )}

      {/* Contenu — overflow-x:clip empêche tout débordement horizontal
          d'un descendant de créer un scroll latéral parasite. Patch
          défensif, pas la solution idéale, à creuser plus tard. */}
      <main className="mx-auto w-full max-w-5xl overflow-x-clip px-4 py-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
