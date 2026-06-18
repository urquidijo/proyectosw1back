import { PrismaClient, PlanType } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import * as process from 'process';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = 'super@admin.com';
  const plainPassword = 'pass123';

  // Hashear contraseña como lo hace el AuthService
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(plainPassword, salt);

  // Intentar encontrar si ya existe
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    console.log(`El usuario ${email} ya existe. Actualizando contraseña y rol...`);
    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        passwordHash: hashedPassword,
        role: 'SUPERADMIN',
      },
    });
    console.log('Usuario SuperAdmin actualizado correctamente.');
  } else {
    console.log(`Creando el usuario SuperAdmin ${email}...`);
    await prisma.user.create({
      data: {
        name: 'Super Administrador',
        email,
        passwordHash: hashedPassword,
        role: 'SUPERADMIN',
      },
    });
    console.log('Usuario SuperAdmin creado correctamente.');
  }

  // --- Planes de Suscripción ---
  console.log('Creando planes de suscripción...');

  await prisma.subscriptionPlan.upsert({
    where: { name: 'Starter' },
    update: {
      maxProjects: 3,
      maxWorkspaces: 0,
      apiCostPer1kRows: null,
      price: 0
    },
    create: {
      name: 'Starter',
      type: PlanType.INDIVIDUAL,
      price: 0,
      maxProjects: 3,
      maxWorkspaces: 0,
      maxUsersPerWorkspace: 0,
      maxGenerationsPerMonth: 5,
      isActive: true,
    },
  });

  await prisma.subscriptionPlan.upsert({
    where: { name: 'Developer Pro' },
    update: {
      maxProjects: 15,
      maxWorkspaces: 0,
      apiCostPer1kRows: 0.50,
      price: 12.00
    },
    create: {
      name: 'Developer Pro',
      type: PlanType.INDIVIDUAL,
      price: 12.00,
      maxProjects: 15,
      maxWorkspaces: 0,
      maxUsersPerWorkspace: 0,
      maxGenerationsPerMonth: 50,
      apiCostPer1kRows: 0.50,
      isActive: true,
    },
  });

  await prisma.subscriptionPlan.upsert({
    where: { name: 'Team Premium' },
    update: {
      maxProjects: 100,
      maxWorkspaces: 5,
      maxUsersPerWorkspace: 10,
      apiCostPer1kRows: 0.40,
      price: 39.00
    },
    create: {
      name: 'Team Premium',
      type: PlanType.GROUP,
      price: 39.00,
      maxProjects: 100,
      maxWorkspaces: 5,
      maxUsersPerWorkspace: 10,
      maxGenerationsPerMonth: 500,
      apiCostPer1kRows: 0.40,
      isActive: true,
    },
  });

  await prisma.subscriptionPlan.upsert({
    where: { name: 'Enterprise Scale' },
    update: {
      maxProjects: 999,
      maxWorkspaces: 999,
      maxUsersPerWorkspace: 999,
      apiCostPer1kRows: 0.20,
      price: 149.00
    },
    create: {
      name: 'Enterprise Scale',
      type: PlanType.GROUP,
      price: 149.00,
      maxProjects: 999,
      maxWorkspaces: 999,
      maxUsersPerWorkspace: 999,
      maxGenerationsPerMonth: 9999,
      apiCostPer1kRows: 0.20,
      isActive: true,
    },
  });

  console.log('Planes creados correctamente.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
