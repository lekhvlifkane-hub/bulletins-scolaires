import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

type Grant = {
  id: string;
  school: { id: string; name: string };
  platformAdmin: { id: string; name: string; email: string };
  reason: string;
  expiresAt: string;
  active: boolean;
};

type School = { id: string; name: string };

export function TemporaryAccessPage() {
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === 'PLATFORM_ADMIN';
  const [grants, setGrants] = useState<Grant[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [form, setForm] = useState({ schoolId: '', email: '', reason: '', expiresAt: '' });

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const requests: Promise<Response>[] = [api.fetch('/api/temporary-access')];
      if (isPlatformAdmin) {
        requests.push(api.fetch('/api/schools'));
      }
      const [g, s] = await Promise.all(requests);
      const gData = await g.json().catch(() => ({}));
      if (!g.ok) throw new Error(gData.error || 'Erreur de chargement');
      setGrants(gData.grants ?? []);
      if (s) {
        const sData = await s.json().catch(() => ({}));
        setSchools(sData.schools ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [isPlatformAdmin]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const payload = isPlatformAdmin
        ? {
            schoolId: form.schoolId,
            reason: form.reason,
            expiresAt: new Date(form.expiresAt).toISOString(),
          }
        : {
            email: form.email,
            reason: form.reason,
            expiresAt: new Date(form.expiresAt).toISOString(),
          };
      const res = await api.fetch('/api/temporary-access', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Création impossible');
      }
      setForm({ schoolId: '', email: '', reason: '', expiresAt: '' });
      setMessage('Accès temporaire accordé');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const revoke = async (id: string) => {
    if (!confirm('Révoquer cet accès temporaire ?')) return;
    try {
      setError(null);
      setMessage(null);
      setActionLoading(id);
      const res = await api.fetch(`/api/temporary-access/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Révocation impossible');
      }
      setMessage('Accès temporaire révoqué');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Accès temporaire</h1>
        <p className="text-sm text-muted-foreground">Autoriser un administrateur plateforme à accéder à un établissement</p>
      </div>
      <form onSubmit={create} className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-4">
        {isPlatformAdmin ? (
          <select
            className="rounded-md border border-input px-3 py-2 text-sm"
            value={form.schoolId}
            required
            onChange={(e) => setForm({ ...form, schoolId: e.target.value })}
          >
            <option value="">Établissement</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="rounded-md border border-input px-3 py-2 text-sm"
            placeholder="E-mail administrateur plateforme"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        )}
        <input
          className="rounded-md border border-input px-3 py-2 text-sm"
          placeholder="Motif"
          required
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        <input
          className="rounded-md border border-input px-3 py-2 text-sm"
          type="datetime-local"
          required
          value={form.expiresAt}
          onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
        />
        <Button type="submit" disabled={loading || actionLoading !== null}>Accorder</Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-emerald-600">{message}</p>}
      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 text-left">Établissement</th>
                <th className="p-3 text-left">Administrateur</th>
                <th className="p-3 text-left">Motif</th>
                <th className="p-3 text-left">Expire le</th>
                <th className="p-3 text-left">Statut</th>
                <th className="p-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id} className="border-t border-border">
                  <td className="p-3">{g.school.name}</td>
                  <td className="p-3">{g.platformAdmin.name}</td>
                  <td className="p-3">{g.reason}</td>
                  <td className="p-3">{new Date(g.expiresAt).toLocaleString()}</td>
                  <td className="p-3">{g.active ? 'Actif' : 'Expiré'}</td>
                  <td className="p-3">
                    <Button size="sm" variant="outline" disabled={actionLoading === g.id} onClick={() => revoke(g.id)}>
                      Révoquer
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
