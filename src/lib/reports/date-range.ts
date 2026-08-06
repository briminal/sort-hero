export type DateRangePreset = "today" | "7d" | "30d" | "90d" | "custom";

export type ResolvedDateRange = { from: string; to: string; preset: DateRangePreset };

const VALID_PRESETS: DateRangePreset[] = ["today", "7d", "30d", "90d", "custom"];
const DEFAULT_TIME_ZONE = "UTC";

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isValidDateStr(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD directly, no manual reassembly needed.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    date,
  );
}

/** Offset (ms) such that `instant's wall-clock time in `timeZone`, read as
 * UTC, equals instant.getTime() + offset` -- the standard dependency-free
 * trick for converting between a timezone's local wall clock and a UTC
 * instant using only Intl (no date-fns-tz/luxon needed). */
function getTimeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const map: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") map[part.type] = part.value;

  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );

  return asUtc - instant.getTime();
}

function addDaysToDateStr(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

/** UTC instant of local midnight for `dateStr` ("YYYY-MM-DD") in
 * `timeZone`. Uses the guessed-instant offset (accurate except within a
 * few hours of that specific timezone's own DST transition, an acceptable
 * approximation for a reports date filter -- not worth a timezone library
 * for). */
function startOfDayInTimeZone(dateStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = new Date(Date.UTC(y!, m! - 1, d!, 0, 0, 0, 0));
  const offsetMs = getTimeZoneOffsetMs(guess, timeZone);
  return new Date(guess.getTime() - offsetMs);
}

function endOfDayInTimeZone(dateStr: string, timeZone: string): Date {
  const start = startOfDayInTimeZone(dateStr, timeZone);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Resolves a preset (or custom from/to) into a concrete [from, to] ISO
 * range, using the shop's actual timezone (captured client-side and passed
 * as `timeZone`) rather than the server's -- a UTC-deployed server would
 * otherwise compute "Today" using the wrong calendar day for any
 * non-UTC shop. Falls back to UTC if no/invalid timezone is provided
 * (e.g. the very first render before the client has set it). Invalid
 * range/date input falls back to the 30d default rather than erroring --
 * this drives a read-only GET filter, not a mutation. */
export function resolveDateRange(params: {
  range?: string;
  from?: string;
  to?: string;
  timeZone?: string;
}): ResolvedDateRange {
  const timeZone = params.timeZone && isValidTimeZone(params.timeZone) ? params.timeZone : DEFAULT_TIME_ZONE;

  const preset = VALID_PRESETS.includes(params.range as DateRangePreset)
    ? (params.range as DateRangePreset)
    : "30d";

  const todayStr = formatDateInTimeZone(new Date(), timeZone);

  if (preset === "custom") {
    const fromStr = params.from && isValidDateStr(params.from) ? params.from : null;
    const toStr = params.to && isValidDateStr(params.to) ? params.to : null;
    if (fromStr && toStr) {
      return {
        from: startOfDayInTimeZone(fromStr, timeZone).toISOString(),
        to: endOfDayInTimeZone(toStr, timeZone).toISOString(),
        preset: "custom",
      };
    }
    // Invalid custom range -- fall through to the 30d default below.
  }

  const daysBack = preset === "today" ? 0 : preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
  const startDateStr = addDaysToDateStr(todayStr, -daysBack);

  return {
    from: startOfDayInTimeZone(startDateStr, timeZone).toISOString(),
    to: endOfDayInTimeZone(todayStr, timeZone).toISOString(),
    preset: preset === "custom" ? "30d" : preset,
  };
}
