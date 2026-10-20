// Форма «Новое место»: название, адрес (ищем на карте), как пройти. Её используют клиент в профиле и диспетчер в карточке клиента.
import { useState } from 'react';
import { api } from '../lib/api';

export interface FoundPlace {
  name: string;
  address: string;
  lat: number;
  lon: number;
}

export interface PlacePayload {
  name: string;
  address: string;
  lat: number;
  lon: number;
  entranceNote?: string;
}

export function PlaceForm({ geocodePath, onSave, title = 'Новое место' }: { geocodePath: string; onSave: (p: PlacePayload) => Promise<boolean>; title?: string }) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<FoundPlace[]>([]);
  const [picked, setPicked] = useState<FoundPlace | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = async (): Promise<FoundPlace[]> => {
    if (query.trim().length < 3 || busy) return [];
    setBusy(true);
    setPicked(null);
    try {
      const list = await api.get<FoundPlace[]>(`${geocodePath}?q=${encodeURIComponent(`${query}, Санкт-Петербург`)}`);
      setFound(list);
      setSearched(true);
      if (list.length === 1) setPicked(list[0]); // единственный вариант выбираем сами
      return list;
    } catch {
      setFound([]);
      setSearched(true);
      return [];
    } finally {
      setBusy(false);
    }
  };

  const save = async (place: FoundPlace) => {
    setBusy(true);
    const ok = await onSave({ name: name.trim(), address: place.address, lat: place.lat, lon: place.lon, entranceNote: note.trim() || undefined });
    setBusy(false);
    if (ok) {
      setName('');
      setQuery('');
      setFound([]);
      setSearched(false);
      setPicked(null);
      setNote('');
    }
  };

  // адрес ещё не искали: ищем сами и, если вариант один, сразу добавляем
  const submit = async () => {
    if (picked) return save(picked);
    const list = await search();
    // улицу без номера дома сразу не сохраняем: сначала показываем предупреждение, человек подтверждает вторым нажатием
    const streetOnly = list.length === 1 && /\d/.test(query) && !/\d/.test(list[0].address.split(',')[0] ?? '');
    if (list.length === 1 && !streetOnly) await save(list[0]);
  };

  const ready = name.trim().length >= 2 && query.trim().length >= 3;
  // дом не нашёлся на карте — точка встанет посередине улицы, водителю это нужно подсказать
  const noHouse = !!picked && /\d/.test(query) && !/\d/.test(picked.address.split(',')[0] ?? '');
  const hint = !ready ? 'Впишите название и адрес' : found.length > 1 && !picked ? 'Нашлось несколько адресов: нажмите на нужный' : null;

  return (
    <div className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
      <h3>{title}</h3>
      <div style={{ display: 'grid', gap: 10 }}>
        <div className="field">
          <label htmlFor="np-name">Название</label>
          <input id="np-name" className="input" placeholder="Школа, Теннис, Дом" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="np-q">Адрес</label>
          <input
            id="np-q"
            className="input"
            placeholder="проспект Динамо 14"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearched(false);
              setPicked(null);
              setFound([]);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void search();
              }
            }}
          />
        </div>
        <button className="btn secondary" disabled={query.trim().length < 3 || busy} onClick={() => void search()}>
          {busy ? 'Ищу…' : 'Найти на карте'}
        </button>
      </div>
      {searched && !found.length && <div className="note error">Такой адрес не нашёлся. Напишите полностью: «проспект Динамо 14» или «Большой проспект П.С. 82».</div>}
      {found.length > 1 && (
        <div className="pick">
          {found.map((f, i) => (
            <button key={i} className={picked === f ? 'on' : ''} onClick={() => setPicked(f)}>
              {f.address}
            </button>
          ))}
        </div>
      )}
      {found.length === 1 && picked && <small className="page-sub">Нашли: {picked.address}</small>}
      <div className="field">
        <label htmlFor="np-note">Как пройти (увидит водитель)</label>
        <input id="np-note" className="input" placeholder="Вход со двора, 2 этаж, кабинет 12" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {noHouse && <div className="note">Карта нашла только улицу, номер дома не определился. Точка встанет посередине улицы: впишите номер дома и подъезд в поле «Как пройти», чтобы водитель не ошибся.</div>}
      {hint && <small className="page-sub">{hint}.</small>}
      <button className="btn" disabled={!ready || busy} onClick={() => void submit()}>
        {busy ? 'Ищу адрес…' : 'Добавить место'}
      </button>
    </div>
  );
}
