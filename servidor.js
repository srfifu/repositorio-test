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
/* Ruta al dist de React                                         */
/* ──────────────────────────────────────────────────────────── */
const DIST_DIR = path.join(__dirname, "dist");
const DIST_INDEX = path.join(DIST_DIR, "index.html");
const DIST_EXISTS = fs.existsSync(DIST_INDEX);

console.log("\n═══════════════════════════════════════════");
console.log("🚀 ARRANCANDO BACKEND CON PROXY");
console.log("═══════════════════════════════════════════\n");

/* ──────────────────────────────────────────────────────────── */
/* imansi en :4000                                               */
/* ──────────────────────────────────────────────────────────── */
const authApp = crearServidorAutenticacion({
  jwt: { secreto: process.env.JWT_SECRETO, expiracion: "15m" },
});
authApp.listen(4000, () => {
  console.log("🔒 [4000] Auth de imansi (interno)");
});

/* ──────────────────────────────────────────────────────────── */
/* Tu API en :4001                                               */
/* ──────────────────────────────────────────────────────────── */
const apiApp = express();

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

apiApp.listen(4001, () => {
  console.log("🔓 [4001] API (roles + library + frases + precios + usuarios + perfil) (interno)");
});

/* ──────────────────────────────────────────────────────────── */
/* Proxy público en :3000                                        */
/* ──────────────────────────────────────────────────────────── */
const proxy = express();

proxy.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  })
);

/* ──────────────────────────────────────────────────────────── */
/* 1. API → :4001                                                */
/* ──────────────────────────────────────────────────────────── */
proxy.use(
  createProxyMiddleware({
    pathFilter: "/api/**",
    target: "http://localhost:4001",
    changeOrigin: true,
  })
);

/* ──────────────────────────────────────────────────────────── */
/* 2. Rutas de auth de imansi → :4000                            */
/* ──────────────────────────────────────────────────────────── */
proxy.use(
  createProxyMiddleware({
    pathFilter: "/auth/**",
    target: "http://localhost:4000",
    changeOrigin: true,
  })
);

/* ──────────────────────────────────────────────────────────── */
/* 3. React (dist) con fallback SPA                              */
/* ──────────────────────────────────────────────────────────── */
if (DIST_EXISTS) {
  // Assets estáticos (JS, CSS, imágenes, fuentes…)
  proxy.use(
    express.static(DIST_DIR, {
      index: false,
      maxAge: "1y",
      immutable: true,
    })
  );

  // Fallback SPA — ✅ SIN "*" (compatible con Express 5)
  proxy.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api")) return next();
    if (req.path.startsWith("/auth")) return next();
    res.sendFile(DIST_INDEX);
  });

  console.log(`📦 Sirviendo React desde: ${DIST_DIR}`);
} else {
  console.log(`⚠️  No se encontró ${DIST_INDEX}`);
  console.log(`   El servidor NO servirá el frontend build.`);
  console.log(`   Corré "npm run build" en el frontend y copiá dist/ acá.`);
}

/* ──────────────────────────────────────────────────────────── */
/* 4. Fallback final → imansi :4000                              */
/* ──────────────────────────────────────────────────────────── */
proxy.use(
  createProxyMiddleware({
    target: "http://localhost:4000",
    changeOrigin: true,
  })
);

proxy.listen(3000, () => {
  console.log("\n═══════════════════════════════════════════");
  console.log("🚀 Servidor público en http://localhost:3000");
  console.log("   → /api/**    → :4001 (API)");
  console.log("   → /auth/**   → :4000 (imansi)");
  console.log("   → /*         → React dist (SPA)");
  console.log("═══════════════════════════════════════════\n");
});

/* ──────────────────────────────────────────────────────────── */
/* Cerrar pool al salir                                          */
/* ──────────────────────────────────────────────────────────── */
process.on("SIGINT", async () => {
  await cerrarPool();
  process.exit(0);
});