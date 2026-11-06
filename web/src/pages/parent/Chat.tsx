// Чат семьи с диспетчером и водителем. Назад — на «Запланированные поездки».
import { ChatBrowser } from '../../components/Chat';
import { Clock } from '../../components/Clock';
import { BackButton } from '../../components/ui';

export function Chat() {
  return (
    <main className="page">
      <div className="page-head">
        <Clock />
        <BackButton to="/app" label="Поездки" />
        <h1 className="page-title">Чат</h1>
      </div>
      <ChatBrowser />
    </main>
  );
}
