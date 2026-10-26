import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DashboardSchool } from '@/lib/dashboard';

export default function DashboardCharts({
  semesters,
}: {
  semesters: DashboardSchool['semesters'];
}) {
  return (
    <section className="grid gap-5 lg:grid-cols-2">
      <article className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">Bulletins par semestre</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">Données de l’année scolaire active</p>
        <div className="h-64 w-full" role="img" aria-label="Graphique des bulletins générés et publiés par semestre">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={semesters} margin={{ top: 8, right: 8, left: -20, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tickLine={false} />
              <YAxis allowDecimals={false} tickLine={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="bulletins" name="Générés" fill="#173b5e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="bulletinsPublies" name="Publiés" fill="#15966b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>
      <article className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">Suivi de la vie scolaire</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">Absences et retards enregistrés</p>
        <div className="h-64 w-full" role="img" aria-label="Graphique des absences et retards par semestre">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={semesters} margin={{ top: 8, right: 8, left: -20, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tickLine={false} />
              <YAxis allowDecimals={false} tickLine={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="absences" name="Absences" fill="#d97706" radius={[4, 4, 0, 0]} />
              <Bar dataKey="retards" name="Retards" fill="#5489bf" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>
    </section>
  );
}
