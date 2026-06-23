FROM node:22-alpine

WORKDIR /app

# bcrypt tiene un binding nativo; estas herramientas permiten compilarlo si
# no hay un binario prebuilt para esta combinación de arquitectura/musl.
RUN apk add --no-cache python3 make g++

COPY package*.json ./
COPY prisma ./prisma

RUN npm ci

COPY . .

# El cliente de Prisma se genera dentro de src/generated/prisma (ver
# generator client en prisma/schema.prisma) y `nest build` lo compila junto
# con el resto de src/, así que debe existir ANTES del build de TypeScript.
RUN npx prisma generate

RUN npm run build

EXPOSE 4000

# `prisma migrate deploy` aplica las migraciones ya commiteadas en
# prisma/migrations contra la base de datos que indique DATABASE_URL en ese
# momento (la de Docker Compose, Railway, o cualquier otra) y luego arranca
# la API compilada. Ningún paso de este Dockerfile depende de en qué entorno
# se ejecute: todo lo específico del entorno llega por variables de entorno.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
