import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

type PendingSchool = {
  id: string;
  name: string;
  city: string | null;
  phone: string | null;
  createdAt: string;
  admin: { id: string; name: string; email: string } | null;
};

export function SchoolsPendingPage() {
  const [schools, setSchools] = useState<PendingSchool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.fetch('/api/schools/pending');
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

  const approve = async (id: string) => {
    setError(null);
    setMessage(null);
    try {
      const res = await api.fetch(`/api/schools/${id}/approve`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Erreur lors de l'approbation");
      setMessage('Établissement approuvé');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const reject = async (id: string) => {
    setError(null);
    setMessage(null);
    try {
      const res = await api.fetch(`/api/schools/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason[id] || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Erreur lors du refus');
      setMessage('Établissement refusé');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Demandes d'inscription</h1>
        <p className="text-sm text-muted-foreground">Établissements en attente de validation</p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-emerald-600">{message}</p>}
      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement...</p>
      ) : schools.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune demande en attente</p>
      ) : (
        <div className="space-y-4">
          {schools.map((school) => (
            <div key={school.id} className="rounded-lg border border-border p-4 space-y-3">
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <p className="font-medium">{school.name}</p>
                  <p className="text-sm text-muted-foreground">{school.city || '-'}</p>
                  <p className="text-sm text-muted-foreground">{school.phone || '-'}</p>
                </div>
                <div>
                  <p className="text-sm font-medium">Administrateur</p>
                  <p className="text-sm text-muted-foreground">{school.admin?.name || '-'}</p>
                  <p className="text-sm text-muted-foreground">{school.admin?.email || '-'}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <input
                  className="flex-1 rounded-md border border-input px-3 py-2 text-sm"
                  placeholder="Motif du refus (facultatif)"
                  value={reason[school.id] || ''}
                  onChange={(e) => setReason({ ...reason, [school.id]: e.target.value })}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void approve(school.id)}>
                    Approuver
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => void reject(school.id)}>
                    Refuser
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
