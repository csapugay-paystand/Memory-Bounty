import crypto from "node:crypto";

// Hashes a plaintext password using HMAC-SHA256 with a random salt
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .createHmac("sha256", salt)
    .update(password)
    .digest("hex");
  return `${salt}:${hash}`;
}

// Verifies a plaintext password against a stored salt:hash pair
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto
    .createHmac("sha256", salt)
    .update(password)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(candidate, "hex")
  );
}

// Generates a signed session token containing userId and expiry timestamp
export function generateToken(userId: string, expiresInMs: number): string {
  const payload = JSON.stringify({ userId, exp: Date.now() + expiresInMs });
  const signature = crypto
    .createHmac("sha256", process.env["TOKEN_SECRET"] ?? "dev-secret")
    .update(payload)
    .digest("hex");
  return `${Buffer.from(payload).toString("base64")}.${signature}`;
}

// Parses and validates a session token; returns the userId payload or null if invalid or expired
export function validateToken(token: string): { userId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts as [string, string];
  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64").toString()
  ) as { userId: string; exp: number };
  const expected = crypto
    .createHmac("sha256", process.env["TOKEN_SECRET"] ?? "dev-secret")
    .update(JSON.stringify(payload))
    .digest("hex");
  if (expected !== signature) return null;
  if (payload.exp < Date.now()) return null;
  return { userId: payload.userId };
}

// Manages user authentication sessions: login, logout, and token refresh
export class AuthService {
  private activeSessions = new Map<string, string>();

  async login(
    userId: string,
    password: string,
    storedHash: string
  ): Promise<string | null> {
    const valid = await verifyPassword(password, storedHash);
    if (!valid) return null;
    const token = generateToken(userId, 3600 * 1000);
    this.activeSessions.set(userId, token);
    return token;
  }

  logout(userId: string): void {
    this.activeSessions.delete(userId);
  }

  refreshToken(userId: string): string | null {
    if (!this.activeSessions.has(userId)) return null;
    const token = generateToken(userId, 3600 * 1000);
    this.activeSessions.set(userId, token);
    return token;
  }
}
