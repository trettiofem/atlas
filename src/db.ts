import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import neo4j, { type Driver } from "neo4j-driver";

// Same .env that docker-compose.yml reads; variables already set in the environment win.
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export function connect(): Driver {
  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = process.env;

  if (NEO4J_URI === undefined || NEO4J_USERNAME === undefined || NEO4J_PASSWORD === undefined)
    throw new Error("The following environment label(s) have to be defined: NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD");

  return neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD));
}

export async function withDriver<T>(fn: (driver: ReturnType<typeof connect>) => Promise<T>): Promise<T> {
  const driver = connect();
  try {
    return await fn(driver);
  } finally {
    await driver.close();
  }
}