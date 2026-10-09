import { Router } from "express";
import { requerirAutenticacion } from "imansi-auth-node";
import { obtenerPool } from "../config/conexion.js";

const router = Router();

// GET /api/roles  → devuelve los roles del usuario autenticado
router.get("/", requerirAutenticacion(), async (req, res, next) => {
  try {
    const pool = obtenerPool();

    const { rows } = await pool.query(
      `SELECT r.id, r.nombre, r.descripcion
       FROM roles r
       INNER JOIN usuarios_roles ur ON ur.rol_id = r.id
       WHERE ur.usuario_id = $1
       ORDER BY r.nombre ASC`,
      [req.usuario.id]
    );

    const roles = rows.map((r) => r.nombre);

    res.json({
      ok: true,
      mensaje: "Ruta de roles funcionando",
      usuario: req.usuario,
      roles,       // ["admin"] | ["vendedor"] | ["cliente"] | [...]
    });
  } catch (error) {
    next(error);
  }
});

export default router;