import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  BookOpenCheck,
  Building2,
  Calculator,
  ChartNoAxesColumn,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  NotebookPen,
  ScrollText,
  School,
  Settings2,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { useAuth } from '@/contexts/AuthContext';

function roleLabel(role: string) {
  switch (role) {
    case 'PLATFORM_ADMIN':
      return 'Administrateur plateforme';
    case 'SCHOOL_ADMIN':
      return "Administrateur d'établissement";
    case 'SURVEILLANT_GENERAL':
      return 'Surveillant général';
    case 'ASSISTANT':
      return 'Assistant';
    default:
      return role;
  }
}

type LinkItem = { to: string; label: string; icon: LucideIcon };
type LinkGroup = { label: string; links: LinkItem[] };

function Navigation({ groups, compact = false }: { groups: LinkGroup[]; compact?: boolean }) {
  return (
    <nav
      aria-label="Navigation principale"
      className={compact ? 'flex gap-2' : 'space-y-7'}
    >
      {groups.map((group) => (
        <div key={group.label} className={compact ? 'flex items-center gap-2' : undefined}>
          <p className={`mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/45 ${compact ? 'sr-only' : ''}`}>
            {group.label}
          </p>
          <div className={compact ? 'flex gap-1' : 'space-y-1'}>
            {group.links.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition ${
                    compact
                      ? isActive
                        ? 'bg-white text-brand-navy shadow-sm'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      : isActive
                        ? 'bg-white/12 text-white shadow-sm ring-1 ring-inset ring-white/10'
                        : 'text-white/75 hover:bg-white/10 hover:text-white'
                  } ${compact ? 'gap-2 px-3 py-2' : 'min-h-10'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      aria-hidden="true"
                      className={`h-[18px] w-[18px] shrink-0 ${
                        isActive || compact
                          ? compact ? 'text-primary' : 'text-emerald-300'
                          : 'text-white/60 group-hover:text-white'
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {isActive && <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 text-primary" />}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function Layout() {
  const { user, school, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const schoolTeam = user && ['SCHOOL_ADMIN', 'SURVEILLANT_GENERAL', 'ASSISTANT'].includes(user.role);
  const groups: LinkGroup[] = [
    {
      label: 'Mon espace',
      links: [{ to: '/', label: 'Tableau de bord', icon: LayoutDashboard }],
    },
  ];

  if (schoolTeam) {
    groups.push({
      label: 'Vie de l’établissement',
      links: [
        { to: '/eleves', label: 'Élèves', icon: GraduationCap },
        { to: '/classes', label: 'Organisation scolaire', icon: School },
        { to: '/disciplines', label: 'Disciplines et coefficients', icon: BookOpenCheck },
        { to: '/vie-scolaire', label: 'Vie scolaire', icon: BookOpenCheck },
      ],
    });
    groups.push({
      label: 'Pédagogie',
      links: [
        { to: '/saisie-notes', label: 'Saisie des notes', icon: NotebookPen },
        { to: '/types-evaluation', label: 'Types d’évaluation', icon: ClipboardList },
        { to: '/verifications', label: 'Vérifications', icon: ClipboardCheck },
        { to: '/calculs', label: 'Calcul et classement', icon: Calculator },
        { to: '/bulletins', label: 'Bulletins', icon: FileText },
        { to: '/bilan-annuel', label: 'Bilan annuel', icon: ChartNoAxesColumn },
      ],
    });
  }

  const administrationLinks: LinkItem[] = [];
  if (user?.role === 'PLATFORM_ADMIN') {
    administrationLinks.push(
      { to: '/etablissements', label: 'Établissements', icon: Building2 },
      { to: '/demandes-inscription', label: "Demandes d'inscription", icon: ClipboardCheck },
    );
  }
  if (user?.role === 'SCHOOL_ADMIN' || user?.role === 'PLATFORM_ADMIN') {
    administrationLinks.push(
      { to: '/utilisateurs', label: 'Utilisateurs', icon: Users },
      { to: '/acces-temporaire', label: 'Accès temporaire', icon: Clock3 },
      { to: '/journal-audit', label: "Journal d'audit", icon: ScrollText },
    );
  }
  if (user?.role === 'SCHOOL_ADMIN') {
    administrationLinks.push({
      to: '/parametres-etablissement',
      label: 'Paramètres',
      icon: Settings2,
    });
  }
  if (administrationLinks.length > 0) {
    groups.push({ label: 'Administration', links: administrationLinks });
  }

  groups.push({
    label: 'Compte',
    links: [{ to: '/profil', label: 'Mon profil', icon: UserRound }],
  });

  const activePage = groups.flatMap((group) => group.links).find((link) =>
    link.to === '/' ? location.pathname === '/' : location.pathname.startsWith(link.to),
  );
  const initials = user?.name
    ?.split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toLocaleUpperCase('fr-FR'))
    .join('') ?? 'BS';

  const handleLogout = async () => {
    await logout();
    navigate('/connexion', { replace: true });
  };

  const account = (inSidebar = false) => (
    <div className="flex min-w-0 items-center gap-3">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${inSidebar ? 'bg-white/10 text-white' : 'bg-primary/10 text-primary'}`}>
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`hidden truncate text-sm font-semibold sm:block ${inSidebar ? 'text-white' : 'text-slate-800'}`}>{user?.name}</p>
        <p className={`hidden truncate text-xs sm:block ${inSidebar ? 'text-white/65' : 'text-slate-500'}`}>{user ? roleLabel(user.role) : ''}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className={`h-9 w-9 shrink-0 ${inSidebar ? 'text-white/70 hover:bg-white/10 hover:text-white' : 'text-slate-500 hover:bg-red-50 hover:text-red-700'}`}
        onClick={handleLogout}
        aria-label="Déconnexion"
        title="Déconnexion"
      >
        <LogOut aria-hidden="true" className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <SidebarProvider className="min-h-screen bg-background text-foreground">
      <Sidebar collapsible="none" role="complementary" aria-label="Navigation de l’établissement" className="hidden min-h-screen bg-sidebar px-4 py-6 text-sidebar-foreground md:hidden lg:flex">
        <SidebarHeader className="mb-7 flex-row items-center gap-3 border-b border-white/10 px-2 pb-5 pt-1">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm">
            <img src="/logo.svg" alt="" className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-tight">Bulletins Scolaires</p>
            <p className="mt-1 truncate text-xs text-sidebar-foreground/65">{school?.name ?? 'Espace plateforme'}</p>
          </div>
        </SidebarHeader>
        <SidebarContent className="min-h-0 flex-1 overflow-y-auto px-0 py-2 pr-1">
          <Navigation groups={groups} />
        </SidebarContent>
        <SidebarFooter className="mt-6 rounded-2xl border border-sidebar-border bg-white/[0.06] p-3.5">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold text-sidebar-foreground/65">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 text-emerald-300" />
            Espace sécurisé
          </div>
          {account(true)}
          <p className="px-2 pt-3 text-[10px] text-sidebar-foreground/50">Gestion scolaire</p>
        </SidebarFooter>
      </Sidebar>

      <div className="min-w-0 flex-1 overflow-x-clip">
        <header className="sticky top-0 z-20 border-b border-border/80 bg-card px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-h-11 items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 lg:hidden">
                <img src="/logo.svg" alt="" className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {activePage?.label ?? 'Espace de gestion'}
                </p>
                <p className="hidden truncate text-xs text-muted-foreground sm:block">
                  {school?.name ?? roleLabel(user?.role ?? '')}
                </p>
              </div>
            </div>
            <div className="flex max-w-[190px] items-center gap-3 sm:max-w-none lg:hidden">{account()}</div>
            <div className="hidden items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary lg:flex">
              <span className="h-2 w-2 rounded-full bg-primary" />
              Portail sécurisé
            </div>
          </div>
          <div className="-mx-1 mt-3 overflow-x-auto pb-1 lg:hidden">
          <div className="min-w-max"><Navigation groups={groups} compact /></div>
          </div>
        </header>
        <main className="app-main mx-auto w-full max-w-[1480px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-9">
          <Outlet />
        </main>
      </div>
    </SidebarProvider>
  );
}
