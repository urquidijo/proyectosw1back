import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import * as process from 'process';

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
