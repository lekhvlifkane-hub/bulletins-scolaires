import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpenCheck, GraduationCap, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

const schema = z.object({
  email: z.string().trim().email('Adresse e-mail invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const from = (location.state as { from?: Location })?.from?.pathname || '/';

  const onSubmit = async (values: FormValues) => {
    setError(null);
    try {
      await login(values.email, values.password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    }
  };

  return (
    <main className="min-h-screen bg-background lg:grid lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative isolate flex min-h-[300px] flex-col overflow-hidden bg-brand-navy px-6 py-8 text-white sm:px-10 lg:min-h-screen lg:px-16 lg:py-12">
        <div aria-hidden="true" className="absolute -right-36 -top-32 -z-10 h-[34rem] w-[34rem] rounded-full border-[74px] border-white/[0.035]" />
        <div aria-hidden="true" className="absolute -bottom-36 -left-20 -z-10 h-96 w-96 rounded-full bg-brand-emerald/20 blur-3xl" />
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm">
            <img src="/logo.svg" alt="Bulletins Scolaires" className="h-9 w-9" />
          </span>
          <span>
            <span className="block text-sm font-bold tracking-wide">Bulletins Scolaires</span>
            <span className="mt-0.5 block text-xs text-white/55">La réussite, bien organisée.</span>
          </span>
        </div>

        <div className="my-auto max-w-xl py-10 lg:py-16">
          <div className="mb-6 inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white/85">
            <GraduationCap aria-hidden="true" className="h-4 w-4 text-emerald-300" />
            La gestion scolaire en toute simplicité
          </div>
          <h1 className="max-w-lg text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            Chaque élève mérite un parcours qui compte.
          </h1>
          <p className="mt-5 max-w-lg text-sm leading-7 text-white/75 sm:text-base">
            Notes, bulletins et vie scolaire réunis dans un espace clair, pensé pour accompagner les établissements au quotidien.
          </p>
          <div className="mt-9 hidden max-w-md gap-3 sm:grid sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4">
              <BookOpenCheck aria-hidden="true" className="mb-3 h-5 w-5 text-emerald-300" />
              <p className="text-sm font-semibold">Suivi pédagogique</p>
              <p className="mt-1 text-xs leading-5 text-white/55">Des informations utiles, au même endroit.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4">
              <ShieldCheck aria-hidden="true" className="mb-3 h-5 w-5 text-emerald-300" />
              <p className="text-sm font-semibold">Accès sécurisé</p>
              <p className="mt-1 text-xs leading-5 text-white/55">Un espace adapté à chaque rôle.</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 text-xs text-white/40">
          <span>© {new Date().getFullYear()} Bulletins Scolaires</span>
          <span>Version {__APP_VERSION__}</span>
        </div>
      </section>

      <section className="flex items-center justify-center px-4 py-10 sm:px-8 lg:px-12">
        <div className="w-full max-w-[430px]">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_16px_50px_rgb(16_46_74/0.08)] sm:p-9">
            <div className="mb-8">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">Connexion</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Accédez à votre espace Bulletins Scolaires.
              </p>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground" htmlFor="email">
                  Adresse e-mail
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="nom@etablissement.sn"
                  className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground hover:border-primary/50 focus:border-primary focus:ring-4 focus:ring-primary/10"
                  {...register('email')}
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground" htmlFor="password">
                  Mot de passe
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground hover:border-primary/50 focus:border-primary focus:ring-4 focus:ring-primary/10"
                  {...register('password')}
                />
                {errors.password && (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                )}
              </div>
              {error && (
                <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                className="h-11 w-full rounded-lg text-sm font-semibold shadow-sm"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Connexion...' : 'Se connecter'}
                {!isSubmitting && <ArrowRight aria-hidden="true" className="h-4 w-4" />}
              </Button>
            </form>

            <div className="mt-7 border-t border-border pt-6 text-center">
              <p className="text-sm text-muted-foreground">Votre établissement n’est pas encore inscrit ?</p>
              <Link to="/inscription-etablissement" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline">
                Inscrire mon établissement
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
          <p className="mt-5 text-center text-xs text-muted-foreground">
            Besoin d’aide ? Contactez l’administrateur de votre établissement.
          </p>
        </div>
      </section>
    </main>
  );
}
