import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">Erreur 404</p>
        <h1 className="mt-3 text-3xl font-semibold">Cette page est introuvable</h1>
        <p className="mt-2 text-muted-foreground">L’adresse demandée n’existe pas ou n’est plus disponible.</p>
        <Button asChild className="mt-6"><Link to="/">Retour à l’accueil</Link></Button>
      </section>
    </main>
  );
}
