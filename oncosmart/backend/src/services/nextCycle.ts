import { addDays } from '../utils/dates';

export interface NextCycleSuggestion {
  cycle: number;
  day: number;
  dueDate: string;
}

/**
 * Suggests the next treatment (cycle/day/date) from the protocol's configured
 * treatment days and cycle length. Returns null when all planned cycles are done.
 * This is a scheduling suggestion only — the physician decides on the next treatment.
 */
export function suggestNext(p: {
  treatmentDays: number[];
  cycleLengthDays: number;
  plannedCycles: number;
  cycle: number;
  day: number;
  date: string; // date the current cycle/day was given
}): NextCycleSuggestion | null {
  const days = [...new Set(p.treatmentDays.length ? p.treatmentDays : [1])].sort((a, b) => a - b);
  const day1Date = addDays(p.date, -(p.day - 1));
  const laterDay = days.find((d) => d > p.day && d <= p.cycleLengthDays);
  if (laterDay) return { cycle: p.cycle, day: laterDay, dueDate: addDays(day1Date, laterDay - 1) };
  if (p.cycle + 1 > p.plannedCycles) return null;
  const first = days[0];
  return { cycle: p.cycle + 1, day: first, dueDate: addDays(day1Date, p.cycleLengthDays + first - 1) };
}
