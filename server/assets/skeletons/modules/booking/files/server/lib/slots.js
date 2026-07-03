// Pure availability engine — the ONE place slot math lives. A slot [start, end) is free
// iff it fits inside opening hours and overlaps no booked reservation. Overlap rule:
// aStart < bEnd && bStart < aEnd (half-open intervals — back-to-back bookings are fine).
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/** All slots for a resource on a day, each { startMin, endMin, free }. */
export function slotsForDay(resource, reservations) {
  const out = [];
  const booked = reservations.filter((r) => r.status === 'booked');
  for (let s = resource.open_min; s + resource.slot_minutes <= resource.close_min; s += resource.slot_minutes) {
    const e = s + resource.slot_minutes;
    out.push({ startMin: s, endMin: e, free: !booked.some((b) => overlaps(s, e, b.start_min, b.end_min)) });
  }
  return out;
}
