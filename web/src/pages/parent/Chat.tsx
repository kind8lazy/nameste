// Чат семьи с диспетчером и водителем.
import { ChatBrowser } from '../../components/Chat';
import { Clock } from '../../components/Clock';

export function Chat() {
  return (
    <main className="page">
      <div className="page-head">
        <Clock />
        <h1 className="page-title">Чат</h1>
      </div>
      <ChatBrowser />
    </main>
  );
}
