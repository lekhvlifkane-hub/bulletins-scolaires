import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { NotFoundPage } from './NotFoundPage';

describe('NotFoundPage', () => {
  it('explique que la page demandée est introuvable et propose le retour', () => {
    render(
      <MemoryRouter initialEntries={['/adresse-inconnue']}>
        <Routes><Route path="*" element={<NotFoundPage />} /></Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Cette page est introuvable' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Retour à l’accueil' })).toHaveAttribute('href', '/');
  });
});
