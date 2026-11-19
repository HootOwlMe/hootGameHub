/* =====================================================================
 * Number formatting — Cookie-Clicker-style short scale (K, M, B, T …).
 * Exposed as window.CC_FMT.
 * ===================================================================*/
(function (global) {
  'use strict';

  const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

  /** Compact display: 999 -> "999", 1234 -> "1.23K", 5e15 -> "5.00Qa" */
  function fmt(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '∞';
    if (n < 0) n = 0;
    if (n < 1e3) {
      const v = Math.floor(n * 10) / 10;
      return (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : String(v));
    }
    let tier = Math.min(Math.floor(Math.log10(n) / 3), SUFFIX.length - 1);
    const v = n / Math.pow(10, tier * 3);
    const s = v >= 100 ? v.toFixed(0) : (v >= 10 ? v.toFixed(1) : v.toFixed(2));
    return s + SUFFIX[tier];
  }

  /** Integer display with commas up to a million, compact beyond. */
  function int(n) {
    if (!isFinite(n) || n < 0) n = 0;
    if (n < 1e6) return Math.floor(n).toLocaleString('en-US');
    return fmt(n);
  }

  /** Milliseconds -> "2h 05m 09s" style. */
  function time(ms) {
    let s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60);   s -= m * 60;
    if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
    if (m > 0) return m + 'm ' + String(s).padStart(2, '0') + 's';
    return s + 's';
  }

  global.CC_FMT = { fmt: fmt, int: int, time: time };
})(typeof window !== 'undefined' ? window : globalThis);
