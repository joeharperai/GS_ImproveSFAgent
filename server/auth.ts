import { randomBytes, createHash } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import type { User } from "@shared/schema";

// ====== PASSWORD HASHING (SHA-256 + salt, no native addon needed) ======

export function generateSalt(): string {
  return randomBytes(32).toString("hex");
}

export function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(salt + password).digest("hex");
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  return hashPassword(password, salt) === hash;
}

// ====== SESSION MANAGEMENT ======

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function createSessionToken(): string {
  return randomBytes(48).toString("hex");
}

export function createUserSession(userId: number) {
  // Clean up expired sessions periodically
  storage.deleteExpiredSessions();

  const token = createSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

  return storage.createSession({
    userId,
    token,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  });
}

// ====== AUTH MIDDLEWARE ======

// Extend Express Request to carry user info
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = authHeader.slice(7);
  const session = storage.getSessionByToken(token);

  if (!session) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  // Check expiration
  if (new Date(session.expiresAt) < new Date()) {
    storage.deleteSession(token);
    return res.status(401).json({ error: "Session expired" });
  }

  const user = storage.getUser(session.userId);
  if (!user) {
    storage.deleteSession(token);
    return res.status(401).json({ error: "User not found" });
  }

  req.user = user;
  next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const session = storage.getSessionByToken(token);
    if (session && new Date(session.expiresAt) >= new Date()) {
      const user = storage.getUser(session.userId);
      if (user) {
        req.user = user;
      }
    }
  }
  next();
}
