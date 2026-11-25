// Numeric helpers.

/** Clamp `v` into [lo, hi]. Guards against hi < lo (returns lo). */
export const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));
