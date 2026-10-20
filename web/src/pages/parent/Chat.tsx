// Чат семьи с диспетчером и водителем.
import { ChatBrowser } from '../../components/Chat';

export function Chat() {
  return (
    <main className="page">
      <h1 className="page-title">Чат</h1>
      <ChatBrowser />
    </main>
  );
}
