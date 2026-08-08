import {
  CONFIDENCE_FLOOR,
  decayed,
  isTrusted,
  onHit,
  onMiss,
} from './confidence';

describe('confidence', () => {
  it('climbs slowly on a hit', () => {
    expect(onHit(0.5)).toBe(0.6);
    expect(onHit(0.95)).toBe(1);
  });

  it('drops sharply on a miss', () => {
    // Asymmetric on purpose: one wrong answer costs more than one right answer
    // earns, because a confidently wrong selector is the failure that looks
    // like a pass.
    expect(onMiss(0.5)).toBe(0.2);
    expect(onMiss(0.1)).toBe(0);
  });

  it('takes three hits to undo one miss', () => {
    const after = onHit(onHit(onHit(onMiss(0.5))));
    expect(after).toBeCloseTo(0.5, 5);
  });

  it('decays with age', () => {
    const now = new Date('2026-03-01T00:00:00Z');

    expect(decayed(1, new Date('2026-03-01T00:00:00Z'), now)).toBe(1);
    expect(decayed(1, new Date('2026-02-14T00:00:00Z'), now)).toBeLessThan(0.6);
    // A month untouched is a guess about a page that has had a month to change.
    expect(decayed(1, new Date('2026-01-01T00:00:00Z'), now)).toBe(0);
  });

  it('never returns a value outside 0..1', () => {
    expect(onHit(1)).toBe(1);
    expect(onMiss(0)).toBe(0);
    expect(decayed(0.5, new Date('2000-01-01'), new Date())).toBe(0);
  });

  it('stops trusting an entry below the floor', () => {
    expect(isTrusted(CONFIDENCE_FLOOR)).toBe(true);
    expect(isTrusted(CONFIDENCE_FLOOR - 0.01)).toBe(false);
    // One miss from a middling score is enough to stop trusting it.
    expect(isTrusted(onMiss(0.5))).toBe(false);
  });
});
