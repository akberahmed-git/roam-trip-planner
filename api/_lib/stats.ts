import { kvRun, KV_ENABLED } from './kvCache.js';

// What people actually plan, and roughly where from. Two capped lists in the
// same Upstash store the caches use: one entry per generation attempt (served
// or turned away), and one per client beacon (landed, generate, saved). Read
// back through api/stats.ts with the STATS_TOKEN.
//
// Deliberately no IP address. Vercel resolves the city, region and country on
// every request and hands them over as headers, which is the level of "where"
// worth knowing for a portfolio app and keeps the store free of anything that
// identifies a person. Nothing here runs in the browser, so ad blockers cannot
// remove the generation log; the beacons are best effort (Akber, 9 Sep 2026).

const GENERATIONS_KEY = 'stats:generations';
const EVENTS_KEY = 'stats:events';
const MAX_ENTRIES = 5000;

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : null) || null;
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

function header(req, name) {
  const raw = req?.headers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  // Vercel URL-encodes city names ("S%C3%A3o%20Paulo").
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}

export function geoOf(req) {
  return {
    city: header(req, 'x-vercel-ip-city'),
    region: header(req, 'x-vercel-ip-country-region'),
    country: header(req, 'x-vercel-ip-country'),
  };
}

// The trip as requested, trimmed to the fields worth keeping and to sane
// lengths, so a hostile body cannot fill the store with junk.
export function describeRequest(body) {
  const b = body || {};
  const interests = Array.isArray(b.interests)
    ? b.interests.map((i) => text(i, 40)).filter(Boolean).slice(0, 12)
    : [];
  return {
    destination: text(b.destination, 80),
    days: number(b.days),
    startDate: text(b.startDate || b.checkInDate, 10),
    endDate: text(b.endDate || b.checkOutDate, 10),
    budget: text(b.budget, 20),
    transport: text(b.transport, 30),
    interests,
    adults: number(b.adults),
    accommodation: text(b.accommodation, 80),
  };
}

async function push(key, entry) {
  if (!KV_ENABLED) return;
  await kvRun(['LPUSH', key, JSON.stringify(entry)]);
  await kvRun(['LTRIM', key, 0, MAX_ENTRIES - 1]);
}

// outcome: ok | rate_limited | places_unavailable | anthropic_capacity | error
export async function recordGeneration(req, entry) {
  try {
    await push(GENERATIONS_KEY, { at: new Date().toISOString(), ...geoOf(req), ...describeRequest(req.body), ...entry });
  } catch {
    // Never let the log break a generation.
  }
}

const EVENTS = new Set(['landed', 'plan_started', 'generate', 'generated', 'rate_limited', 'saved', 'swap']);
const SESSION = /^[A-Za-z0-9-]{8,40}$/;

// Beacons from src/utils/track.ts. Anything malformed is dropped silently; the
// endpoint answers 204 either way so a probe learns nothing.
export async function recordEvent(req, body) {
  const b = typeof body === 'string' ? safeParse(body) : body || {};
  const session = text(b.session, 40);
  const event = text(b.event, 20);
  if (!session || !SESSION.test(session) || !event || !EVENTS.has(event)) return;
  const elapsed = number(b.elapsedMs);
  try {
    await push(EVENTS_KEY, {
      at: new Date().toISOString(),
      ...geoOf(req),
      session,
      event,
      elapsedMs: elapsed !== null && elapsed >= 0 && elapsed < 86400000 ? Math.round(elapsed) : null,
      path: text(b.path, 80),
      destination: text(b.destination, 80),
    });
  } catch {
    // Same: best effort.
  }
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export async function readStats(list, limit) {
  const key = list === 'events' ? EVENTS_KEY : GENERATIONS_KEY;
  const rows = await kvRun(['LRANGE', key, 0, Math.max(0, limit - 1)]);
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => (typeof row === 'string' ? safeParse(row) : row)).filter((r) => r && typeof r === 'object');
}

export function toCsv(rows: Record<string, any>[]) {
  if (rows.length === 0) return '';
  const columns: string[] = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => {
    const s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n');
}
