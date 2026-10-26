import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Mot de passe actuel requis'),
    newPassword: z
      .string()
      .min(12, 'Au moins 12 caractères')
      .regex(/[A-Za-z]/, 'Au moins une lettre')
      .regex(/[0-9]/, 'Au moins un chiffre'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

export function ProfilePage() {
  const { user, school } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setError(null);
    setMessage(null);
    try {
      const res = await api.fetch('/api/auth/password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Changement de mot de passe impossible');
      }
      setMessage('Mot de passe modifié avec succès');
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Mon profil</h1>
        <p className="text-sm text-muted-foreground">Informations du compte connecté</p>
      </div>
      <div className="rounded-lg border border-border p-4">
        <dl className="grid gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Nom</dt>
            <dd>{user?.name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">E-mail</dt>
            <dd>{user?.email}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Rôle</dt>
            <dd>{user?.role}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Établissement</dt>
            <dd>{school?.name ?? '-'}</dd>
          </div>
        </dl>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Changer mon mot de passe</h2>
        <p className="text-sm text-muted-foreground">
          Minimum 12 caractères, au moins une lettre et un chiffre
        </p>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="max-w-lg space-y-4 rounded-lg border border-border p-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="currentPassword">
            Mot de passe actuel
          </label>
          <input
            id="currentPassword"
            type="password"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            {...register('currentPassword')}
          />
          {errors.currentPassword && (
            <p className="text-xs text-destructive">{errors.currentPassword.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="newPassword">
            Nouveau mot de passe
          </label>
          <input
            id="newPassword"
            type="password"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            {...register('newPassword')}
          />
          {errors.newPassword && (
            <p className="text-xs text-destructive">{errors.newPassword.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="confirmPassword">
            Confirmer le nouveau mot de passe
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
        {message && <p className="text-sm text-emerald-600">{message}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Enregistrement...' : 'Changer le mot de passe'}
        </Button>
      </form>
    </div>
  );
}

