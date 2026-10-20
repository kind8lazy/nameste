import { describe, expect, it } from 'vitest';
const { expandAddress } = await import('./modules/geo');

describe('адрес для поиска', () => {
  it('раскрывает сокращения', () => {
    expect(expandAddress('пр. Динамо 14')).toBe('проспект Динамо 14');
    expect(expandAddress('ул. Блохина, д. 5')).toBe('улица Блохина, 5');
    expect(expandAddress('наб. Большой Невки 5, Санкт-Петербург')).toBe('набережная Большой Невки 5, Санкт-Петербург');
    expect(expandAddress('Большой пр. П.С. 82')).toBe('Большой проспект П.С. 82');
  });
  it('не трогает обычные слова', () => {
    expect(expandAddress('Петровский проспект 5')).toBe('Петровский проспект 5');
    expect(expandAddress('Приморский проспект 10')).toBe('Приморский проспект 10');
  });
});
