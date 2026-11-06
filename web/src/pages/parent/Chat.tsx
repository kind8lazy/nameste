// Чат семьи с диспетчером и водителем. Один заголовок — с кем говорите; без нижней панели, назад — стрелкой.
import { ChatBrowser } from '../../components/Chat';
import { BackButton } from '../../components/ui';

export function Chat() {
  return (
    <main className="page parent-chat">
      <div className="page-head">
        <BackButton to="/app" label="Поездки" />
        <h1 className="page-title">Диспетчер</h1>
        <span className="page-sub">и водитель</span>
      </div>
      <ChatBrowser />
    </main>
  );
}
