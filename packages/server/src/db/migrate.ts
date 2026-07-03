import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.REEL_DB_PATH ?? path.resolve(process.cwd(), "data/reel.db");
const migrationsFolder = path.resolve(__dirname, "../../drizzle");

runMigrations(dbPath, migrationsFolder);
console.log("Migrations applied successfully");
