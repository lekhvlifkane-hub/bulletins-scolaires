import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
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

type LinkItem = { to: string; label: string };

function Navigation({ links }: { links: LinkItem[] }) {
  return (
    <nav aria-label="Navigation principale" className="flex gap-1 overflow-x-auto text-sm lg:flex-col lg:overflow-visible">
      {links.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `shrink-0 rounded-md px-3 py-2 hover:bg-muted ${isActive ? 'bg-muted font-semibold text-primary' : ''}`
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Layout() {
  const { user, school, logout } = useAuth();
  const navigate = useNavigate();
  const schoolTeam = user && ['SCHOOL_ADMIN', 'SURVEILLANT_GENERAL', 'ASSISTANT'].includes(user.role);
  const links: LinkItem[] = [{ to: '/', label: 'Tableau de bord' }];

  if (schoolTeam) {
    links.push(
      { to: '/eleves', label: 'Élèves' },
      { to: '/vie-scolaire', label: 'Vie scolaire' },
      { to: '/saisie-notes', label: 'Saisie des notes' },
      { to: '/verifications', label: 'Vérifications' },
      { to: '/calculs', label: 'Calcul et classement' },
      { to: '/bulletins', label: 'Bulletins' },
      { to: '/bilan-annuel', label: 'Bilan annuel' },
    );
  }
  if (user?.role === 'SCHOOL_ADMIN' || user?.role === 'PLATFORM_ADMIN') {
    links.push(
      { to: '/utilisateurs', label: 'Utilisateurs' },
      { to: '/acces-temporaire', label: 'Accès temporaire' },
      { to: '/journal-audit', label: "Journal d'audit" },
    );
  }
  if (user?.role === 'SCHOOL_ADMIN') {
    links.push({ to: '/parametres-etablissement', label: 'Paramètres établissement' });
  }
  if (user?.role === 'PLATFORM_ADMIN') {
    links.push({ to: '/etablissements', label: 'Établissements' });
    links.push({ to: '/demandes-inscription', label: "Demandes d'inscription" });
  }
  links.push({ to: '/profil', label: 'Profil' });

  const handleLogout = async () => {
    await logout();
    navigate('/connexion', { replace: true });
  };

  const account = (
    <div className="flex items-center justify-between gap-3 lg:block lg:border-t lg:border-border lg:pt-4">
      <div className="min-w-0 lg:mb-3">
        <p className="truncate text-sm font-medium">{user?.name}</p>
        <p className="truncate text-xs text-muted-foreground">{user ? roleLabel(user.role) : ''}</p>
      </div>
      <Button variant="outline" size="sm" onClick={handleLogout}>Déconnexion</Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden min-h-screen flex-col border-r border-border bg-card px-4 py-5 lg:flex">
        <div className="mb-7 flex items-center gap-3 px-2">
          <img src="/logo.svg" alt="Bulletins Scolaires" className="h-10 w-10" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Bulletins Scolaires</p>
            <p className="truncate text-xs text-muted-foreground">{school?.name ?? 'Plateforme'}</p>
          </div>
        </div>
        <div className="flex-1"><Navigation links={links} /></div>
        {account}
      </aside>

      <div className="min-w-0">
        <header className="border-b border-border bg-card px-4 py-3 lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <img src="/logo.svg" alt="Bulletins Scolaires" className="h-8 w-8" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">Bulletins Scolaires</p>
                <p className="truncate text-xs text-muted-foreground">{school?.name ?? 'Plateforme'}</p>
              </div>
            </div>
            {account}
          </div>
          <div className="mt-3"><Navigation links={links} /></div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
