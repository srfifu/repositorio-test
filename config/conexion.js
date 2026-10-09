import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

let pool = null;

export function obtenerPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.PG_HOST || "localhost",
      port: Number(process.env.PG_PUERTO) || 5432,
      user: process.env.PG_USUARIO || "postgres",
      password: process.env.PG_CONTRASENA,
      database: process.env.PG_BASE_DE_DATOS || "florist-portal",
      ssl: process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on("error", (err) => {
      console.error("❌ Error inesperado en el pool de PostgreSQL:", err);
    });

    console.log("🐘 Pool de PostgreSQL creado");
  }
  return pool;
}

export async function cerrarPool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log("🔌 Pool de PostgreSQL cerrado");
  }
}

// Cerrar el pool al terminar el proceso
process.on("SIGINT", async () => {
  await cerrarPool();
  process.exit(0);
});