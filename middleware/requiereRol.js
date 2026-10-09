import { obtenerPool } from "../config/conexion.js";

/**
 * Middleware que exige que el usuario tenga al menos uno de los roles indicados.
 * DEBE ir después de requerirAutenticacion() de imansi-auth-node.
 *
 * Uso:
 *   router.post("/upload", requerirAutenticacion(), requiereRol("admin"), handler)
 */
export function requiereRol(...rolesPermitidos) {
  return async function middleware(req, res, next) {
    try {
      if (!req.usuario?.id) {
        return res.status(401).json({ mensaje: "No autenticado." });
      }

      const pool = obtenerPool();
      const { rows } = await pool.query(
        `SELECT r.nombre
         FROM roles r
         INNER JOIN usuarios_roles ur ON ur.rol_id = r.id
         WHERE ur.usuario_id = $1`,
        [req.usuario.id]
      );

      const rolesUsuario = rows.map((r) => r.nombre);
      const autorizado = rolesPermitidos.some((r) => rolesUsuario.includes(r));

      if (!autorizado) {
        return res.status(403).json({
          mensaje: "No tienes permisos para esta acción.",
          requeridos: rolesPermitidos,
        });
      }

      req.usuario.roles = rolesUsuario;
      next();
    } catch (error) {
      next(error);
    }
  };
}