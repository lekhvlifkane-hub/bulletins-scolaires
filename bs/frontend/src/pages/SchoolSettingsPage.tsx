import { useEffect, useState } from 'react';
import { api, type SessionSchool } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

type School = {
  id: string;
  name: string;
  officialName: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  accreditationNumber: string | null;
};

type Regles = {
  regleCalculMatiere: 'POIDS_GROUPES' | 'MOYENNE_TOUTES_NOTES';
  poidsDevoirs: string;
  poidsCompositions: string;
  poidsAutres: string;
  absencesComptentZero: boolean;
  groupeSansNote: 'EXCLURE' | 'BLOQUANT';
  coefficientInvalide: 'EXCLURE' | 'ERREUR';
  baremeParDefaut: string;
  arrondiDecimales: string;
  arrondiMode: 'HALF_UP' | 'HALF_EVEN';
  rangMode: 'STANDARD' | 'DENSE';
  classerResultatsIncomplets: boolean;
  poidsSemestre1: string;
  poidsSemestre2: string;
  annuelSiSemestreManquant: 'NULL' | 'PARTIEL';
};

/** Valeurs par défaut du moteur de calcul (backend `services/calcul/index.ts`). */
const REGLES_PAR_DEFAUT: Regles = {
  regleCalculMatiere: 'POIDS_GROUPES',
  poidsDevoirs: '1',
  poidsCompositions: '1',
  poidsAutres: '0',
  absencesComptentZero: false,
  groupeSansNote: 'EXCLURE',
  coefficientInvalide: 'EXCLURE',
  baremeParDefaut: '20',
  arrondiDecimales: '2',
  arrondiMode: 'HALF_UP',
  rangMode: 'STANDARD',
  classerResultatsIncomplets: false,
  poidsSemestre1: '1',
  poidsSemestre2: '1',
  annuelSiSemestreManquant: 'NULL',
};

function reglesDepuisEcole(school: SessionSchool): Regles {
  return {
    regleCalculMatiere: school.regleCalculMatiere ?? REGLES_PAR_DEFAUT.regleCalculMatiere,
    poidsDevoirs: school.poidsDevoirs ?? REGLES_PAR_DEFAUT.poidsDevoirs,
    poidsCompositions: school.poidsCompositions ?? REGLES_PAR_DEFAUT.poidsCompositions,
    poidsAutres: school.poidsAutres ?? REGLES_PAR_DEFAUT.poidsAutres,
    absencesComptentZero: school.absencesComptentZero ?? REGLES_PAR_DEFAUT.absencesComptentZero,
    groupeSansNote: school.groupeSansNote ?? REGLES_PAR_DEFAUT.groupeSansNote,
    coefficientInvalide: school.coefficientInvalide ?? REGLES_PAR_DEFAUT.coefficientInvalide,
    baremeParDefaut: school.baremeParDefaut ?? REGLES_PAR_DEFAUT.baremeParDefaut,
    arrondiDecimales: String(school.arrondiDecimales ?? Number(REGLES_PAR_DEFAUT.arrondiDecimales)),
    arrondiMode: school.arrondiMode ?? REGLES_PAR_DEFAUT.arrondiMode,
    rangMode: school.rangMode ?? REGLES_PAR_DEFAUT.rangMode,
    classerResultatsIncomplets:
      school.classerResultatsIncomplets ?? REGLES_PAR_DEFAUT.classerResultatsIncomplets,
    poidsSemestre1: school.poidsSemestre1 ?? REGLES_PAR_DEFAUT.poidsSemestre1,
    poidsSemestre2: school.poidsSemestre2 ?? REGLES_PAR_DEFAUT.poidsSemestre2,
    annuelSiSemestreManquant:
      school.annuelSiSemestreManquant ?? REGLES_PAR_DEFAUT.annuelSiSemestreManquant,
  };
}

/** Champ de formulaire libellé, pour garder la page lisible. */
function Champ({
  label,
  aide,
  children,
}: {
  label: string;
  aide?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {aide && <span className="text-xs text-muted-foreground">{aide}</span>}
    </label>
  );
}

const CLASSE_CHAMP = 'rounded-md border border-input px-3 py-2 text-sm';

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {titre}
      </h2>
      {children}
    </section>
  );
}

export function SchoolSettingsPage() {
  const { school } = useAuth();
  const [form, setForm] = useState<School>({
    id: school?.id ?? '',
    name: school?.name ?? '',
    officialName: school?.officialName ?? '',
    city: school?.city ?? '',
    address: school?.address ?? '',
    phone: school?.phone ?? '',
    email: school?.email ?? '',
    accreditationNumber: school?.accreditationNumber ?? '',
  });
  const [regles, setRegles] = useState<Regles>(REGLES_PAR_DEFAUT);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (school) {
      setForm({
        id: school.id,
        name: school.name,
        officialName: school.officialName ?? '',
        city: school.city ?? '',
        address: school.address ?? '',
        phone: school.phone ?? '',
        email: school.email ?? '',
        accreditationNumber: school.accreditationNumber ?? '',
      });
      setRegles(reglesDepuisEcole(school));
    }
  }, [school]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.id) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      // Les règles numériques sont envoyées en nombres ; le serveur refuse toute
      // valeur hors bornes plutôt que de la remplacer silencieusement.
      const nombres: Array<[string, string]> = [
        ['Poids des devoirs', regles.poidsDevoirs],
        ['Poids des compositions', regles.poidsCompositions],
        ['Poids des autres évaluations', regles.poidsAutres],
        ['Barème par défaut', regles.baremeParDefaut],
        ['Décimales d’affichage', regles.arrondiDecimales],
        ['Poids du semestre 1', regles.poidsSemestre1],
        ['Poids du semestre 2', regles.poidsSemestre2],
      ];
      for (const [libelle, valeur] of nombres) {
        const n = Number(valeur);
        if (valeur.trim() === '' || !Number.isFinite(n)) {
          throw new Error(`${libelle} : saisir un nombre`);
        }
      }

      const res = await api.fetch(`/api/schools/${form.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...form,
          ...regles,
          poidsDevoirs: Number(regles.poidsDevoirs),
          poidsCompositions: Number(regles.poidsCompositions),
          poidsAutres: Number(regles.poidsAutres),
          baremeParDefaut: Number(regles.baremeParDefaut),
          arrondiDecimales: Number(regles.arrondiDecimales),
          poidsSemestre1: Number(regles.poidsSemestre1),
          poidsSemestre2: Number(regles.poidsSemestre2),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Enregistrement impossible');
      }
      const body = await res.json().catch(() => ({}));
      if (body.school) {
        setRegles(reglesDepuisEcole(body.school));
      }
      setMessage('Paramètres enregistrés');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Paramètres de l'établissement</h1>
        <p className="text-sm text-muted-foreground">
          Informations officielles et règles de calcul appliquées aux moyennes.
        </p>
      </div>

      <form onSubmit={save} className="space-y-6">
        <Section titre="Informations officielles">
          <div className="grid gap-4 md:grid-cols-2">
            <input
              className={CLASSE_CHAMP}
              placeholder="Nom"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              className={CLASSE_CHAMP}
              placeholder="Nom officiel"
              value={form.officialName ?? ''}
              onChange={(e) => setForm({ ...form, officialName: e.target.value })}
            />
            <input
              className={CLASSE_CHAMP}
              placeholder="Ville"
              value={form.city ?? ''}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
            <input
              className={CLASSE_CHAMP}
              placeholder="Téléphone"
              value={form.phone ?? ''}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <input
              className={CLASSE_CHAMP}
              placeholder="Adresse e-mail"
              type="email"
              value={form.email ?? ''}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <input
              className={CLASSE_CHAMP}
              placeholder="N° agrément"
              value={form.accreditationNumber ?? ''}
              onChange={(e) => setForm({ ...form, accreditationNumber: e.target.value })}
            />
            <textarea
              className={`md:col-span-2 ${CLASSE_CHAMP}`}
              placeholder="Adresse"
              value={form.address ?? ''}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
        </Section>

        <Section titre="Règles de calcul — à valider par l'établissement">
          <p className="text-xs text-muted-foreground">
            Ces règles s'appliquent aux calculs côté serveur. Aucune note manquante ou absence
            n'est convertie en 0 sans règle explicite.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <Champ
              label="Moyenne par matière"
              aide="Groupes pondérés = Σ(moyenne du groupe × poids) / Σ(poids)."
            >
              <select
                className={CLASSE_CHAMP}
                value={regles.regleCalculMatiere}
                onChange={(e) =>
                  setRegles({
                    ...regles,
                    regleCalculMatiere: e.target.value as Regles['regleCalculMatiere'],
                  })
                }
              >
                <option value="POIDS_GROUPES">Groupes pondérés (devoirs / compositions)</option>
                <option value="MOYENNE_TOUTES_NOTES">Toutes les notes confondues</option>
              </select>
            </Champ>
            <Champ label="Barème par défaut" aide="Barème des évaluations sans barème propre.">
              <input
                className={CLASSE_CHAMP}
                type="number"
                step="0.01"
                min="0.01"
                value={regles.baremeParDefaut}
                onChange={(e) => setRegles({ ...regles, baremeParDefaut: e.target.value })}
              />
            </Champ>
            <Champ label="Poids des devoirs">
              <input
                className={CLASSE_CHAMP}
                type="number"
                step="0.01"
                min="0"
                value={regles.poidsDevoirs}
                onChange={(e) => setRegles({ ...regles, poidsDevoirs: e.target.value })}
              />
            </Champ>
            <Champ label="Poids des compositions">
              <input
                className={CLASSE_CHAMP}
                type="number"
                step="0.01"
                min="0"
                value={regles.poidsCompositions}
                onChange={(e) => setRegles({ ...regles, poidsCompositions: e.target.value })}
              />
            </Champ>
            <Champ label="Poids des autres évaluations" aide="0 par défaut : non comptabilisées.">
              <input
                className={CLASSE_CHAMP}
                type="number"
                step="0.01"
                min="0"
                value={regles.poidsAutres}
                onChange={(e) => setRegles({ ...regles, poidsAutres: e.target.value })}
              />
            </Champ>
            <Champ
              label="Groupe sans note"
              aide="Un groupe (devoirs ou compositions) sans note exploitable."
            >
              <select
                className={CLASSE_CHAMP}
                value={regles.groupeSansNote}
                onChange={(e) =>
                  setRegles({ ...regles, groupeSansNote: e.target.value as Regles['groupeSansNote'] })
                }
              >
                <option value="EXCLURE">Exclure du calcul (renormaliser les poids)</option>
                <option value="BLOQUANT">Bloquer la moyenne de la matière</option>
              </select>
            </Champ>
            <Champ label="Coefficient invalide">
              <select
                className={CLASSE_CHAMP}
                value={regles.coefficientInvalide}
                onChange={(e) =>
                  setRegles({
                    ...regles,
                    coefficientInvalide: e.target.value as Regles['coefficientInvalide'],
                  })
                }
              >
                <option value="EXCLURE">Exclure la matière du dénominateur</option>
                <option value="ERREUR">Signaler une erreur de saisie</option>
              </select>
            </Champ>
            <Champ label="Classement des résultats incomplets" aide="Rangs standard : 1, 2, 2, 4.">
              <select
                className={CLASSE_CHAMP}
                value={regles.rangMode}
                onChange={(e) =>
                  setRegles({ ...regles, rangMode: e.target.value as Regles['rangMode'] })
                }
              >
                <option value="STANDARD">Standard (rangs sautés)</option>
                <option value="DENSE">Dense (aucun rang sauté)</option>
              </select>
            </Champ>
            <Champ label="Arrondi d'affichage" aide="L'arrondi n'affecte jamais la valeur calculée.">
              <select
                className={CLASSE_CHAMP}
                value={regles.arrondiMode}
                onChange={(e) =>
                  setRegles({ ...regles, arrondiMode: e.target.value as Regles['arrondiMode'] })
                }
              >
                <option value="HALF_UP">Arrondi au plus proche (half-up)</option>
                <option value="HALF_EVEN">Arrondi bancaire (half-even)</option>
              </select>
            </Champ>
            <Champ label="Décimales d'affichage" aide="Entre 0 et 4.">
              <input
                className={CLASSE_CHAMP}
                type="number"
                step="1"
                min="0"
                max="4"
                value={regles.arrondiDecimales}
                onChange={(e) => setRegles({ ...regles, arrondiDecimales: e.target.value })}
              />
            </Champ>
            <Champ label="Poids du semestre 1">
              <input
                className={CLASSE_CHAMP}
                type="number"
                step="0.01"
                min="0"
                value={regles.poidsSemestre1}
                onChange={(e) => setRegles({ ...regles, poidsSemestre1: e.target.value })}
              />
            </Champ>
            <Champ label="Poids du semestre 2">
              <input
                className={CLASSE_CHAMP}
                type="number"
                step="0.01"
                min="0"
                value={regles.poidsSemestre2}
                onChange={(e) => setRegles({ ...regles, poidsSemestre2: e.target.value })}
              />
            </Champ>
            <Champ label="Moyenne annuelle si un semestre manque">
              <select
                className={CLASSE_CHAMP}
                value={regles.annuelSiSemestreManquant}
                onChange={(e) =>
                  setRegles({
                    ...regles,
                    annuelSiSemestreManquant: e.target
                      .value as Regles['annuelSiSemestreManquant'],
                  })
                }
              >
                <option value="NULL">Non calculable (aucune valeur inventée)</option>
                <option value="PARTIEL">Reporter le semestre disponible (bilan partiel)</option>
              </select>
            </Champ>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={regles.absencesComptentZero}
              onChange={(e) => setRegles({ ...regles, absencesComptentZero: e.target.checked })}
            />
            Compter une absence comme 0 dans la moyenne
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={regles.classerResultatsIncomplets}
              onChange={(e) =>
                setRegles({ ...regles, classerResultatsIncomplets: e.target.checked })
              }
            />
            Classer aussi les élèves aux résultats incomplets
          </label>
        </Section>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </Button>
          {message && <p className="text-sm text-emerald-600">{message}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </form>
    </div>
  );
}
