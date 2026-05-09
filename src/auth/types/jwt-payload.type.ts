import { UserRole } from "src/generated/prisma/enums";

export type JwtPayload = {
  sub: string;
  email: string;
  role: UserRole;
};