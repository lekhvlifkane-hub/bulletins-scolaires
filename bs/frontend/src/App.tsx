import { HashRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Layout } from '@/components/Layout';
import { LoginPage } from '@/pages/LoginPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { UsersPage } from '@/pages/UsersPage';
import { SchoolsPage } from '@/pages/SchoolsPage';
import { SchoolDetailPage } from '@/pages/SchoolDetailPage';
import { SchoolSettingsPage } from '@/pages/SchoolSettingsPage';
import { TemporaryAccessPage } from '@/pages/TemporaryAccessPage';
import { AuditLogsPage } from '@/pages/AuditLogsPage';
import { StudentsPage } from '@/pages/StudentsPage';
import { StudentDetailPage } from '@/pages/StudentDetailPage';
import { NotesEntryPage } from '@/pages/NotesEntryPage';
import { VerificationsPage } from '@/pages/VerificationsPage';
import { CalculsPage } from '@/pages/CalculsPage';
import { BulletinsPage } from '@/pages/BulletinsPage';
import { BulletinDetailPage } from '@/pages/BulletinDetailPage';
import { ComparaisonPage } from '@/pages/ComparaisonPage';
import { BilanAnnuelPage } from '@/pages/BilanAnnuelPage';
import { BilanAnnuelDetailPage } from '@/pages/BilanAnnuelDetailPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { VieScolairePage } from '@/pages/VieScolairePage';

function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/connexion" element={<LoginPage />} />
          <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
          <Route path="/reinitialiser-mot-de-passe" element={<ResetPasswordPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/profil" element={<ProfilePage />} />
              <Route path="/eleves" element={<StudentsPage />} />
              <Route path="/eleves/:id" element={<StudentDetailPage />} />
              <Route
                element={<ProtectedRoute roles={['SCHOOL_ADMIN', 'SURVEILLANT_GENERAL', 'ASSISTANT']} />}
              >
                <Route path="/saisie-notes" element={<NotesEntryPage />} />
                <Route path="/verifications" element={<VerificationsPage />} />
                <Route path="/calculs" element={<CalculsPage />} />
                <Route path="/bulletins" element={<BulletinsPage />} />
                <Route path="/bulletins/:id" element={<BulletinDetailPage />} />
                <Route path="/comparaison-semestres" element={<ComparaisonPage />} />
                <Route path="/bilan-annuel" element={<BilanAnnuelPage />} />
                <Route path="/bilan-annuel/:id" element={<BilanAnnuelDetailPage />} />
                <Route path="/vie-scolaire" element={<VieScolairePage />} />
              </Route>
              <Route element={<ProtectedRoute roles={['PLATFORM_ADMIN', 'SCHOOL_ADMIN']} />}>
                <Route path="/utilisateurs" element={<UsersPage />} />
                <Route path="/acces-temporaire" element={<TemporaryAccessPage />} />
              </Route>
              <Route element={<ProtectedRoute roles={['SCHOOL_ADMIN']} />}>
                <Route path="/parametres-etablissement" element={<SchoolSettingsPage />} />
              </Route>
              <Route element={<ProtectedRoute roles={['PLATFORM_ADMIN']} />}>
                <Route path="/etablissements" element={<SchoolsPage />} />
                <Route path="/etablissements/:schoolId" element={<SchoolDetailPage />} />
              </Route>
              <Route element={<ProtectedRoute roles={['PLATFORM_ADMIN', 'SCHOOL_ADMIN']} />}>
                <Route path="/journal-audit" element={<AuditLogsPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}

export default App;
