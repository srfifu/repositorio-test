// backend/routes/vendedorRutas.js
import { Router } from "express";
import { requerirAutenticacion } from "imansi-auth-node";
import { requiereRol } from "../middleware/requiereRol.js";
import { obtenerPool } from "../config/conexion.js";
import {
  listarUsuarios,
  crearUsuario,
  editarUsuario,
  cambiarContrasena,
  obtenerUsuarioPorId,
} from "../services/usuariosService.js";
import {
  obtenerDetalle,
  actualizarDetalle,
} from "../services/usuariosDetallesService.js";
import {
  obtenerConfigVendedor,
  actualizarConfigVendedor,
} from "../services/preciosService.js";

const router = Router();

/* ============================================================
   ⚠️ Todas las rutas requieren:
      1. requerirAutenticacion()  → valida la cookie
      2. requiereRol("vendedor")  → exige rol vendedor
   ============================================================ */

/* ============================================================
   GET /api/vendedor/clientes
   Lista SOLO los clientes referidos por el vendedor logueado.
   ============================================================ */
router.get(
  "/clientes",
  requerirAutenticacion(),
  requiereRol("vendedor"),
  async (req, res, next) => {
    try {
      const buscar = req.query.buscar || null;
      const limite = Math.min(Number(req.query.limite) || 200, 500);

      const clientes = await listarUsuarios({
        rol: "cliente",
        referidoPor: req.usuario.id,     // 👈 SOLO los suyos
        buscar,
        limite,
      });

      res.json({ clientes });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   GET /api/vendedor/clientes/stats
   KPIs básicos de SUS clientes.
   ============================================================ */
router.get(
  "/clientes/stats",
  requerirAutenticacion(),
  requiereRol("vendedor"),
  async (req, res, next) => {
    try {
      const pool = obtenerPool();
      const { rows } = await pool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE creado_en >= NOW() - INTERVAL '30 days') AS nuevos_mes
        FROM usuarios
        WHERE referido_por = $1
      `, [req.usuario.id]);

      res.json({
        stats: {
          total_clientes: Number(rows[0]?.total ?? 0),
          nuevos_mes: Number(rows[0]?.nuevos_mes ?? 0),
        },
      });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   POST /api/vendedor/clientes
   Crea un cliente referido por el vendedor logueado.
   Body: { correo, nombre, contrasena, nombre_tienda?, telefono? }
   ============================================================ */
router.post(
  "/clientes",
  requerirAutenticacion(),
  requiereRol("vendedor"),
  async (req, res, next) => {
    try {
      const { correo, nombre, contrasena, nombre_tienda, telefono } = req.body;

      if (!correo || !nombre || !contrasena) {
        return res.status(400).json({
          mensaje: "Faltan campos: correo, nombre y contrasena son obligatorios.",
        });
      }
      if (contrasena.length < 6) {
        return res.status(400).json({
          mensaje: "La contraseña debe tener al menos 6 caracteres.",
        });
      }

      // 🎯 El referido_por es SIEMPRE el vendedor logueado
      const usuario = await crearUsuario({
        correo,
        nombre,
        contrasena,
        rol: "cliente",
        referidoPor: req.usuario.id,     // 👈 se fuerza a este vendedor
        asignadoPor: req.usuario.id,
      });

      // Guardar el detalle extendido si viene
      if (nombre_tienda || telefono) {
        await actualizarDetalle(usuario.id, {
          nombre: nombre || null,
          nombre_tienda: nombre_tienda || null,
          telefono: telefono || null,
        });
      }

      const completo = await obtenerUsuarioPorId(usuario.id);
      res.status(201).json({ ok: true, cliente: completo });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   GET /api/vendedor/clientes/:id
   Ver un cliente del vendedor logueado.
   ============================================================ */
router.get(
  "/clientes/:id",
  requerirAutenticacion(),
  requiereRol("vendedor"),
  async (req, res, next) => {
    try {
      const usuario = await obtenerUsuarioPorId(req.params.id);
      if (!usuario) {
        return res.status(404).json({ mensaje: "Cliente no encontrado." });
      }
      // 🎯 Verificar que sea SU cliente
      if (usuario.referido_por !== req.usuario.id) {
        return res.status(403).json({ mensaje: "Este cliente no te pertenece." });
      }
      const detalle = await obtenerDetalle(usuario.id);
      res.json({ cliente: usuario, detalle });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   PATCH /api/vendedor/clientes/:id
   Edita un cliente del vendedor logueado.
   Body: { nombre?, correo?, nombre_tienda?, telefono?, ... }
   ============================================================ */
router.patch(
  "/clientes/:id",
  requerirAutenticacion(),
  requiereRol("vendedor"),
  async (req, res, next) => {
    try {
      // Verificar que sea SU cliente
      const actual = await obtenerUsuarioPorId(req.params.id);
      if (!actual) {
        return res.status(404).json({ mensaje: "Cliente no encontrado." });
      }
      if (actual.referido_por !== req.usuario.id) {
        return res.status(403).json({ mensaje: "Este cliente no te pertenece." });
      }

      // 1. Actualizar nombre/correo en `usuarios`
      const cambiosUsuario = {};
      if (req.body.nombre !== undefined) cambiosUsuario.nombre = req.body.nombre;
      if (req.body.correo !== undefined) cambiosUsuario.correo = req.body.correo;

      if (Object.keys(cambiosUsuario).length) {
        await editarUsuario(req.params.id, cambiosUsuario);
      }

      // 2. Actualizar detalles (nombre_tienda, telefono, direccion, etc.)
      const camposDetalle = [
        "nombre", "apellido", "nombre_tienda", "contacto",
        "sitio_web", "tax_id", "telefono",
        "direccion", "ciudad", "provincia", "codigo_postal", "pais",
      ];
      const cambiosDetalle = {};
      for (const k of camposDetalle) {
        if (req.body[k] !== undefined) cambiosDetalle[k] = req.body[k];
      }
      if (Object.keys(cambiosDetalle).length) {
        await actualizarDetalle(req.params.id, cambiosDetalle);
      }

      const completo = await obtenerUsuarioPorId(req.params.id);
      res.json({ ok: true, cliente: completo });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   PATCH /api/vendedor/clientes/:id/password
   Cambia la contraseña de un cliente del vendedor logueado.
   ============================================================ */
router.patch(
  "/clientes/:id/password",
  requerirAutenticacion(),
  requiereRol("vendedor"),
  async (req, res, next) => {
    try {
      const { contrasena } = req.body;
      if (!contrasena) {
        return res.status(400).json({ mensaje: "Falta 'contrasena'." });
      }

      // Verificar que sea SU cliente
      const actual = await obtenerUsuarioPorId(req.params.id);
      if (!actual) {
        return res.status(404).json({ mensaje: "Cliente no encontrado." });
      }
      if (actual.referido_por !== req.usuario.id) {
        return res.status(403).json({ mensaje: "Este cliente no te pertenece." });
      }

      await cambiarContrasena(req.params.id, contrasena);
      res.json({ ok: true });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   GET /api/vendedor/mis-precios
   Config de precios del vendedor (costo + venta + límites).
   ============================================================ */
router.get(
  "/mis-precios",
  requerirAutenticacion(),
  requiereRol("vendedor"),
  async (req, res, next) => {
    try {
      const config = await obtenerConfigVendedor(req.usuario.id);
      if (!config) {
        return res.status(404).json({
          mensaje: "Todavía no tenés config de precios. Contactá al administrador.",
        });
      }
      res.json({ config });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   PATCH /api/vendedor/mis-precios
   El vendedor actualiza SU precio de venta (dentro del máximo).
   Body: { venta_autoship_precio_por_rosa?, venta_onetime_precio_por_rosa?, ... }
   ============================================================ */
router.patch(
  "/mis-precios",
  requerirAutenticacion(),
  requiereRol("vendedor"),
  async (req, res, next) => {
    try {
      const configActual = await obtenerConfigVendedor(req.usuario.id);
      if (!configActual) {
        return res.status(404).json({
          mensaje: "Todavía no tenés config de precios. Contactá al administrador.",
        });
      }

      // 🎯 Solo puede editar los campos de VENTA
      const permitidos = [
        "venta_autoship_precio_por_rosa",
        "venta_onetime_precio_por_rosa",
        "venta_personalizacion_texto_precio",
        "venta_personalizacion_foto_precio",
      ];

      const cambios = {};
      const errores = [];

      for (const k of permitidos) {
        if (req.body[k] === undefined) continue;

        const valor = Number(req.body[k]);

        // Validar que sea un número positivo
        if (!Number.isFinite(valor) || valor <= 0) {
          errores.push(`${k}: debe ser un número positivo.`);
          continue;
        }

        // Validar contra el máximo permitido
        const campoMax = k.replace("venta_", "max_");
        const max = configActual[campoMax];

        if (max != null && valor > Number(max)) {
          errores.push(
            `${k}: el máximo permitido es $${Number(max).toFixed(2)}.`
          );
          continue;
        }

        // Validar que no sea menor al costo
        const campoCosto = k.replace("venta_", "costo_");
        const costo = configActual[campoCosto];

        if (costo != null && valor < Number(costo)) {
          errores.push(
            `${k}: no puede ser menor al costo ($${Number(costo).toFixed(2)}).`
          );
          continue;
        }

        cambios[k] = valor;
      }

      if (errores.length) {
        return res.status(400).json({
          mensaje: errores.join(" "),
          errores,
        });
      }

      if (!Object.keys(cambios).length) {
        return res.json({ ok: true, config: configActual, sinCambios: true });
      }

      const resultado = await actualizarConfigVendedor(
        req.usuario.id,
        cambios,
        req.usuario.id,
      );

      res.json({ ok: true, config: resultado.config, diff: resultado.diff });
    } catch (e) { next(e); }
  }
);

export default router;