import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

type School = {
  id: string;
  name: string;
  city: string | null;
  email: string | null;
  phone: string | null;
};

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
};

type Grant = {
  id: string;
  platformAdmin: { id: string; name: string; email: string };
  reason: string;
  expiresAt: string;
  active: boolean;
};

type Log = {
  id: string;
  action: string;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
};

export function SchoolDetailPage() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === 'PLATFORM_ADMIN';
  const [school, setSchool] = useState<School | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!schoolId) return;
    try {
      setLoading(true);
      setError(null);
      const query = `?schoolId=${encodeURIComponent(schoolId)}`;
      const [schoolRes, usersRes, grantsRes, logsRes] = await Promise.all([
        api.fetch(`/api/schools/${schoolId}${query}`),
        api.fetch(`/api/users${query}`),
        api.fetch(`/api/temporary-access${query}`),
        api.fetch(`/api/audit-logs${query}`),
      ]);

      if (schoolRes.ok) {
        const data = await schoolRes.json();
        setSchool(data.school ?? null);
      }
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users ?? []);
      }
      if (grantsRes.ok) {
        const data = await grantsRes.json();
        setGrants(data.grants ?? []);
      }
      if (logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data.logs ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isPlatformAdmin) {
    return <p className="text-sm text-destructive">Accès réservé au Platform Admin</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{school?.name ?? "Détail de l'établissement"}</h1>
          <p className="text-sm text-muted-foreground">
            {school?.city ? school.city : 'Vue synthétique'}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/etablissements">Retour aux établissements</Link>
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement...</p>
      ) : (
        <>
          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-2 text-lg font-semibold">Informations</h2>
            <dl className="grid gap-2 text-sm md:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Nom</dt>
                <dd>{school?.name ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Ville</dt>
                <dd>{school?.city ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">E-mail</dt>
                <dd>{school?.email ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Téléphone</dt>
                <dd>{school?.phone ?? '-'}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-2 text-lg font-semibold">Utilisateurs</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left">Nom</th>
                    <th className="p-2 text-left">E-mail</th>
                    <th className="p-2 text-left">Rôle</th>
                    <th className="p-2 text-left">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-border">
                      <td className="p-2">{u.name}</td>
                      <td className="p-2">{u.email}</td>
                      <td className="p-2">{u.role}</td>
                      <td className="p-2">{u.isActive ? 'Actif' : 'Inactif'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-2 text-lg font-semibold">Accès temporaires</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left">Administrateur</th>
                    <th className="p-2 text-left">Motif</th>
                    <th className="p-2 text-left">Expire le</th>
                    <th className="p-2 text-left">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {grants.map((g) => (
                    <tr key={g.id} className="border-t border-border">
                      <td className="p-2">{g.platformAdmin.name}</td>
                      <td className="p-2">{g.reason}</td>
                      <td className="p-2">{new Date(g.expiresAt).toLocaleString()}</td>
                      <td className="p-2">{g.active ? 'Actif' : 'Expiré'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-2 text-lg font-semibold">Journal d'audit (récent)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left">Date</th>
                    <th className="p-2 text-left">Action</th>
                    <th className="p-2 text-left">Utilisateur</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.slice(0, 20).map((log) => (
                    <tr key={log.id} className="border-t border-border">
                      <td className="p-2">{new Date(log.createdAt).toLocaleString()}</td>
                      <td className="p-2">{log.action}</td>
                      <td className="p-2">{log.user ? log.user.name : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
