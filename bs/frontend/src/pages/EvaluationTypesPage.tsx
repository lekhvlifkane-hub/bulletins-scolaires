import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

type Category = 'DEVOIR' | 'COMPOSITION' | 'AUTRE';
type EvaluationType = {
  id: string;
  code: string;
  name: string;
  category: Category;
  defaultOutOf: string;
  actif: boolean;
};

const categories: { value: Category; label: string }[] = [
  { value: 'DEVOIR', label: 'Devoir' },
  { value: 'COMPOSITION', label: 'Composition' },
  { value: 'AUTRE', label: 'Autre' },
];

const inputClass =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10';

async function lireReponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : fallback);
  }
  return body as T;
}

export function EvaluationTypesPage() {
  const [types, setTypes] = useState<EvaluationType[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('DEVOIR');
  const [defaultOutOf, setDefaultOutOf] = useState('20');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadTypes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.fetch('/api/assessment-types');
      const body = await lireReponse<{ types: EvaluationType[] }>(
        response,
        'Impossible de charger les types d’évaluation',
      );
      setTypes(body.types);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de charger les types d’évaluation');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTypes();
  }, [loadTypes]);

  const createType = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const response = await api.fetch('/api/assessment-types', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim(), name: name.trim(), category, defaultOutOf }),
      });
      const body = await lireReponse<{ type: EvaluationType }>(
        response,
        'Impossible de créer le type d’évaluation',
      );
      setCode('');
      setName('');
      setMessage(`Le type « ${body.type.name} » a été ajouté.`);
      await loadTypes();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de créer le type d’évaluation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-emerald-700">Pédagogie</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Types d’évaluation</h1>
        <p className="mt-2 text-sm text-slate-500">
          Configurez les devoirs, compositions et autres évaluations ainsi que leur barème par défaut.
        </p>
      </header>

      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>}

      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7">
        <div className="mb-5 flex items-center gap-2">
          <ClipboardList aria-hidden="true" className="h-5 w-5 text-emerald-700" />
          <h2 className="text-base font-bold text-slate-800">Ajouter un type</h2>
        </div>
        <form onSubmit={createType} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <label className="space-y-1.5 text-xs font-semibold text-slate-600">
            Code unique
            <input
              className={inputClass}
              aria-label="Code du type"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Ex. DEVOIR_MAISON"
              required
              maxLength={24}
            />
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-slate-600">
            Nom affiché
            <input
              className={inputClass}
              aria-label="Nom du type"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex. Devoir maison"
              required
              maxLength={60}
            />
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-slate-600">
            Catégorie de calcul
            <select
              className={inputClass}
              aria-label="Catégorie"
              value={category}
              onChange={(event) => setCategory(event.target.value as Category)}
            >
              {categories.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-slate-600">
            Barème par défaut
            <input
              className={inputClass}
              aria-label="Barème par défaut"
              type="number"
              min="0.01"
              step="0.01"
              value={defaultOutOf}
              onChange={(event) => setDefaultOutOf(event.target.value)}
              required
            />
          </label>
          <div className="self-end">
            <Button type="submit" className="w-full" disabled={saving}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              {saving ? 'Ajout…' : 'Ajouter le type'}
            </Button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-7">
          <h2 className="font-bold text-slate-800">Types disponibles à la saisie</h2>
        </div>
        {loading ? (
          <p role="status" className="p-6 text-sm text-slate-500">Chargement des types…</p>
        ) : types.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Aucun type d’évaluation configuré.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Code</th>
                  <th className="px-5 py-3">Nom</th>
                  <th className="px-5 py-3">Catégorie</th>
                  <th className="px-5 py-3">Barème</th>
                  <th className="px-5 py-3">Disponibilité</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {types.map((type) => (
                  <tr key={type.id}>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">{type.code}</td>
                    <td className="px-5 py-3 font-semibold text-slate-800">{type.name}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {categories.find((item) => item.value === type.category)?.label ?? type.category}
                    </td>
                    <td className="px-5 py-3 text-slate-600">/{type.defaultOutOf}</td>
                    <td className="px-5 py-3">
                      <span className={type.actif
                        ? 'rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700'
                        : 'rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500'}>
                        {type.actif ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
