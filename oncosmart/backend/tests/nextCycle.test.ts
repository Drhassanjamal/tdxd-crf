import { describe, expect, it } from 'vitest';
import { suggestNext } from '../src/services/nextCycle';

describe('next-cycle suggestion', () => {
  it('single-day 14-day cycle → next cycle D1 two weeks later', () => {
    expect(suggestNext({ treatmentDays: [1], cycleLengthDays: 14, plannedCycles: 12, cycle: 1, day: 1, date: '2026-09-27' })).toEqual({ cycle: 2, day: 1, dueDate: '2026-10-11' });
  });
  it('D1/D8 schedule → same-cycle D8, then next cycle', () => {
    expect(suggestNext({ treatmentDays: [1, 8], cycleLengthDays: 21, plannedCycles: 6, cycle: 2, day: 1, date: '2026-09-27' })).toEqual({ cycle: 2, day: 8, dueDate: '2026-10-04' });
    expect(suggestNext({ treatmentDays: [1, 8], cycleLengthDays: 21, plannedCycles: 6, cycle: 2, day: 8, date: '2026-10-04' })).toEqual({ cycle: 3, day: 1, dueDate: '2026-10-18' });
  });
  it('returns null when all planned cycles are completed', () => {
    expect(suggestNext({ treatmentDays: [1], cycleLengthDays: 21, plannedCycles: 6, cycle: 6, day: 1, date: '2026-09-27' })).toBeNull();
  });
});
