import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

const schema = z.object({
  schoolName: z.string().trim().min(2, "Nom de l'établissement trop court"),
  city: z.string().trim().min(1, 'Ville requise'),
  phone: z.string().trim().min(1, 'Téléphone requis'),
  adminName: z.string().trim().min(2, "Nom de l'administrateur trop court"),
  adminEmail: z.string().trim().email('Adresse e-mail invalide'),
  password: z
    .string()
    .min(12, 'Le mot de passe doit contenir au moins 12 caractères')
    .max(128, 'Le mot de passe ne peut pas dépasser 128 caractères')
    .regex(/[A-Za-z]/, 'Le mot de passe doit contenir au moins une lettre')
    .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre'),
});

type FormValues = z.infer<typeof schema>;

export function SchoolRegistrationPage() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      schoolName: '',
      city: '',
      phone: '',
      adminName: '',
      adminEmail: '',
      password: '',
    },
  });

  const onSubmit = async (values: FormValues) => {
    setError(null);
    try {
      const res = await api.fetch('/api/schools/register', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || "Erreur lors de l'inscription");
      }
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'inscription");
    }
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-border p-6 shadow-sm text-center">
          <div className="flex flex-col items-center gap-2">
            <img src="/logo.svg" alt="Bulletins Scolaires" className="h-12 w-12" />
            <h1 className="text-xl font-semibold">Demande envoyée</h1>
            <p className="text-sm text-muted-foreground">
              Votre demande d'inscription a été envoyée. Elle sera examinée par l'administrateur de la plateforme. Vous recevrez un e-mail de confirmation.
            </p>
          </div>
          <Button asChild className="w-full">
            <Link to="/connexion">Retour à la connexion</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg space-y-6 rounded-lg border border-border p-6 shadow-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          <img src="/logo.svg" alt="Bulletins Scolaires" className="h-12 w-12" />
          <h1 className="text-xl font-semibold">Inscription établissement</h1>
          <p className="text-sm text-muted-foreground">
            Créer une demande d'inscription pour votre établissement
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="schoolName">
              Nom de l'établissement
            </label>
            <input
              id="schoolName"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              {...register('schoolName')}
            />
            {errors.schoolName && <p className="text-xs text-destructive">{errors.schoolName.message}</p>}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="city">
                Ville
              </label>
              <input
                id="city"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                {...register('city')}
              />
              {errors.city && <p className="text-xs text-destructive">{errors.city.message}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="phone">
                Téléphone
              </label>
              <input
                id="phone"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                {...register('phone')}
              />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="adminName">
              Nom et prénom de l'administrateur
            </label>
            <input
              id="adminName"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              {...register('adminName')}
            />
            {errors.adminName && <p className="text-xs text-destructive">{errors.adminName.message}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="adminEmail">
              E-mail de l'administrateur
            </label>
            <input
              id="adminEmail"
              type="email"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              {...register('adminEmail')}
            />
            {errors.adminEmail && <p className="text-xs text-destructive">{errors.adminEmail.message}</p>}
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
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Envoi en cours..." : "Envoyer la demande"}
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
