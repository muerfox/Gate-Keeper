import { PrismaClient } from "@gatekeeper/shared/prisma";

export function createDbClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

export type { PrismaClient };
