import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { DashboardSchool } from '@/lib/dashboard';

const bulletinsConfig = {
  bulletins: { label: 'Générés', color: '#0B2D4F' },
  bulletinsPublies: { label: 'Publiés', color: '#0B9B67' },
} satisfies ChartConfig;

const schoolLifeConfig = {
  absences: { label: 'Absences', color: '#0B2D4F' },
  retards: { label: 'Retards', color: '#E5B544' },
} satisfies ChartConfig;

function SemesterChart({
  semesters,
  title,
  description,
  config,
  label,
  bars,
}: {
  semesters: DashboardSchool['semesters'];
  title: string;
  description: string;
  config: ChartConfig;
  label: string;
  bars: { key: string; name: string; color: string }[];
}) {
  return (
    <Card className="gap-0 border-border shadow-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={config}
          className="h-64 w-full aspect-auto"
          role="img"
          aria-label={label}
        >
          <BarChart data={semesters} margin={{ top: 8, right: 8, left: -20, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="name" tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltipContent />} />
            <Legend />
            {bars.map(({ key, name, color }) => (
              <Bar key={key} dataKey={key} name={name} fill={color} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

export default function DashboardCharts({
  semesters,
}: {
  semesters: DashboardSchool['semesters'];
}) {
  return (
    <section className="grid gap-5 lg:grid-cols-2" aria-label="Graphiques de suivi">
      <SemesterChart
        semesters={semesters}
        title="Bulletins par semestre"
        description="Bulletins générés et publiés pour l’année scolaire active"
        config={bulletinsConfig}
        label="Graphique des bulletins générés et publiés par semestre"
        bars={[
          { key: 'bulletins', name: 'Générés', color: '#0B2D4F' },
          { key: 'bulletinsPublies', name: 'Publiés', color: '#0B9B67' },
        ]}
      />
      <SemesterChart
        semesters={semesters}
        title="Suivi de la vie scolaire"
        description="Absences et retards enregistrés par semestre"
        config={schoolLifeConfig}
        label="Graphique des absences et retards par semestre"
        bars={[
          { key: 'absences', name: 'Absences', color: '#0B2D4F' },
          { key: 'retards', name: 'Retards', color: '#E5B544' },
        ]}
      />
    </section>
  );
}
