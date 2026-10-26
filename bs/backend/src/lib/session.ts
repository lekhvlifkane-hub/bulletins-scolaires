import type { Request } from 'express';
import { prisma } from '../db/prisma';

export function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function deleteSessions(where: string, values: unknown[]): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "session" WHERE ${where}`,
      ...values,
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== '42P01') {
      throw error;
    }
  }
}

export async function destroyAllSessions(userId: string): Promise<void> {
  await deleteSessions("(sess->>'userId') = $1", [userId]);
}

export async function destroyOtherSessions(
  userId: string,
  currentSessionId: string,
): Promise<void> {
  await deleteSessions("(sess->>'userId') = $1 AND sid <> $2", [
    userId,
    currentSessionId,
  ]);
}
