// Форма «Новое место»: название, адрес с подсказками во время ввода, как пройти.
// Адрес ищем сами, пока человек печатает (как в Яндекс Картах); выбранная точка видна на маленькой карте —
// по её координатам строится порядок остановок и время в пути. Форму используют клиент в «Семье» и диспетчер в карточке.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { MiniMap } from './MiniMap';

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

const MIN_QUERY = 4;
const DEBOUNCE_MS = 700;

export function PlaceForm({ geocodePath, onSave, title = 'Новое место' }: { geocodePath: string; onSave: (p: PlacePayload) => Promise<boolean>; title?: string }) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<FoundPlace[]>([]);
  const [picked, setPicked] = useState<FoundPlace | null>(null);
  const [note, setNote] = useState('');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  // ищем, пока человек печатает: пауза 0,7 с, ответы на устаревший текст отбрасываем
  useEffect(() => {
    if (picked || query.trim().length < MIN_QUERY) {
      setFound([]);
      setSearched(false);
      return;
    }
    const n = ++seq.current;
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        const list = await api.get<FoundPlace[]>(`${geocodePath}?q=${encodeURIComponent(`${query}, Санкт-Петербург`)}`);
        if (n !== seq.current) return;
        setFound(list);
      } catch {
        if (n === seq.current) setFound([]);
      } finally {
        if (n === seq.current) {
          setSearching(false);
          setSearched(true);
        }
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query, picked, geocodePath]);

  const save = async () => {
    if (!picked) return;
    setSaving(true);
    const ok = await onSave({ name: name.trim(), address: picked.address, lat: picked.lat, lon: picked.lon, entranceNote: note.trim() || undefined });
    setSaving(false);
    if (ok) {
      setName('');
      setQuery('');
      setFound([]);
      setSearched(false);
      setPicked(null);
      setNote('');
    }
  };

  // дом не нашёлся на карте — точка встанет посередине улицы, водителю это нужно подсказать
  const noHouse = !!picked && /\d/.test(query) && !/\d/.test(picked.address.split(',')[0] ?? '');
  const hint = name.trim().length < 2 ? 'Впишите название места' : !picked ? 'Выберите адрес из подсказок' : null;

  return (
    <div className="card" style={{ padding: 14, display: 'grid', gap: 12 }}>
      <h3>{title}</h3>
      <div className="field">
        <label htmlFor="np-name">Название</label>
        <input id="np-name" className="input" placeholder="Школа, Теннис, Дом" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="np-q">Адрес</label>
        {picked ? (
          <div className="place-picked">
            <span>
              <b>{picked.address.split(',').slice(0, 2).join(',')}</b>
              <small>{picked.address.split(',').slice(2, 4).join(',')}</small>
            </span>
            <button
              type="button"
              className="btn small secondary"
              onClick={() => {
                setPicked(null);
                setFound([]);
              }}
            >
              Изменить
            </button>
          </div>
        ) : (
          <>
            <input
              id="np-q"
              className="input"
              placeholder="проспект Динамо 14"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter выбирает первую подсказку
                if (e.key === 'Enter' && found[0]) {
                  e.preventDefault();
                  setPicked(found[0]);
                }
              }}
            />
            {searching && <small className="page-sub">Ищу адрес…</small>}
            {!searching && found.length > 0 && (
              <ul className="list suggest" role="listbox" aria-label="Найденные адреса">
                {found.map((f, i) => (
                  <li key={`${f.lat},${f.lon},${i}`}>
                    <button type="button" role="option" aria-selected={false} onClick={() => setPicked(f)}>
                      <b>{f.address.split(',').slice(0, 2).join(',')}</b>
                      <small>{f.address.split(',').slice(2, 4).join(',')}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!searching && searched && !found.length && <small className="note error">Такой адрес не нашёлся. Напишите улицу и дом полностью: «проспект Динамо 14», «Большой проспект П.С. 82».</small>}
          </>
        )}
      </div>

      {picked && <MiniMap car={null} target={{ lat: picked.lat, lon: picked.lon, name: name.trim() || picked.address }} height={150} />}
      {noHouse && <div className="note">Карта нашла только улицу, без номера дома — точка встанет посередине улицы. Впишите дом и подъезд в «Как пройти», чтобы водитель не ошибся.</div>}

      <div className="field">
        <label htmlFor="np-note">Как пройти (увидит водитель)</label>
        <input id="np-note" className="input" placeholder="Вход со двора, 2 этаж, кабинет 12" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {hint && <small className="page-sub">{hint}.</small>}
      <button className="btn" disabled={!picked || name.trim().length < 2 || saving} onClick={() => void save()}>
        {saving ? 'Сохраняю…' : 'Добавить место'}
      </button>
    </div>
  );
}
