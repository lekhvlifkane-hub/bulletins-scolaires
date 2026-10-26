import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

const schema = z
  .object({
    password: z
      .string()
      .min(12, 'Au moins 12 caractères')
      .regex(/[A-Za-z]/, 'Au moins une lettre')
      .regex(/[0-9]/, 'Au moins un chiffre'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setError(null);
    try {
      const res = await api.fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, password: values.password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Lien invalide ou expiré');
      }
      navigate('/connexion', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la réinitialisation');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-border p-6 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-xl font-semibold">Réinitialiser le mot de passe</h1>
          <p className="text-sm text-muted-foreground">
            Définissez un nouveau mot de passe sécurisé
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="password">
              Nouveau mot de passe
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
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="confirmPassword">
              Confirmer le mot de passe
            </label>
            <input
              id="confirmPassword"
              type="password"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              {...register('confirmPassword')}
            />
            {errors.confirmPassword && (
              <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={isSubmitting || !token}>
            {isSubmitting ? 'Validation...' : 'Réinitialiser'}
          </Button>
        </form>
        <div className="text-center text-sm">
          <Link to="/connexion" className="underline">
            Retour à la connexion
          </Link>
        </div>
      </div>
    </div>
  );
}
