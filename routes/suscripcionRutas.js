// backend/routes/suscripcionRutas.js
import { Router } from "express";
import { requerirAutenticacion } from "imansi-auth-node";
import { obtenerPool } from "../config/conexion.js";
import {
  obtenerSuscripcion,
  crearSuscripcion,
  actualizarSuscripcion,
  cambiarEstadoSuscripcion,
  saltarProximoEnvio,
  puedeIniciarAutoShip,
  listarEnviosAutoShip,
} from "../services/suscripcionServicio.js";

const router = Router();

/* ============================================================
   GET /api/mi-suscripcion
   Devuelve la suscripción del cliente + info para decidir si
   puede iniciar una nueva + envíos AutoShip.
   ============================================================ */
router.get("/", requerirAutenticacion(), async (req, res, next) => {
  try {
    const suscripcion = await obtenerSuscripcion(req.usuario.id);
    const check = await puedeIniciarAutoShip(req.usuario.id);
    const envios = await listarEnviosAutoShip(req.usuario.id, { limite: 100 });

    res.json({
      suscripcion,
      puedeIniciar: check.puede,
      razon: check.razon,
      envios,
    });
  } catch (e) { next(e); }
});

/* ============================================================
   POST /api/mi-suscripcion
   Crea la suscripción (si no existe).
   ============================================================ */
router.post("/", requerirAutenticacion(), async (req, res, next) => {
  try {
    const { plan, cajasPorMes, rosasPorMes, proximaFecha } = req.body;

    if (!cajasPorMes || cajasPorMes < 17) {
      return res.status(400).json({ mensaje: "AutoShip requiere mínimo 17 cajas." });
    }

    // Obtener vendedor referente
    const pool = obtenerPool();
    const { rows: userRows } = await pool.query(
      `SELECT referido_por FROM usuarios WHERE id = $1 LIMIT 1`,
      [req.usuario.id]
    );
    const vendedorId = userRows[0]?.referido_por || null;

    const suscripcion = await crearSuscripcion({
      usuarioId: req.usuario.id,
      vendedorId,
      plan,
      cajasPorMes,
      rosasPorMes: rosasPorMes || cajasPorMes * 6,
      proximaFecha,
    });

    res.status(201).json({ ok: true, suscripcion });
  } catch (e) {
    if (e.codigo === "SUSCRIPCION_YA_EXISTE") {
      return res.status(409).json({ mensaje: e.message, codigo: e.codigo });
    }
    next(e);
  }
});

/* ============================================================
   PATCH /api/mi-suscripcion
   Actualiza el plan o la próxima fecha.
   ============================================================ */
router.patch("/", requerirAutenticacion(), async (req, res, next) => {
  try {
    const { plan, cajasPorMes, rosasPorMes, proximaFecha } = req.body;
    const cambios = {};
    if (plan !== undefined) cambios.plan = plan;
    if (cajasPorMes !== undefined) cambios.cajas_por_mes = cajasPorMes;
    if (rosasPorMes !== undefined) cambios.rosas_por_mes = rosasPorMes;
    if (proximaFecha !== undefined) cambios.proxima_fecha = proximaFecha;

    const suscripcion = await actualizarSuscripcion(
      req.usuario.id,
      cambios,
      req.usuario.id
    );
    res.json({ ok: true, suscripcion });
  } catch (e) { next(e); }
});

/* ============================================================
   POST /api/mi-suscripcion/pausar
   ============================================================ */
router.post("/pausar", requerirAutenticacion(), async (req, res, next) => {
  try {
    const suscripcion = await cambiarEstadoSuscripcion(req.usuario.id, "paused");
    res.json({ ok: true, suscripcion });
  } catch (e) { next(e); }
});

/* ============================================================
   POST /api/mi-suscripcion/reactivar
   ============================================================ */
router.post("/reactivar", requerirAutenticacion(), async (req, res, next) => {
  try {
    const suscripcion = await cambiarEstadoSuscripcion(req.usuario.id, "active");
    res.json({ ok: true, suscripcion });
  } catch (e) { next(e); }
});

/* ============================================================
   POST /api/mi-suscripcion/cancelar
   ============================================================ */
router.post("/cancelar", requerirAutenticacion(), async (req, res, next) => {
  try {
    const suscripcion = await cambiarEstadoSuscripcion(req.usuario.id, "cancelled");
    res.json({ ok: true, suscripcion });
  } catch (e) { next(e); }
});

/* ============================================================
   POST /api/mi-suscripcion/saltar-envio
   ============================================================ */
router.post("/saltar-envio", requerirAutenticacion(), async (req, res, next) => {
  try {
    const suscripcion = await saltarProximoEnvio(req.usuario.id);
    res.json({ ok: true, suscripcion });
  } catch (e) { next(e); }
});

/* ============================================================
   GET /api/mi-suscripcion/puede-iniciar
   Solo devuelve si puede o no iniciar AutoShip.
   ============================================================ */
router.get("/puede-iniciar", requerirAutenticacion(), async (req, res, next) => {
  try {
    const check = await puedeIniciarAutoShip(req.usuario.id);
    res.json(check);
  } catch (e) { next(e); }
});

export default router;