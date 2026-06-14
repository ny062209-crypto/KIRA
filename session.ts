export interface UserSession {
  state: string;
  data: Record<string, unknown>;
  isAdmin: boolean;
  adminAttempts: number;
}

const sessions = new Map<string, UserSession>();

function makeKey(botToken: string, telegramId: string): string {
  return `${botToken}:${telegramId}`;
}

export function getSession(botToken: string, telegramId: string): UserSession {
  const key = makeKey(botToken, telegramId);
  if (!sessions.has(key)) {
    sessions.set(key, { state: "idle", data: {}, isAdmin: false, adminAttempts: 0 });
  }
  return sessions.get(key)!;
}

export function updateSession(
  botToken: string,
  telegramId: string,
  patch: Partial<UserSession>,
): void {
  const key = makeKey(botToken, telegramId);
  const current = getSession(botToken, telegramId);
  sessions.set(key, { ...current, ...patch });
}

export function setState(
  botToken: string,
  telegramId: string,
  state: string,
  data: Record<string, unknown> = {},
): void {
  const key = makeKey(botToken, telegramId);
  const current = getSession(botToken, telegramId);
  sessions.set(key, { ...current, state, data });
}

export function clearState(botToken: string, telegramId: string): void {
  const key = makeKey(botToken, telegramId);
  const current = getSession(botToken, telegramId);
  sessions.set(key, { ...current, state: "idle", data: {} });
}

export function revokeAdmin(botToken: string, telegramId: string): void {
  const key = makeKey(botToken, telegramId);
  const current = getSession(botToken, telegramId);
  sessions.set(key, { ...current, isAdmin: false, state: "idle", data: {} });
}
