import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

type School = {
  id: string;
  name: string;
  city: string | null;
  isActive: boolean;
};

export function SchoolsPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', city: '', adminName: '', adminEmail: '', adminPassword: '' });

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.fetch('/api/schools');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur de chargement');
      setSchools(data.schools ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const res = await api.fetch('/api/schools', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Création impossible');
      }
      setForm({ name: '', city: '', adminName: '', adminEmail: '', adminPassword: '' });
      setMessage("Établissement créé avec son administrateur");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Établissements</h1>
        <p className="text-sm text-muted-foreground">Créer un établissement et son administrateur</p>
      </div>
      <form onSubmit={create} className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-6">
        <input
          className="rounded-md border border-input px-3 py-2 text-sm md:col-span-2"
          placeholder="Nom de l'établissement"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          className="rounded-md border border-input px-3 py-2 text-sm"
          placeholder="Ville"
          value={form.city}
          onChange={(e) => setForm({ ...form, city: e.target.value })}
        />
        <input
          className="rounded-md border border-input px-3 py-2 text-sm"
          placeholder="Nom admin"
          required
          value={form.adminName}
          onChange={(e) => setForm({ ...form, adminName: e.target.value })}
        />
        <input
          className="rounded-md border border-input px-3 py-2 text-sm"
          placeholder="Email admin"
          type="email"
          required
          value={form.adminEmail}
          onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
        />
        <input
          className="rounded-md border border-input px-3 py-2 text-sm"
          placeholder="Mot de passe admin"
          type="password"
          required
          value={form.adminPassword}
          onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
        />
        <Button type="submit" disabled={loading} className="md:col-span-6">Créer</Button>
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
                <th className="p-3 text-left">Nom</th>
                <th className="p-3 text-left">Ville</th>
                <th className="p-3 text-left">Statut</th>
                <th className="p-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schools.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="p-3">{s.name}</td>
                  <td className="p-3">{s.city || '-'}</td>
                  <td className="p-3">{s.isActive ? 'Actif' : 'Inactif'}</td>
                  <td className="p-3">
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/etablissements/${s.id}`}>Détail</Link>
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
