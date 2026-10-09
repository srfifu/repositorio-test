// backend/routes/frasesRutas.js
import { Router } from "express";
import { requerirAutenticacion } from "imansi-auth-node";
import { requiereRol } from "../middleware/requiereRol.js";
import {
  listarCategoriasConFrases,
  crearCategoria,
  editarCategoria,
  desactivarCategoria,
  crearFrase,
  editarFrase,
  desactivarFrase,
  slugify,
} from "../services/frasesService.js";

const router = Router();

// ─────────────────────────────────────────────────────────
// GET /api/frases  → todas las categorías con sus frases
// ─────────────────────────────────────────────────────────
router.get("/", requerirAutenticacion(), async (req, res, next) => {
  try {
    const categorias = await listarCategoriasConFrases();
    res.json({ categorias });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────
// POST /api/frases/categorias  → crear categoría
// ─────────────────────────────────────────────────────────
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
      const slug = slugify(nombre_en || nombre_es);
      const categoria = await crearCategoria({ nombre_es, nombre_en, slug, orden });
      res.status(201).json({ ok: true, categoria });
    } catch (e) {
      if (e.code === "23505") return res.status(409).json({ mensaje: "Ya existe esa categoría." });
      next(e);
    }
  }
);

// ─────────────────────────────────────────────────────────
// PATCH /api/frases/categorias/:id  → editar categoría
// ─────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────
// DELETE /api/frases/categorias/:id  → eliminar categoría
// ─────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────
// POST /api/frases  → crear frase
// ─────────────────────────────────────────────────────────
router.post(
  "/",
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
      if (e.code === "23505") return res.status(409).json({ mensaje: "Ya existe esa frase en la categoría." });
      next(e);
    }
  }
);

// ─────────────────────────────────────────────────────────
// PATCH /api/frases/:id  → editar frase
// ─────────────────────────────────────────────────────────
router.patch(
  "/:id",
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

// ─────────────────────────────────────────────────────────
// DELETE /api/frases/:id  → eliminar frase
// ─────────────────────────────────────────────────────────
router.delete(
  "/:id",
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

export default router;