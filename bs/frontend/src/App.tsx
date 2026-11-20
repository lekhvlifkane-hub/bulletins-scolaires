import { lazy, Suspense } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Layout } from '@/components/Layout';
import { LoginPage } from '@/pages/LoginPage';

const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ProfilePage = lazy(() => import('@/pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const UsersPage = lazy(() => import('@/pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const SchoolsPage = lazy(() => import('@/pages/SchoolsPage').then((m) => ({ default: m.SchoolsPage })));
const SchoolDetailPage = lazy(() => import('@/pages/SchoolDetailPage').then((m) => ({ default: m.SchoolDetailPage })));
const SchoolSettingsPage = lazy(() => import('@/pages/SchoolSettingsPage').then((m) => ({ default: m.SchoolSettingsPage })));
const TemporaryAccessPage = lazy(() => import('@/pages/TemporaryAccessPage').then((m) => ({ default: m.TemporaryAccessPage })));
const AuditLogsPage = lazy(() => import('@/pages/AuditLogsPage').then((m) => ({ default: m.AuditLogsPage })));
const StudentsPage = lazy(() => import('@/pages/StudentsPage').then((m) => ({ default: m.StudentsPage })));
const ClassesPage = lazy(() => import('@/pages/ClassesPage').then((m) => ({ default: m.ClassesPage })));
const DisciplinesPage = lazy(() => import('@/pages/DisciplinesPage').then((m) => ({ default: m.DisciplinesPage })));
const EvaluationTypesPage = lazy(() => import('@/pages/EvaluationTypesPage').then((m) => ({ default: m.EvaluationTypesPage })));
const StudentDetailPage = lazy(() => import('@/pages/StudentDetailPage').then((m) => ({ default: m.StudentDetailPage })));
const NotesEntryPage = lazy(() => import('@/pages/NotesEntryPage').then((m) => ({ default: m.NotesEntryPage })));
const VerificationsPage = lazy(() => import('@/pages/VerificationsPage').then((m) => ({ default: m.VerificationsPage })));
const CalculsPage = lazy(() => import('@/pages/CalculsPage').then((m) => ({ default: m.CalculsPage })));
const BulletinsPage = lazy(() => import('@/pages/BulletinsPage').then((m) => ({ default: m.BulletinsPage })));
const BulletinDetailPage = lazy(() => import('@/pages/BulletinDetailPage').then((m) => ({ default: m.BulletinDetailPage })));
const ComparaisonPage = lazy(() => import('@/pages/ComparaisonPage').then((m) => ({ default: m.ComparaisonPage })));
const BilanAnnuelPage = lazy(() => import('@/pages/BilanAnnuelPage').then((m) => ({ default: m.BilanAnnuelPage })));
const BilanAnnuelDetailPage = lazy(() => import('@/pages/BilanAnnuelDetailPage').then((m) => ({ default: m.BilanAnnuelDetailPage })));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));
const VieScolairePage = lazy(() => import('@/pages/VieScolairePage').then((m) => ({ default: m.VieScolairePage })));
const SchoolRegistrationPage = lazy(() => import('@/pages/SchoolRegistrationPage').then((m) => ({ default: m.SchoolRegistrationPage })));
const SchoolsPendingPage = lazy(() => import('@/pages/SchoolsPendingPage').then((m) => ({ default: m.SchoolsPendingPage })));

function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Suspense fallback={<div className="p-6">Chargement…</div>}>
        <Routes>
          <Route path="/connexion" element={<LoginPage />} />
          <Route path="/inscription-etablissement" element={<SchoolRegistrationPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/profil" element={<ProfilePage />} />
              <Route path="/eleves" element={<StudentsPage />} />
              <Route
                element={<ProtectedRoute roles={['SCHOOL_ADMIN', 'SURVEILLANT_GENERAL', 'ASSISTANT']} />}
              >
                <Route path="/classes" element={<ClassesPage />} />
                <Route path="/disciplines" element={<DisciplinesPage />} />
              </Route>
              <Route path="/eleves/:id" element={<StudentDetailPage />} />
              <Route
                element={<ProtectedRoute roles={['SCHOOL_ADMIN', 'SURVEILLANT_GENERAL', 'ASSISTANT']} />}
              >
                <Route path="/saisie-notes" element={<NotesEntryPage />} />
                <Route path="/types-evaluation" element={<EvaluationTypesPage />} />
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
                <Route path="/demandes-inscription" element={<SchoolsPendingPage />} />
              </Route>
              <Route element={<ProtectedRoute roles={['PLATFORM_ADMIN', 'SCHOOL_ADMIN']} />}>
                <Route path="/journal-audit" element={<AuditLogsPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
      </HashRouter>
    </AuthProvider>
  );
}

export default App;
