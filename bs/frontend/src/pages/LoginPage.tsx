import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-8">
      {/* Bandeau de vérification : doit apparaître après la mise à jour en 0.1.2. */}
      <div className="w-full max-w-md rounded-lg border-4 border-brand-emerald bg-white p-6 text-center shadow-sm">
        <p className="text-2xl font-bold text-brand-navy">
          Mise à jour automatique appliquée
        </p>
        <p className="mt-2 text-lg font-semibold text-brand-emerald">
          Vous utilisez maintenant la version 0.1.2
        </p>
      </div>
      <div className="w-full max-w-md space-y-6 rounded-lg border border-border p-6 shadow-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          <img src="/logo.svg" alt="Bulletins Scolaires" className="h-12 w-12" />
          <h1 className="text-xl font-semibold">Connexion</h1>
          <p className="text-sm text-muted-foreground">
            Accédez à la plateforme Bulletins Scolaires
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="email">
              Adresse e-mail
            </label>
            <input
              id="email"
              type="email"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              {...register('email')}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="password">
              Mot de passe
            </label>
            <input
              id="password"
              type="password"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              {...register('password')}
            />
            {errors.password && (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Connexion...' : 'Se connecter'}
          </Button>
        </form>
        <div className="flex flex-col items-center gap-2 text-center text-sm">
          <Link to="/mot-de-passe-oublie" className="underline">
            Mot de passe oublié ?
          </Link>
          <Link to="/inscription-etablissement" className="underline">
            Inscrire mon établissement
          </Link>
        </div>
      </div>
    </div>
  );
}
