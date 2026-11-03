// Сообщения для диспетчера и водителя: все семьи и чат команды.
import { useSearchParams } from 'react-router-dom';
import { ChatBrowser } from '../../components/Chat';
import { useAuth } from '../../lib/auth';
import { Clock } from '../../components/Clock';
import { DeskNav } from './DeskNav';
import { BackButton } from '../../components/ui';

/** Диспетчер видит это на компьютере с меню слева, водитель — на телефоне. */
export function StaffChat() {
  const [params] = useSearchParams();
  const { me } = useAuth();
  const desk = !!me?.roles.includes('dispatcher');
  if (!desk) {
    return (
      <div className="app theme-driver">
        <main className="page">
          <div className="page-head">
            <Clock />
            <BackButton to="/driver" label="Главная" />
            <h1 className="page-title">Сообщения</h1>
          </div>
          <ChatBrowser initial={params.get('thread')} />
        </main>
      </div>
    );
  }
  return (
    <div className="desk desk-2">
      <DeskNav />
      <main className="desk-main" style={{ maxWidth: 1100 }}>
        <div className="page-head">
          <Clock />
          <h1 className="page-title">Сообщения</h1>
        </div>
        <ChatBrowser initial={params.get('thread')} />
      </main>
    </div>
  );
}
