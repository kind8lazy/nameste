import { describe, expect, it } from 'vitest';
import { handle, START, TEXT, type Input, type State } from './dialog';

/** Прогоняет разговор по шагам и возвращает последнее состояние, ответы и заявку. */
function talk(inputs: Input[], from: State = START) {
  let state = from;
  let last: ReturnType<typeof handle> | undefined;
  for (const i of inputs) {
    last = handle(state, i);
    state = last.state;
  }
  return last!;
}

const full: Input[] = [
  { text: '/start' },
  { button: 'new' },
  { text: 'Анна' },
  { contactPhone: '+7 (921) 123-45-67' },
  { text: 'Маша, 4 класс' },
  { text: 'Школа № 56' },
  { text: 'Теннис на Крестовском' },
  { text: 'пн, ср в 14:20' },
];

describe('бот заявок', () => {
  it('задаёт вопросы по одному и в конце показывает заявку на проверку', () => {
    const r = talk([...full, { button: 'skip' }]);
    expect(r.state.step).toBe('confirm');
    expect(r.replies[0].keyboard).toBe('confirm');
    expect(r.replies[0].text).toContain('Маша, 4 класс');
    expect(r.replies[0].text).toContain('+7 921 123-45-67');
    expect(r.lead).toBeUndefined();
  });

  it('заявка уходит только после «Отправить»', () => {
    const r = talk([...full, { text: 'бустер' }, { button: 'send' }]);
    expect(r.lead).toEqual({ name: 'Анна', phone: '79211234567', children: 'Маша, 4 класс', fromText: 'Школа № 56', toText: 'Теннис на Крестовском', schedule: 'пн, ср в 14:20', comment: 'бустер' });
    expect(r.state.step).toBe('idle');
    expect(r.replies[0].text).toBe(TEXT.sent);
  });

  it('номер можно написать текстом; непонятный номер спрашивает ещё раз', () => {
    const bad = talk([{ button: 'new' }, { text: 'Анна' }, { text: '123' }]);
    expect(bad.state.step).toBe('phone');
    expect(bad.replies[0].text).toBe(TEXT.phoneBad);
    const ok = handle(bad.state, { text: '8 921 123 45 67' });
    expect(ok.state.draft.phone).toBe('79211234567');
    expect(ok.state.step).toBe('children');
  });

  it('«Исправить» начинает заново, /cancel отменяет, пустой ответ не принимается', () => {
    const atConfirm = talk([...full, { button: 'skip' }]).state;
    expect(handle(atConfirm, { button: 'edit' }).state).toEqual({ step: 'name', draft: {} });
    expect(handle(atConfirm, { text: '/cancel' }).state).toEqual(START);
    const atChildren = talk(full.slice(0, 4)).state;
    expect(handle(atChildren, { text: '   ' }).state).toEqual(atChildren);
    expect(handle(atChildren, { text: 'x'.repeat(301) }).replies[0].text).toBe(TEXT.tooLong);
  });

  it('без начатой заявки предлагает её оставить', () => {
    const r = handle(START, { text: 'привет' });
    expect(r.replies[0].keyboard).toBe('start');
  });
});
