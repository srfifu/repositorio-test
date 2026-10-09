// backend/routes/usuariosDetallesRutas.js
import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";

import { requerirAutenticacion } from "imansi-auth-node";
import {
  obtenerDetalle,
  actualizarDetalle,
  actualizarPreferencias,
  actualizarNotificaciones,
  obtenerPerfilCompleto,
} from "../services/usuariosDetallesService.js";
import {
  subirAvatar,
  eliminarAvatar,
  obtenerRutaAvatar,
} from "../services/avatarService.js";
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
   GET /api/mi-perfil
   ============================================================ */
router.get("/", requerirAutenticacion(), async (req, res, next) => {
  try {
    const perfil = await obtenerPerfilCompleto(req.usuario.id);
    if (!perfil) return res.status(404).json({ mensaje: "Usuario no encontrado." });
    res.json({ perfil });
  } catch (e) { next(e); }
});

/* ============================================================
   GET /api/mi-perfil/detalle
   ============================================================ */
router.get("/detalle", requerirAutenticacion(), async (req, res, next) => {
  try {
    const detalle = await obtenerDetalle(req.usuario.id);
    res.json({ detalle });
  } catch (e) { next(e); }
});

/* ============================================================
   PATCH /api/mi-perfil
   ============================================================ */
router.patch("/", requerirAutenticacion(), async (req, res, next) => {
  try {
    const detalle = await actualizarDetalle(req.usuario.id, req.body);
    res.json({ ok: true, detalle });
  } catch (e) { next(e); }
});

/* ============================================================
   PATCH /api/mi-perfil/preferencias
   ============================================================ */
router.patch("/preferencias", requerirAutenticacion(), async (req, res, next) => {
  try {
    const detalle = await actualizarPreferencias(req.usuario.id, req.body);
    res.json({ ok: true, detalle });
  } catch (e) { next(e); }
});

/* ============================================================
   PATCH /api/mi-perfil/notificaciones
   ============================================================ */
router.patch("/notificaciones", requerirAutenticacion(), async (req, res, next) => {
  try {
    const detalle = await actualizarNotificaciones(req.usuario.id, req.body);
    res.json({ ok: true, detalle });
  } catch (e) { next(e); }
});

/* ============================================================
   POST /api/mi-perfil/avatar
   Sube/reemplaza el avatar (multipart/form-data)
   ============================================================ */
router.post(
  "/avatar",
  requerirAutenticacion(),
  upload.single("archivo"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ mensaje: "No se recibió ningún archivo." });
      }
      const resultado = await subirAvatar(req.usuario.id, req.file.buffer);
      res.status(201).json({ ok: true, avatar_url: resultado.avatar_url });
    } catch (e) {
      next(e);
    }
  }
);

/* ============================================================
   DELETE /api/mi-perfil/avatar
   ============================================================ */
router.delete("/avatar", requerirAutenticacion(), async (req, res, next) => {
  try {
    const ok = await eliminarAvatar(req.usuario.id);
    if (!ok) return res.status(404).json({ mensaje: "No hay avatar para eliminar." });
    res.status(204).end();
  } catch (e) { next(e); }
});

/* ============================================================
   GET /api/mi-perfil/avatar/:uuid
   Sirve la imagen del avatar (requiere sesión)
   ⚠️ NO usa cookie: cualquiera con la URL puede verla.
      Si querés restringirlo, usá una firma.
   ============================================================ */
router.get("/avatar/:uuid", async (req, res, next) => {
  try {
    const { uuid } = req.params;

    // Buscar el archivo en TODAS las carpetas de usuario
    // (porque la URL es absoluta y no sabemos a quién pertenece)
    const carpeta = path.join(ALMACENAMIENTO_RAIZ, "avatares");
    let encontrado = null;

    try {
      const usuarios = await fs.promises.readdir(carpeta);
      for (const u of usuarios) {
        const ruta = await (async () => {
          const fechas = await fs.promises.readdir(path.join(carpeta, u)).catch(() => []);
          for (const f of fechas) {
            const r = path.join(carpeta, u, f, `${uuid}.webp`);
            try {
              await fs.promises.access(r);
              return r;
            } catch { /* no existe */ }
          }
          return null;
        })();
        if (ruta) { encontrado = ruta; break; }
      }
    } catch { /* no existe la carpeta raíz */ }

    if (!encontrado) {
      return res.status(404).json({ mensaje: "Avatar no encontrado." });
    }

    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(encontrado).pipe(res);
  } catch (e) { next(e); }
});

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