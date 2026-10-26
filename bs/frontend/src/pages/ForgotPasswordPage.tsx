import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

const schema = z.object({
  email: z.string().trim().email('Adresse e-mail invalide'),
});

type FormValues = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setError(null);
    setMessage(null);
    try {
      const res = await api.fetch('/api/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => ({}));
      setMessage(
        data.message ||
          'Si un compte correspond à cette adresse, un lien de réinitialisation a été envoyé.',
      );
    } catch {
      setMessage(
        'Si un compte correspond à cette adresse, un lien de réinitialisation a été envoyé.',
      );
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-border p-6 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-xl font-semibold">Mot de passe oublié</h1>
          <p className="text-sm text-muted-foreground">
            Saisissez votre adresse e-mail pour recevoir un lien de réinitialisation
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
          {error && <p className="text-sm text-destructive">{error}</p>}
          {message && <p className="text-sm text-emerald-600">{message}</p>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Envoi...' : 'Envoyer le lien'}
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
