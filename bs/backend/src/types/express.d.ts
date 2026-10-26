import type { School, User } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      currentUser?: User;
      currentSchool?: School | null;
      schoolScopeId?: string;
    }
  }
}

export {};
