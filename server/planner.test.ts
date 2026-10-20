import { describe, expect, it } from 'vitest';
import { planStops, type PlanRide } from './modules/planner';

const school = { id: 'school', lat: 59.9695, lon: 30.27 };
const home = { id: 'home', lat: 59.9608, lon: 30.2705 };
const tennis = { id: 'tennis', lat: 59.98, lon: 30.3 };
const music = { id: 'music', lat: 59.9537, lon: 30.3253 };
const ride = (id: string, t: string, from: typeof school, to: typeof school, escort: PlanRide['escort'] = 'to_door'): PlanRide => ({ id, pickupTime: t, escort, from, to });

describe('планировщик рейса', () => {
  it('двое детей из одной школы — один забор, высадка по ближайшим', () => {
    const p = planStops([ride('masha', '14:20', school, tennis), ride('leva', '14:20', school, home)]);
    expect(p.map((s) => `${s.kind}:${s.placeId}`)).toEqual(['pickup:school', 'dropoff:home', 'dropoff:tennis']);
    expect(p[0].rideIds.sort()).toEqual(['leva', 'masha']);
  });
  it('видит, что машина не успевает к следующему забору', () => {
    const p = planStops([ride('a', '14:20', school, music), ride('b', '14:25', tennis, home)]);
    const late = p.find((s) => s.kind === 'pickup' && s.placeId === 'tennis');
    expect(late?.lateMin).toBeGreaterThan(0);
  });
  it('если до следующего забора не успеть развезти — ребёнок едет дальше в машине', () => {
    const p = planStops([ride('a', '14:20', school, music), ride('b', '14:30', home, tennis)]);
    const order = p.map((s) => `${s.kind}:${s.placeId}`);
    expect(order.indexOf('pickup:home')).toBeLessThan(order.indexOf('dropoff:music'));
  });
  it('общая точка высадки объединяется', () => {
    const p = planStops([ride('a', '14:20', school, tennis), ride('b', '14:20', school, tennis)]);
    expect(p.filter((s) => s.kind === 'dropoff')).toHaveLength(1);
  });
});
