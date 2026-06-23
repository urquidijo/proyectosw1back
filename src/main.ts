import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('api');

  app.enableCors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:5500', 'http://localhost:5500', 'null','https://master.d1c68gzv00j6uq.amplifyapp.com'],
    credentials: true,
    // Sin esto el navegador no deja leer este header desde fetch() en el
    // frontend (no está en la lista de headers "seguros" por defecto de CORS),
    // y el módulo de exportaciones lo necesita para nombrar el archivo descargado.
    exposedHeaders: ['Content-Disposition'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
