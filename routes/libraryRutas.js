// backend/routes/libraryRutas.js
import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";

import { requerirAutenticacion } from "imansi-auth-node";
import { requiereRol } from "../middleware/requiereRol.js";
import { obtenerPool } from "../config/conexion.js";
import {
  ALMACENAMIENTO_RAIZ,
  TIPOS_PERMITIDOS,
  FORMATOS_PERMITIDOS,
  TAMANO_MAX_BYTES,
} from "../config/almacenamiento.js";
import {
  subirImagen,
  subirImagenFrase,
  listarSlots,
  obtenerImagenPorUuid,
  desactivarImagen,
  guardarPrintArea,
  listarPrintAreas,
  crearColor,
  editarColor,
  desactivarColor,
  listarCategoriasConFrases,
  crearCategoria,
  editarCategoria,
  desactivarCategoria,
  crearFrase,
  editarFrase,
  desactivarFrase,
  slugify,
} from "../services/libraryService.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!FORMATOS_PERMITIDOS.includes(file.mimetype)) {
      return cb(new Error("Formato no permitido. Usá webp, png o jpg."));
    }
    cb(null, true);
  },
});

/* ============================================================
   META / PRINT AREAS / FILE
   ============================================================ */
router.get("/meta", requerirAutenticacion(), async (req, res, next) => {
  try { res.json({ colores: await listarSlots() }); } catch (e) { next(e); }
});

router.get("/print-areas", requerirAutenticacion(), async (req, res, next) => {
  try { res.json({ printAreas: await listarPrintAreas() }); } catch (e) { next(e); }
});

router.get("/file/:uuid", async (req, res, next) => {
  try {
    const imagen = await obtenerImagenPorUuid(req.params.uuid);
    if (!imagen) return res.status(404).json({ mensaje: "Imagen no encontrada." });

    const rutaAbs = path.join(ALMACENAMIENTO_RAIZ, imagen.ruta_relativa);
    if (!fs.existsSync(rutaAbs)) {
      return res.status(404).json({ mensaje: "Archivo no encontrado en disco." });
    }

    res.setHeader("Content-Type", imagen.mime_type || "image/webp");
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(rutaAbs).pipe(res);
  } catch (e) { next(e); }
});

/* ============================================================
   UPLOAD
   ============================================================ */
router.post(
  "/upload",
  requerirAutenticacion(),
  requiereRol("admin"),
  upload.single("archivo"),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ mensaje: "No se recibió archivo." });

      const { tipo, colorId, fraseId } = req.body;
      if (!tipo) return res.status(400).json({ mensaje: "Falta 'tipo'." });
      if (!TIPOS_PERMITIDOS.includes(tipo)) {
        return res.status(400).json({ mensaje: `Tipo inválido.` });
      }

      const pool = obtenerPool();

      if (tipo === "frasephoto") {
        if (!fraseId) return res.status(400).json({ mensaje: "Falta 'fraseId'." });
        if (!colorId) return res.status(400).json({ mensaje: "Falta 'colorId'." });

        const { rows: fraseRows } = await pool.query(
          `SELECT f.id, f.slug, c.slug AS categoria_slug
           FROM catalogo_frases f
           INNER JOIN catalogo_categorias c ON c.id = f.categoria_id
           WHERE f.id = $1 AND f.activo = TRUE`,
          [fraseId]
        );
        if (!fraseRows[0]) return res.status(404).json({ mensaje: "Frase no encontrada." });

        const { rows: colorRows } = await pool.query(
          `SELECT id, slug FROM catalogo_colores WHERE id = $1 AND activo = TRUE`,
          [colorId]
        );
        if (!colorRows[0]) return res.status(404).json({ mensaje: "Color no encontrado." });

        const imagen = await subirImagenFrase({
          buffer: req.file.buffer,
          nombreOriginal: req.file.originalname,
          fraseId,
          fraseSlug: fraseRows[0].slug,
          categoriaSlug: fraseRows[0].categoria_slug,
          colorId,
          colorSlug: colorRows[0].slug,
          subidoPor: req.usuario.id,
        });
        return res.status(201).json({ ok: true, imagen });
      }

      if (!colorId) return res.status(400).json({ mensaje: "Falta 'colorId'." });

      const { rows: colorRows } = await pool.query(
        `SELECT id, slug FROM catalogo_colores WHERE id = $1 AND activo = TRUE`,
        [colorId]
      );
      if (!colorRows[0]) return res.status(404).json({ mensaje: "Color no encontrado." });

      const imagen = await subirImagen({
        buffer: req.file.buffer,
        nombreOriginal: req.file.originalname,
        tipo,
        colorId,
        colorSlug: colorRows[0].slug,
        subidoPor: req.usuario.id,
      });
      res.status(201).json({ ok: true, imagen });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   DELETE imagen por slotId
   ============================================================ */
router.delete(
  "/:slotId",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const ok = await desactivarImagen(req.params.slotId);
      if (!ok) return res.status(404).json({ mensaje: "No hay imagen activa." });
      res.status(204).end();
    } catch (e) { next(e); }
  }
);

/* ============================================================
   PRINT AREA
   ============================================================ */
router.post(
  "/print-area/:colorId",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const { x, y, w, h } = req.body;
      if ([x, y, w, h].some((v) => typeof v !== "number")) {
        return res.status(400).json({ mensaje: "x, y, w, h deben ser números." });
      }
      const area = await guardarPrintArea(req.params.colorId, { x, y, w, h });
      res.json({ ok: true, printArea: area });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   COLORS
   ============================================================ */
router.post(
  "/colors",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const { codigo, nombre, slug, hex, edge, ink, orden } = req.body;
      if (!codigo || !nombre || !slug || !hex || !edge || !ink) {
        return res.status(400).json({ mensaje: "Faltan campos." });
      }
      const color = await crearColor({ codigo, nombre, slug, hex, edge, ink, orden });
      res.status(201).json({ ok: true, color });
    } catch (e) {
      if (e.code === "23505") return res.status(409).json({ mensaje: "Código o slug duplicado." });
      next(e);
    }
  }
);

router.patch(
  "/colors/:id",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const color = await editarColor(req.params.id, req.body);
      if (!color) return res.status(404).json({ mensaje: "Color no encontrado." });
      res.json({ ok: true, color });
    } catch (e) {
      if (e.code === "23505") return res.status(409).json({ mensaje: "Código o slug duplicado." });
      next(e);
    }
  }
);

router.delete(
  "/colors/:id",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const ok = await desactivarColor(req.params.id);
      if (!ok) return res.status(404).json({ mensaje: "Color no encontrado." });
      res.status(204).end();
    } catch (e) { next(e); }
  }
);

/* ============================================================
   CATEGORÍAS + FRASES
   ============================================================ */
router.get("/categorias", requerirAutenticacion(), async (req, res, next) => {
  try {
    res.json({ categorias: await listarCategoriasConFrases() });
  } catch (e) { next(e); }
});

router.post(
  "/categorias",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const { nombre_es, nombre_en, orden } = req.body;
      if (!nombre_es || !nombre_en) {
        return res.status(400).json({ mensaje: "Faltan nombre_es o nombre_en." });
      }
      const slug = slugify(nombre_en);
      const categoria = await crearCategoria({ nombre_es, nombre_en, slug, orden });
      res.status(201).json({ ok: true, categoria });
    } catch (e) {
      if (e.code === "23505") return res.status(409).json({ mensaje: "Categoría duplicada." });
      next(e);
    }
  }
);

router.patch(
  "/categorias/:id",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const categoria = await editarCategoria(req.params.id, req.body);
      if (!categoria) return res.status(404).json({ mensaje: "Categoría no encontrada." });
      res.json({ ok: true, categoria });
    } catch (e) {
      if (e.code === "23505") return res.status(409).json({ mensaje: "Slug duplicado." });
      next(e);
    }
  }
);

router.delete(
  "/categorias/:id",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const ok = await desactivarCategoria(req.params.id);
      if (!ok) return res.status(404).json({ mensaje: "Categoría no encontrada." });
      res.status(204).end();
    } catch (e) { next(e); }
  }
);

router.post(
  "/frases",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const { categoria_id, texto, orden } = req.body;
      if (!categoria_id || !texto) {
        return res.status(400).json({ mensaje: "Faltan categoria_id o texto." });
      }
      const slug = slugify(texto);
      const frase = await crearFrase({ categoria_id, texto, slug, orden });
      res.status(201).json({ ok: true, frase });
    } catch (e) {
      if (e.code === "23505") return res.status(409).json({ mensaje: "Frase duplicada." });
      next(e);
    }
  }
);

router.patch(
  "/frases/:id",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const cambios = { ...req.body };
      if (cambios.texto && !cambios.slug) cambios.slug = slugify(cambios.texto);
      const frase = await editarFrase(req.params.id, cambios);
      if (!frase) return res.status(404).json({ mensaje: "Frase no encontrada." });
      res.json({ ok: true, frase });
    } catch (e) {
      if (e.code === "23505") return res.status(409).json({ mensaje: "Slug duplicado." });
      next(e);
    }
  }
);

router.delete(
  "/frases/:id",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const ok = await desactivarFrase(req.params.id);
      if (!ok) return res.status(404).json({ mensaje: "Frase no encontrada." });
      res.status(204).end();
    } catch (e) { next(e); }
  }
);

/* ============================================================
   MULTER ERROR HANDLER
   ============================================================ */
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ mensaje: "El archivo supera 10 MB." });
    }
    return res.status(400).json({ mensaje: err.message });
  }
  if (err) return res.status(err.estado || 500).json({ mensaje: err.message });
  next();
});

export default router;