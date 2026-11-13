/**
 * `FE-W166` — a count with its noun agreeing: "1 visit", "3 visits".
 *
 * The console wrote "visit(s)", "position(s)", "row(s)" and "day(s)" — a form that reads as a
 * template nobody finished. Every count a person reads goes through this instead, with both forms
 * spelled out by the caller, so an irregular noun ("entry", "entries") is never guessed at.
 */
export const plural = (count: number, one: string, other: string): string =>
  `${String(count)} ${count === 1 ? one : other}`;
