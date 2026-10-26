import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

type ProtectedRouteProps = {
  roles?: Array<'PLATFORM_ADMIN' | 'SCHOOL_ADMIN' | 'SURVEILLANT_GENERAL' | 'ASSISTANT'>;
};

export function ProtectedRoute({ roles }: ProtectedRouteProps) {
  const { authenticated, loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">Chargement...</p>
      </div>
    );
  }

  if (!authenticated) {
    return <Navigate to="/connexion" replace state={{ from: location }} />;
  }

  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
