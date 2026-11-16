import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, TriangleAlert } from 'lucide-react';

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  message: string | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erreur non gérée :', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <section className="max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <TriangleAlert aria-hidden="true" className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">
              Une erreur est survenue
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {this.state.message ?? 'Une erreur inattendue s’est produite dans l’interface.'}
            </p>
            <Button
              onClick={() => this.setState({ hasError: false, message: null })}
              className="mt-6"
            >
              <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
              Réessayer
            </Button>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}