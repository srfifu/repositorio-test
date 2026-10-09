import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

let pool = null;

function limpiarHost(host) {
  return String(host || "localhost")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

function debeUsarSSL(host) {
  const valor = String(process.env.PG_SSL ?? "").trim().toLowerCase();

  // Si lo definís explícitamente, se respeta
  if (["true", "1", "require", "yes"].includes(valor)) return true;
  if (["false", "0", "no"].includes(valor)) return false;

  // Si no está definido: SSL para hosts remotos, sin SSL para local
  return !["localhost", "127.0.0.1", "::1"].includes(host);
}

export function obtenerPool() {
  if (!pool) {
    const host = limpiarHost(process.env.PG_HOST);
    const ssl = debeUsarSSL(host);

    pool = new Pool({
      host,
      port: Number(process.env.PG_PUERTO) || 5432,
      user: process.env.PG_USUARIO || "postgres",
      password: process.env.PG_CONTRASENA,
      database: process.env.PG_BASE_DE_DATOS || "florist-portal",
      ssl: ssl ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on("error", (err) => {
      console.error("❌ Error inesperado en el pool de PostgreSQL:", err);
    });

    console.log(`🐘 Pool de PostgreSQL creado (host: ${host}, ssl: ${ssl})`);
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

process.on("SIGINT", async () => {
  await cerrarPool();
  process.exit(0);
});