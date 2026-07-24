/**
 * In-memory session store for Roblox Studio plugin connections.
 * Works correctly on long-running Express processes (unlike Vercel serverless).
 */

export interface SessionData {
  sessionId:   string;
  placeId:     string | null;
  username:    string | null;
  placeName:   string | null;
  connectedAt: number;
  lastSeen:    number;
}

export interface QueuedCommand {
  id:   string;
  type: string;
  args: Record<string, unknown>;
}

export interface CommandResult {
  result:      unknown;
  error:       string | null;
  receivedAt:  number;
}

// Map<sessionId, SessionData>
const sessions = new Map<string, SessionData>();

// Pending commands: Map<sessionId, QueuedCommand[]>
const commandQueues = new Map<string, QueuedCommand[]>();

// Command results: Map<commandId, CommandResult>
const commandResults = new Map<string, CommandResult>();

const SESSION_TTL_MS = 10_000; // 10s — if no heartbeat, session is dead

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Create a new plugin session and return its ID. */
export function createSession(info: { placeId?: string; username?: string; placeName?: string } = {}): string {
  const sessionId = generateId();
  sessions.set(sessionId, {
    sessionId,
    placeId:   info.placeId   ?? null,
    username:  info.username  ?? null,
    placeName: info.placeName ?? null,
    connectedAt: Date.now(),
    lastSeen:    Date.now(),
  });
  commandQueues.set(sessionId, []);
  return sessionId;
}

/** Touch last-seen timestamp on heartbeat. Returns false if session not found. */
export function touchSession(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  if (s) { s.lastSeen = Date.now(); return true; }
  return false;
}

/** Enqueue a command for the plugin to execute on next heartbeat. */
export function enqueueCommand(sessionId: string, type: string, args: Record<string, unknown> = {}): string | null {
  const queue = commandQueues.get(sessionId);
  if (!queue) return null;
  const id = generateId();
  queue.push({ id, type, args });
  return id;
}

/** Dequeue all pending commands for a session (consumed on heartbeat). */
export function dequeueCommands(sessionId: string): QueuedCommand[] {
  const queue = commandQueues.get(sessionId) ?? [];
  commandQueues.set(sessionId, []);
  return queue;
}

/** Store a command result from the plugin. */
export function storeResult(commandId: string, result: unknown, error: string | null): void {
  commandResults.set(commandId, { result, error, receivedAt: Date.now() });
  // Auto-cleanup after 60s
  setTimeout(() => commandResults.delete(commandId), 60_000);
}

/** Get a command result by ID. */
export function getResult(commandId: string): CommandResult | null {
  return commandResults.get(commandId) ?? null;
}

/** Get all active sessions (heartbeat within TTL). */
export function getActiveSessions(): SessionData[] {
  const now = Date.now();
  const active: SessionData[] = [];
  for (const [, s] of sessions) {
    if (now - s.lastSeen <= SESSION_TTL_MS) {
      active.push(s);
    } else {
      sessions.delete(s.sessionId);
      commandQueues.delete(s.sessionId);
    }
  }
  return active;
}

/** Get a single session by ID. */
export function getSession(sessionId: string): SessionData | null {
  return sessions.get(sessionId) ?? null;
}
