import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createProxyMiddleware } from "http-proxy-middleware";
import { crearServidorAutenticacion } from "imansi-auth-node";
import rolesRutas from "./routes/rolesRutas.js";
import libraryRutas from "./routes/libraryRutas.js";
import frasesRutas from "./routes/frasesRutas.js";
import preciosRutas from "./routes/preciosRutas.js";
import vendedoresRutas from "./routes/vendedoresRutas.js";
import usuariosRutas from "./routes/usuariosRutas.js";
import usuariosDetallesRutas from "./routes/usuariosDetallesRutas.js";
import usuariosDetallesAdminRutas from "./routes/usuariosDetallesAdminRutas.js";
import vendedorRutas from "./routes/vendedorRutas.js";
import catalogoClienteRutas from "./routes/catalogoClienteRutas.js";
import buildClienteRutas from "./routes/buildClienteRutas.js";
import pagosRutas from "./routes/pagosRutas.js";
import pedidosClienteRutas from "./routes/pedidosClienteRutas.js";
import suscripcionRutas from "./routes/suscripcionRutas.js";
import facturasRutas from "./routes/facturasRutas.js";
import adminPedidosRutas from "./routes/adminPedidosRutas.js";
import adminSuscripcionesRutas from "./routes/adminSuscripcionesRutas.js";
import vendedorPedidosRutas from "./routes/vendedorPedidosRutas.js";
import vendedorDashboardRutas from "./routes/vendedorDashboardRutas.js";
import adminDashboardRutas from "./routes/adminDashboardRutas.js";
import adminActividadRutas from "./routes/adminActividadRutas.js";

import { cerrarPool } from "./config/conexion.js";

/* ──────────────────────────────────────────────────────────── */
/* __dirname en ESM                                              */
/* ──────────────────────────────────────────────────────────── */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ──────────────────────────────────────────────────────────── */
/* Puertos dinámicos (Render asigna PORT)                        */
/* ──────────────────────────────────────────────────────────── */
const PUBLIC_PORT = process.env.PORT || 3000;
const AUTH_PORT   = process.env.AUTH_PORT || 4000;
const API_PORT    = process.env.API_PORT  || 4001;

/* ──────────────────────────────────────────────────────────── */
/* Ruta al dist de React                                         */
/* ──────────────────────────────────────────────────────────── */
const DIST_DIR = path.join(__dirname, "dist");
const DIST_INDEX = path.join(DIST_DIR, "index.html");
const DIST_EXISTS = fs.existsSync(DIST_INDEX);

console.log("\n═══════════════════════════════════════════");
console.log("🚀 ARRANCANDO BACKEND CON PROXY");
console.log("═══════════════════════════════════════════");
console.log(`   Puerto público: ${PUBLIC_PORT}`);
console.log(`   Auth interno:   ${AUTH_PORT}`);
console.log(`   API interna:    ${API_PORT}\n`);

/* ──────────────────────────────────────────────────────────── */
/* imansi en :AUTH_PORT                                          */
/* ──────────────────────────────────────────────────────────── */
const authApp = crearServidorAutenticacion({
  jwt: { secreto: process.env.JWT_SECRETO, expiracion: "15m" },
});

// ✅ FIX: confiar en el proxy de Render (1 salto)
authApp.set("trust proxy", 1);

authApp.listen(AUTH_PORT, () => {
  console.log(`🔒 [${AUTH_PORT}] Auth de imansi (interno)`);
});

/* ──────────────────────────────────────────────────────────── */
/* Tu API en :API_PORT                                           */
/* ──────────────────────────────────────────────────────────── */
const apiApp = express();

// ✅ FIX: confiar en el proxy de Render
apiApp.set("trust proxy", 1);

apiApp.use(express.json({ limit: "10mb" }));
apiApp.use(express.urlencoded({ extended: true, limit: "10mb" }));
apiApp.use(cookieParser());

apiApp.use("/api/roles", rolesRutas);
apiApp.use("/api/library", libraryRutas);
apiApp.use("/api/frases", frasesRutas);
apiApp.use("/api/precios", preciosRutas);
apiApp.use("/api/vendedores", vendedoresRutas);
apiApp.use("/api/usuarios", usuariosRutas);
apiApp.use("/api/mi-perfil", usuariosDetallesRutas);
apiApp.use("/api/admin/usuarios", usuariosDetallesAdminRutas);
apiApp.use("/api/vendedor", vendedorRutas);
apiApp.use("/api/catalogo", catalogoClienteRutas);
apiApp.use("/api/build", buildClienteRutas);
apiApp.use("/api/pagos", pagosRutas);
apiApp.use("/api/mis-pedidos", pedidosClienteRutas);
apiApp.use("/api/mi-suscripcion", suscripcionRutas);
apiApp.use("/api", facturasRutas);
apiApp.use("/api/admin", adminPedidosRutas);
apiApp.use("/api/admin", adminSuscripcionesRutas);
apiApp.use("/api/vendedor", vendedorPedidosRutas);
apiApp.use("/api/vendedor", vendedorDashboardRutas);
apiApp.use("/api/admin", adminDashboardRutas);
apiApp.use("/api/admin", adminActividadRutas);

apiApp.listen(API_PORT, () => {
  console.log(`🔓 [${API_PORT}] API interna`);
});

/* ──────────────────────────────────────────────────────────── */
/* Proxy público en :PUBLIC_PORT                                 */
/* ──────────────────────────────────────────────────────────── */
const proxy = express();

// ✅ FIX: confiar en el proxy de Render
proxy.set("trust proxy", 1);

proxy.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      process.env.CORS_ORIGIN,
    ].filter(Boolean),
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  })
);

/* ── 1. API → :API_PORT ── */
proxy.use(
  createProxyMiddleware({
    pathFilter: "/api/**",
    target: `http://localhost:${API_PORT}`,
    changeOrigin: true,
  })
);

/* ── 2. Auth → :AUTH_PORT ── */
proxy.use(
  createProxyMiddleware({
    pathFilter: "/auth/**",
    target: `http://localhost:${AUTH_PORT}`,
    changeOrigin: true,
  })
);

/* ── 3. React (dist) + SPA fallback ── */
if (DIST_EXISTS) {
  proxy.use(
    express.static(DIST_DIR, {
      index: false,
      maxAge: "1y",
      immutable: true,
    })
  );

  proxy.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api")) return next();
    if (req.path.startsWith("/auth")) return next();
    res.sendFile(DIST_INDEX);
  });

  console.log(`📦 Sirviendo React desde: ${DIST_DIR}`);
} else {
  console.log(`⚠️  No se encontró ${DIST_INDEX}`);
}

/* ── 4. Fallback → :AUTH_PORT ── */
proxy.use(
  createProxyMiddleware({
    target: `http://localhost:${AUTH_PORT}`,
    changeOrigin: true,
  })
);

proxy.listen(PUBLIC_PORT, () => {
  console.log("\n═══════════════════════════════════════════");
  console.log(`🚀 Servidor público en puerto ${PUBLIC_PORT}`);
  console.log(`   → /api/**    → :${API_PORT} (API)`);
  console.log(`   → /auth/**   → :${AUTH_PORT} (imansi)`);
  console.log(`   → /*         → React dist (SPA)`);
  console.log("═══════════════════════════════════════════\n");
});

process.on("SIGINT", async () => {
  await cerrarPool();
  process.exit(0);
});