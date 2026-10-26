import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

type Log = {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
};

type School = { id: string; name: string };

export function AuditLogsPage() {
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === 'PLATFORM_ADMIN';
  const [logs, setLogs] = useState<Log[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const query = isPlatformAdmin
        ? `?schoolId=${encodeURIComponent(selectedSchoolId)}`
        : '';
      const res = await api.fetch(`/api/audit-logs${query}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur de chargement');
      setLogs(data.logs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [isPlatformAdmin, selectedSchoolId]);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    const loadSchools = async () => {
      const res = await api.fetch('/api/schools');
      if (!res.ok) return;
      const data = await res.json();
      setSchools(data.schools ?? []);
    };
    void loadSchools();
  }, [isPlatformAdmin]);

  useEffect(() => {
    if (isPlatformAdmin && !selectedSchoolId) {
      setLogs([]);
      setLoading(false);
      return;
    }
    void load();
  }, [isPlatformAdmin, selectedSchoolId, load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Journal d'audit</h1>
        <p className="text-sm text-muted-foreground">Activité sur l'établissement</p>
      </div>

      {isPlatformAdmin && (
        <div className="max-w-sm">
          <label className="mb-1 block text-sm font-medium" htmlFor="school-filter">
            Établissement
          </label>
          <select
            id="school-filter"
            className="w-full rounded-md border border-input px-3 py-2 text-sm"
            value={selectedSchoolId}
            onChange={(e) => setSelectedSchoolId(e.target.value)}
          >
            <option value="">Sélectionner un établissement</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Action</th>
                <th className="p-3 text-left">Utilisateur</th>
                <th className="p-3 text-left">Entité</th>
                <th className="p-3 text-left">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={5}>
                    Aucune activité
                  </td>
                </tr>
              )}
              {logs.map((log) => (
                <tr key={log.id} className="border-t border-border">
                  <td className="p-3">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="p-3">{log.action}</td>
                  <td className="p-3">{log.user ? log.user.name : '-'}</td>
                  <td className="p-3">{log.entityType ?? '-'}</td>
                  <td className="p-3">{log.ip ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
