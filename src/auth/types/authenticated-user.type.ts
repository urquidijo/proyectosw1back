import { UserRole } from "src/generated/prisma/enums";

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: UserRole;
};