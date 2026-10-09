// backend/routes/vendedoresRutas.js
import { Router } from "express";
import { requerirAutenticacion } from "imansi-auth-node";
import { requiereRol } from "../middleware/requiereRol.js";
import {
  listarVendedores,
  buscarUsuariosParaPromover,
  crearVendedor,
  promoverAVendedor,
  quitarRolVendedor,
  obtenerUsuarioPorId,
  editarUsuario,
  cambiarContrasena,
} from "../services/usuariosService.js";

const router = Router();

/* ============================================================
   GET /api/vendedores
   Lista todos los vendedores (solo admin).
   ============================================================ */
router.get(
  "/",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const buscar = req.query.buscar || null;
      const vendedores = await listarVendedores({ buscar });
      res.json({ vendedores });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   GET /api/vendedores/buscar-usuarios?q=...
   Busca usuarios que NO son vendedores, para promover.
   ⚠️ DEBE ir antes de /:id
   ============================================================ */
router.get(
  "/buscar-usuarios",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const buscar = req.query.q || null;
      const usuarios = await buscarUsuariosParaPromover({ buscar });
      res.json({ usuarios });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   POST /api/vendedores
   Crear vendedor nuevo (correo + nombre + contraseña).
   ============================================================ */
router.post(
  "/",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const { correo, nombre, contrasena, nombreComercial } = req.body;
      if (!correo || !nombre || !contrasena) {
        return res.status(400).json({ mensaje: "Faltan campos: correo, nombre, contrasena." });
      }

      const vendedor = await crearVendedor({
        correo,
        nombre,
        contrasena,
        nombreComercial: nombreComercial || null,
        asignadoPor: req.usuario.id,
      });

      res.status(201).json({ ok: true, vendedor });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   POST /api/vendedores/promover/:usuarioId
   Promover usuario existente a vendedor.
   ============================================================ */
router.post(
  "/promover/:usuarioId",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const vendedor = await promoverAVendedor(req.params.usuarioId, req.usuario.id);
      res.json({ ok: true, vendedor });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   GET /api/vendedores/:id
   Detalle de un vendedor.
   ============================================================ */
router.get(
  "/:id",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const vendedor = await obtenerUsuarioPorId(req.params.id);
      if (!vendedor) return res.status(404).json({ mensaje: "Vendedor no encontrado." });
      res.json({ vendedor });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   PATCH /api/vendedores/:id
   Editar nombre / correo del vendedor.
   ============================================================ */
router.patch(
  "/:id",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const cambios = {};
      if (req.body.nombre !== undefined) cambios.nombre = req.body.nombre;
      if (req.body.correo !== undefined) cambios.correo = req.body.correo;

      const usuario = await editarUsuario(req.params.id, cambios);
      if (!usuario) return res.status(404).json({ mensaje: "Vendedor no encontrado." });
      res.json({ ok: true, vendedor: usuario });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   PATCH /api/vendedores/:id/password
   Cambiar la contraseña del vendedor.
   ============================================================ */
router.patch(
  "/:id/password",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const { contrasena } = req.body;
      if (!contrasena) {
        return res.status(400).json({ mensaje: "Falta el campo 'contrasena'." });
      }
      const ok = await cambiarContrasena(req.params.id, contrasena);
      if (!ok) return res.status(404).json({ mensaje: "Vendedor no encontrado." });
      res.json({ ok: true });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   DELETE /api/vendedores/:id
   Quitar el rol vendedor (soft delete: no borra el usuario).
   ============================================================ */
router.delete(
  "/:id",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const ok = await quitarRolVendedor(req.params.id);
      if (!ok) return res.status(404).json({ mensaje: "Vendedor no encontrado." });
      res.status(204).end();
    } catch (e) { next(e); }
  }
);

export default router;