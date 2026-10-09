// backend/routes/usuariosDetallesAdminRutas.js
import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";

import { requerirAutenticacion } from "imansi-auth-node";
import { requiereRol } from "../middleware/requiereRol.js";
import {
  obtenerDetalle,
  actualizarDetalle,
} from "../services/usuariosDetallesService.js";
import {
  subirAvatarAdmin,
  eliminarAvatarAdmin,
} from "../services/avatarService.js";
import { obtenerUsuarioPorId } from "../services/usuariosService.js";
import { ALMACENAMIENTO_RAIZ } from "../config/almacenamiento.js";

const router = Router();

// ────────────────────────────────────────────────────────────
// Multer
// ────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const permitidos = ["image/webp", "image/png", "image/jpeg"];
    if (!permitidos.includes(file.mimetype)) {
      return cb(new Error("Formato no permitido. Usá webp, png o jpg."));
    }
    cb(null, true);
  },
});

/* ============================================================
   ⚠️ ORDEN: rutas específicas ANTES que las que usan :id
   ============================================================ */

/* ============================================================
   GET /api/admin/usuarios/:id/detalle
   Ver el detalle completo de un usuario (admin)
   ============================================================ */
router.get(
  "/:id/detalle",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const usuario = await obtenerUsuarioPorId(req.params.id);
      if (!usuario) {
        return res.status(404).json({ mensaje: "Usuario no encontrado." });
      }
      const detalle = await obtenerDetalle(req.params.id);
      res.json({ usuario, detalle });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   PATCH /api/admin/usuarios/:id/detalle
   Actualizar el detalle de un usuario (admin)
   Body: { nombre, apellido, nombre_tienda, ... }
   ============================================================ */
router.patch(
  "/:id/detalle",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const detalle = await actualizarDetalle(req.params.id, req.body);
      res.json({ ok: true, detalle });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   POST /api/admin/usuarios/:id/avatar
   Subir/reemplazar el avatar de un usuario (admin)
   ============================================================ */
router.post(
  "/:id/avatar",
  requerirAutenticacion(),
  requiereRol("admin"),
  upload.single("archivo"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ mensaje: "No se recibió ningún archivo." });
      }
      const resultado = await subirAvatarAdmin(req.params.id, req.file.buffer);
      res.status(201).json({ ok: true, avatar_url: resultado.avatar_url });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   DELETE /api/admin/usuarios/:id/avatar
   Eliminar el avatar de un usuario (admin)
   ============================================================ */
router.delete(
  "/:id/avatar",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const ok = await eliminarAvatarAdmin(req.params.id);
      if (!ok) return res.status(404).json({ mensaje: "No hay avatar para eliminar." });
      res.status(204).end();
    } catch (e) { next(e); }
  }
);

/* ============================================================
   GET /api/admin/usuarios/:id/avatar/:uuid
   Servir el avatar de un usuario específico (admin)
   ============================================================ */
router.get(
  "/:id/avatar/:uuid",
  async (req, res, next) => {
    try {
      const { id, uuid } = req.params;
      const carpeta = path.join(ALMACENAMIENTO_RAIZ, "avatares", id);

      const fechas = await fs.promises.readdir(carpeta).catch(() => []);
      let encontrado = null;
      for (const f of fechas) {
        const ruta = path.join(carpeta, f, `${uuid}.webp`);
        try {
          await fs.promises.access(ruta);
          encontrado = ruta;
          break;
        } catch { /* no existe */ }
      }

      if (!encontrado) {
        return res.status(404).json({ mensaje: "Avatar no encontrado." });
      }

      res.setHeader("Content-Type", "image/webp");
      res.setHeader("Cache-Control", "public, max-age=86400");
      fs.createReadStream(encontrado).pipe(res);
    } catch (e) { next(e); }
  }
);

/* ============================================================
   Manejador de errores de multer
   ============================================================ */
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ mensaje: "El archivo supera el límite de 5 MB." });
    }
    return res.status(400).json({ mensaje: err.message });
  }
  if (err) return res.status(err.estado || 500).json({ mensaje: err.message });
  next();
});

export default router;