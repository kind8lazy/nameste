import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import '@fontsource/golos-text/cyrillic-400.css';
import '@fontsource/golos-text/cyrillic-500.css';
import '@fontsource/golos-text/cyrillic-600.css';
import '@fontsource/golos-text/latin-400.css';
import '@fontsource/golos-text/latin-600.css';
import '@fontsource/geologica/cyrillic-600.css';
import '@fontsource/geologica/cyrillic-700.css';
import '@fontsource/geologica/latin-600.css';
import './styles.css';
import { AuthProvider, RequireRole, homeFor, useAuth } from './lib/auth';
import { registerServiceWorker } from './lib/push';
import { Login } from './pages/Login';
import { ParentLayout } from './pages/parent/Layout';
import { Today } from './pages/parent/Today';
import { Week } from './pages/parent/Week';
import { Family } from './pages/parent/Family';
import { NewRide } from './pages/parent/NewRide';
import { Shift } from './pages/driver/Shift';
import { Board } from './pages/admin/Board';
import { Clients } from './pages/admin/Clients';
import { FamilyCard } from './pages/admin/FamilyCard';
import { Track } from './pages/Track';
import { Chat } from './pages/parent/Chat';
import { StaffChat } from './pages/admin/StaffChat';

function Home() {
  const { me, loading } = useAuth();
  if (loading) return <div className="empty">Загрузка…</div>;
  return <Navigate to={me ? homeFor(me) : '/login'} replace />;
}

void registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/t/:token" element={<Track />} />
          <Route
            path="/app"
            element={
              <RequireRole roles={['parent', 'dispatcher']}>
                <ParentLayout />
              </RequireRole>
            }
          >
            <Route index element={<Today />} />
            <Route path="week" element={<Week />} />
            <Route path="family" element={<Family />} />
            <Route path="new" element={<NewRide />} />
            <Route path="chat" element={<Chat />} />
          </Route>
          <Route
            path="/driver"
            element={
              <RequireRole roles={['driver']}>
                <Shift />
              </RequireRole>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireRole roles={['dispatcher']}>
                <Board />
              </RequireRole>
            }
          />
          <Route
            path="/admin/clients"
            element={
              <RequireRole roles={['dispatcher']}>
                <Clients />
              </RequireRole>
            }
          />
          <Route
            path="/admin/clients/:id"
            element={
              <RequireRole roles={['dispatcher']}>
                <FamilyCard />
              </RequireRole>
            }
          />
          <Route
            path="/admin/chat"
            element={
              <RequireRole roles={['dispatcher']}>
                <StaffChat />
              </RequireRole>
            }
          />
          <Route
            path="/driver/chat"
            element={
              <RequireRole roles={['driver']}>
                <StaffChat />
              </RequireRole>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
