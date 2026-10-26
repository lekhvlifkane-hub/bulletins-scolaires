import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

type User = {
  id: string;
  schoolId: string | null;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
};

type School = { id: string; name: string };

export function UsersPage() {
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === 'PLATFORM_ADMIN';
  const [users, setUsers] = useState<User[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'ASSISTANT' });
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const query = isPlatformAdmin && selectedSchoolId
        ? `?schoolId=${encodeURIComponent(selectedSchoolId)}`
        : '';
      const res = await api.fetch(`/api/users${query}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur de chargement');
      setUsers(data.users ?? []);
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
      setUsers([]);
      setLoading(false);
      return;
    }
    void load();
  }, [isPlatformAdmin, selectedSchoolId, load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setTemporaryPassword(null);
    try {
      const payload = isPlatformAdmin
        ? { ...form, schoolId: selectedSchoolId }
        : form;
      const res = await api.fetch('/api/users', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Création impossible');
      }
      const data = await res.json();
      setForm({ name: '', email: '', role: 'ASSISTANT' });
      setMessage('Utilisateur créé');
      setTemporaryPassword(data.temporaryPassword ?? null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const toggleActive = async (u: User) => {
    setError(null);
    setMessage(null);
    setActionLoading(u.id);
    try {
      const query = isPlatformAdmin && u.schoolId ? `?schoolId=${encodeURIComponent(u.schoolId)}` : '';
      const res = await api.fetch(`/api/users/${u.id}${query}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Action impossible');
      }
      setMessage(u.isActive ? 'Utilisateur désactivé' : 'Utilisateur activé');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setActionLoading(null);
    }
  };

  const removeUser = async (u: User) => {
    if (!confirm('Supprimer cet utilisateur ?')) return;
    setError(null);
    setMessage(null);
    setActionLoading(u.id);
    try {
      const query = isPlatformAdmin && u.schoolId ? `?schoolId=${encodeURIComponent(u.schoolId)}` : '';
      const res = await api.fetch(`/api/users/${u.id}${query}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Suppression impossible');
      }
      setMessage('Utilisateur supprimé');
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
        <h1 className="text-2xl font-semibold">Utilisateurs</h1>
        <p className="text-sm text-muted-foreground">
          Gestion des comptes de l'établissement
        </p>
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

      {(!isPlatformAdmin || selectedSchoolId) && (
        <form onSubmit={create} className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-4">
          <input
            className="rounded-md border border-input px-3 py-2 text-sm"
            placeholder="Nom complet"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className="rounded-md border border-input px-3 py-2 text-sm"
            placeholder="E-mail"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <select
            className="rounded-md border border-input px-3 py-2 text-sm"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="ASSISTANT">Assistant</option>
            <option value="SURVEILLANT_GENERAL">Surveillant général</option>
            {isPlatformAdmin && <option value="SCHOOL_ADMIN">Administrateur</option>}
          </select>
          <Button type="submit" disabled={actionLoading !== null}>Ajouter</Button>
        </form>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-emerald-600">{message}</p>}
      {temporaryPassword && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Mot de passe provisoire : <strong>{temporaryPassword}</strong>. Communiquez-le de façon sécurisée ; il ne sera plus affiché.
        </p>
      )}
      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 text-left">Nom</th>
                <th className="p-3 text-left">E-mail</th>
                <th className="p-3 text-left">Rôle</th>
                <th className="p-3 text-left">Statut</th>
                <th className="p-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={5}>
                    Aucun utilisateur
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="p-3">{u.name}</td>
                  <td className="p-3">{u.email}</td>
                  <td className="p-3">{u.role}</td>
                  <td className="p-3">{u.isActive ? 'Actif' : 'Inactif'}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      {u.id !== user?.id && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actionLoading === u.id}
                            onClick={() => toggleActive(u)}
                          >
                            {u.isActive ? 'Désactiver' : 'Activer'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actionLoading === u.id}
                            onClick={() => removeUser(u)}
                          >
                            Supprimer
                          </Button>
                        </>
                      )}
                    </div>
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
