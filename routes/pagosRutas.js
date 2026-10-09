// backend/routes/pagosRutas.js
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { requerirAutenticacion } from "imansi-auth-node";
import { obtenerPool } from "../config/conexion.js";

import {
  crearOrdenPaypal,
  capturarOrdenPaypal,
  extraerDatosCaptura,
} from "../services/paypalServicio.js";
import {
  crearFacturaDesdePedido,
  obtenerEstadoConexion,
  cargarTokensQuickBooks,
} from "../services/quickbooksServicio.js";
import {
  crearPedidoConItems,
  obtenerPedido,
  marcarPedidoPagado,
  guardarFacturaQuickBooks,
  registrarPago,
} from "../services/pedidosServicio.js";
import { actualizarDetalle } from "../services/usuariosDetallesService.js";

// 🆕 Import para crear suscripción AutoShip al confirmar el pago
import { crearSuscripcionDesdePedido } from "../services/suscripcionServicio.js";

const router = Router();

/* ============================================================
   GET /api/pagos/estado
   ============================================================ */
router.get("/estado", async (req, res) => {
  try {
    await cargarTokensQuickBooks();
    res.json({
      paypal: {
        entorno: process.env.PAYPAL_ENV || "sandbox",
        configurado: Boolean(process.env.PAYPAL_CLIENT_ID),
      },
      quickbooks: obtenerEstadoConexion(),
    });
  } catch (e) {
    res.status(500).json({ mensaje: e.message });
  }
});

/* ============================================================
   POST /api/pagos/crear
   ============================================================
   Body: {
     programa, rows, envio, facturacion, actualizarPerfil, clientRef
   }
   ============================================================ */
router.post("/crear", requerirAutenticacion(), async (req, res, next) => {
  try {
    const {
      programa = "onetime",
      rows = [],
      envio = {},
      facturacion = null,
      actualizarPerfil = null,
      clientRef = randomUUID(),
    } = req.body;

    if (!rows.length) {
      return res.status(400).json({ mensaje: "El carrito está vacío." });
    }
    if (!envio.email || !envio.nombre) {
      return res.status(400).json({ mensaje: "Faltan datos de envío (nombre y email)." });
    }

    const pool = obtenerPool();

    // 1. Precio del cliente
    const { rows: precioRows } = await pool.query(
      `SELECT * FROM obtener_precio_para_usuario($1)`,
      [req.usuario.id]
    );
    const precio = precioRows[0];
    if (!precio) {
      return res.status(500).json({ mensaje: "No hay precio configurado para tu cuenta." });
    }

    // 2. Vendedor (referido_por)
    const { rows: usuarioRows } = await pool.query(
      `SELECT referido_por FROM usuarios WHERE id = $1 LIMIT 1`,
      [req.usuario.id]
    );
    const vendedorId = usuarioRows[0]?.referido_por || null;

    // 3. Crear pedido + items
    const { pedido, items, existia } = await crearPedidoConItems({
      usuarioId: req.usuario.id,
      vendedorId,
      programa,
      rows,
      precio: {
        autoship: precio.autoship_precio_por_rosa,
        onetime: precio.onetime_precio_por_rosa,
        texto: precio.personalizacion_texto_precio,
        foto: precio.personalizacion_foto_precio,
      },
      envio,
      facturacion,
      clientRef,
    });

    // 4. Crear orden de PayPal
    const base = process.env.URL_FRONTEND || "http://localhost:5173";
    const { orderId, approveUrl } = await crearOrdenPaypal({
      monto: pedido.total,
      moneda: "USD",
      descripcion: `Pedido ${pedido.numero}`,
      returnUrl: `${base}/dashboard/checkout/exito?pedidoId=${pedido.id}&provider=paypal`,
      cancelUrl: `${base}/dashboard/checkout/cancelado?pedidoId=${pedido.id}&provider=paypal`,
      clientRef: pedido.client_ref,
    });

    // 5. Registrar intento de pago (pendiente)
    await registrarPago({
      pedidoId: pedido.id,
      proveedor: "paypal",
      proveedorOrderId: orderId,
      monto: pedido.total,
      moneda: "USD",
      estado: "pendiente",
      respuesta: { approveUrl },
      metadata: { clientRef, existia },
    });

    // 6. Actualizar usuarios_detalles (best effort)
    if (actualizarPerfil && typeof actualizarPerfil === "object") {
      try {
        const cambios = {};
        const permitidos = [
          "telefono", "direccion", "ciudad", "provincia",
          "codigo_postal", "pais", "nombre_tienda", "contacto",
          "sitio_web", "tax_id",
        ];
        for (const k of permitidos) {
          if (actualizarPerfil[k] !== undefined) {
            cambios[k] = actualizarPerfil[k];
          }
        }
        if (Object.keys(cambios).length) {
          await actualizarDetalle(req.usuario.id, cambios);
        }
      } catch (e) {
        console.warn("⚠️ No se pudo actualizar el detalle del usuario:", e.message);
      }
    }

    res.status(201).json({
      ok: true,
      pedidoId: pedido.id,
      numero: pedido.numero,
      subtotal: Number(pedido.subtotal),
      total: Number(pedido.total),
      orderId,
      approveUrl,
    });
  } catch (e) {
    console.error("Error en /api/pagos/crear:", e);
    next(e);
  }
});

/* ============================================================
   POST /api/pagos/capturar
   ============================================================
   Body: { pedidoId, orderId }
   Estados:
   - 200 OK       → pago completado
   - 202 PENDING  → pago pendiente (eCheck, etc.)
   - 402 Fallido  → PayPal rechazó
   - 404          → pedido no encontrado
   - 403          → pedido de otro usuario
   ============================================================ */
router.post("/capturar", requerirAutenticacion(), async (req, res, next) => {
  try {
    const { pedidoId, orderId } = req.body;
    if (!pedidoId || !orderId) {
      return res.status(400).json({ mensaje: "Faltan pedidoId u orderId." });
    }

    const data = await obtenerPedido(pedidoId);
    if (!data) return res.status(404).json({ mensaje: "Pedido no encontrado." });

    if (data.pedido.usuario_id !== req.usuario.id) {
      return res.status(403).json({ mensaje: "Este pedido no te pertenece." });
    }

    // ✅ Si ya está pagado, devolver inmediatamente sin llamar a PayPal
    if (data.pedido.estado === "paid") {
      // 🆕 Por si quedó pagado sin suscripción (pedidos viejos)
      if (data.pedido.programa === "autoship") {
        try {
          const r = await crearSuscripcionDesdePedido(pedidoId, data.pedido.usuario_id);
          if (!r.yaExistia) {
            console.log(`✅ Suscripción AutoShip creada (pedido ya pagado) para ${data.pedido.usuario_id}`);
          }
        } catch (e) {
          console.warn("⚠️ No se pudo crear suscripción AutoShip (ya pagado):", e.message);
        }
      }

      return res.json({
        ok: true,
        pedido: data.pedido,
        items: data.items,
        yaEstabaPagado: true,
        payUrl: data.pedido.qbo_invoice_url || null,
      });
    }

    // ─── Intentar capturar en PayPal ──────────────────────
    let capture = null;
    let datos = null;
    let yaCapturado = false;

    try {
      capture = await capturarOrdenPaypal(orderId);
      datos = extraerDatosCaptura(capture);
    } catch (err) {
      // ✅ Si PayPal dice ORDER_ALREADY_CAPTURED, marcar el pedido como pagado
      const detalles = err?.result?.details || [];
      const esAlreadyCaptured = detalles.some(
        (d) => d.issue === "ORDER_ALREADY_CAPTURED"
      );

      if (esAlreadyCaptured) {
        console.warn("⚠️ Orden ya capturada previamente en PayPal. Marcando pedido como pagado.");
        yaCapturado = true;

        // Marcar pedido como pagado
        await marcarPedidoPagado(pedidoId, {
          captureId: orderId,
          pagadoEn: new Date(),
        });

        // 🆕 Si es AutoShip, crear la suscripción (si falta)
        if (data.pedido.programa === "autoship") {
          try {
            const r = await crearSuscripcionDesdePedido(pedidoId, data.pedido.usuario_id);
            if (!r.yaExistia) {
              console.log(`✅ Suscripción AutoShip creada (already captured) para ${data.pedido.usuario_id}`);
            }
          } catch (e) {
            console.warn("⚠️ No se pudo crear suscripción AutoShip (already captured):", e.message);
          }
        }

        const pedidoActualizado = await obtenerPedido(pedidoId);

        // Intentar crear factura en QuickBooks
        let invoice = null;
        try {
          await cargarTokensQuickBooks();
          const estadoQB = obtenerEstadoConexion();
          if (estadoQB.conectado) {
            const factura = await crearFacturaDesdePedido(
              pedidoActualizado.pedido,
              pedidoActualizado.items
            );
            await guardarFacturaQuickBooks(pedidoId, {
              invoiceId: factura.invoiceId,
              docNumber: factura.docNumber,
              invoiceUrl: factura.invoiceUrl,
            });
            invoice = factura;
          }
        } catch (e) {
          console.warn("⚠️ QuickBooks falló:", e.message);
        }

        return res.json({
          ok: true,
          pedido: pedidoActualizado.pedido,
          items: pedidoActualizado.items,
          yaEstabaCapturado: true,
          invoice,
          payUrl: pedidoActualizado.pedido.qbo_invoice_url || null,
        });
      }

      // Si fue otro error (red, timeout, etc.)
      console.error("Error capturando en PayPal:", err.message);
      return res.status(err.statusCode || 500).json({
        mensaje: err.message || "No se pudo capturar el pago.",
        detalle: err.result || null,
      });
    }

    // ─── PENDING ──────────────────────────────────────────
    if (capture.status === "PENDING") {
      try {
        await registrarPago({
          pedidoId,
          proveedor: datos.funding === "venmo" ? "venmo" : "paypal",
          proveedorOrderId: orderId,
          proveedorCaptureId: datos.captureId,
          proveedorPayerId: datos.payerId,
          monto: Number(data.pedido.total),
          moneda: "USD",
          estado: "pendiente",
          respuesta: capture,
          metadata: { funding: datos.funding, status: capture.status },
        });
      } catch (e) {
        console.warn("⚠️ No se pudo registrar pago pendiente:", e.message);
      }

      return res.status(202).json({
        ok: false,
        pendiente: true,
        mensaje: "Tu pago está pendiente de confirmación por PayPal.",
        captura: datos,
        pedido: data.pedido,
      });
    }

    // ─── FALLIDO ──────────────────────────────────────────
    if (capture.status !== "COMPLETED") {
      try {
        await registrarPago({
          pedidoId,
          proveedor: datos.funding === "venmo" ? "venmo" : "paypal",
          proveedorOrderId: orderId,
          proveedorCaptureId: datos.captureId,
          proveedorPayerId: datos.payerId,
          monto: Number(data.pedido.total),
          moneda: "USD",
          estado: "fallido",
          respuesta: capture,
          metadata: { funding: datos.funding, status: capture.status },
        });
      } catch (e) {
        console.warn("⚠️ No se pudo registrar pago fallido:", e.message);
      }

      return res.status(402).json({
        ok: false,
        fallido: true,
        mensaje: `PayPal rechazó el pago (${capture.status}). Podés reintentar.`,
        captura: datos,
        pedido: data.pedido,
      });
    }

    // ─── COMPLETADO ───────────────────────────────────────
    await marcarPedidoPagado(pedidoId, {
      captureId: datos.captureId,
      pagadoEn: new Date(),
    });

    // 🆕 Si es AutoShip, crear la suscripción (una sola vez)
    if (data.pedido.programa === "autoship") {
      try {
        const r = await crearSuscripcionDesdePedido(pedidoId, data.pedido.usuario_id);
        if (r.yaExistia) {
          console.log(`ℹ️ Suscripción AutoShip ya existía para usuario ${data.pedido.usuario_id}`);
        } else {
          console.log(`✅ Suscripción AutoShip creada para usuario ${data.pedido.usuario_id}`);
        }
      } catch (e) {
        console.warn("⚠️ No se pudo crear la suscripción AutoShip:", e.message);
      }
    }

    try {
      await registrarPago({
        pedidoId,
        proveedor: datos.funding === "venmo" ? "venmo" : "paypal",
        proveedorOrderId: orderId,
        proveedorCaptureId: datos.captureId,
        proveedorPayerId: datos.payerId,
        monto: Number(datos.monto),
        moneda: datos.moneda,
        comision: Number(datos.comision) || 0,
        montoNeto: Number(datos.montoNeto) || 0,
        estado: "completado",
        respuesta: capture,
        metadata: { funding: datos.funding, pagador: datos.pagador },
      });
    } catch (e) {
      console.warn("⚠️ No se pudo registrar pago completado:", e.message);
    }

    // Factura en QuickBooks
    let invoice = null;
    try {
      await cargarTokensQuickBooks();
      const estadoQB = obtenerEstadoConexion();
      if (estadoQB.conectado) {
        const pedidoActual = await obtenerPedido(pedidoId);
        const factura = await crearFacturaDesdePedido(
          pedidoActual.pedido,
          pedidoActual.items
        );
        await guardarFacturaQuickBooks(pedidoId, {
          invoiceId: factura.invoiceId,
          docNumber: factura.docNumber,
          invoiceUrl: factura.invoiceUrl,
        });
        invoice = factura;
      }
    } catch (e) {
      console.warn("⚠️ QuickBooks falló:", e.message);
    }

    const pedidoActualizado = await obtenerPedido(pedidoId);
    res.json({
      ok: true,
      pedido: pedidoActualizado.pedido,
      items: pedidoActualizado.items,
      captura: datos,
      invoice,
      payUrl: pedidoActualizado.pedido.qbo_invoice_url || null,
    });
  } catch (e) {
    console.error("Error en /api/pagos/capturar:", e);
    next(e);
  }
});

/* ============================================================
   🆕 POST /api/pagos/retomar
   ============================================================
   Body: { pedidoId }
   Genera una NUEVA orden de PayPal para un pedido que quedó
   en estado 'awaiting_payment' (cancelado o nunca pagado).
   Devuelve: { approveUrl, orderId }
   ============================================================ */
router.post("/retomar", requerirAutenticacion(), async (req, res, next) => {
  try {
    const { pedidoId } = req.body;
    if (!pedidoId) {
      return res.status(400).json({ mensaje: "Falta pedidoId." });
    }

    const data = await obtenerPedido(pedidoId);
    if (!data) return res.status(404).json({ mensaje: "Pedido no encontrado." });

    if (data.pedido.usuario_id !== req.usuario.id) {
      return res.status(403).json({ mensaje: "Este pedido no te pertenece." });
    }

    if (data.pedido.estado === "paid") {
      return res.status(400).json({ mensaje: "Este pedido ya está pagado." });
    }

    if (data.pedido.estado === "cancelled") {
      return res.status(400).json({ mensaje: "Este pedido fue cancelado." });
    }

    // Crear una nueva orden de PayPal para el mismo monto
    const base = process.env.URL_FRONTEND || "http://localhost:5173";
    const { orderId, approveUrl } = await crearOrdenPaypal({
      monto: data.pedido.total,
      moneda: "USD",
      descripcion: `Pedido ${data.pedido.numero}`,
      returnUrl: `${base}/dashboard/checkout/exito?pedidoId=${data.pedido.id}&provider=paypal`,
      cancelUrl: `${base}/dashboard/checkout/cancelado?pedidoId=${data.pedido.id}&provider=paypal`,
      clientRef: data.pedido.client_ref,
    });

    // Registrar el nuevo intento de pago
    try {
      await registrarPago({
        pedidoId: data.pedido.id,
        proveedor: "paypal",
        proveedorOrderId: orderId,
        monto: data.pedido.total,
        moneda: "USD",
        estado: "pendiente",
        respuesta: { approveUrl, retomado: true },
        metadata: { clientRef: data.pedido.client_ref, esRetomar: true },
      });
    } catch (e) {
      console.warn("⚠️ No se pudo registrar el intento de retomar:", e.message);
    }

    res.json({
      ok: true,
      pedidoId: data.pedido.id,
      numero: data.pedido.numero,
      total: Number(data.pedido.total),
      orderId,
      approveUrl,
    });
  } catch (e) {
    console.error("Error en /api/pagos/retomar:", e);
    next(e);
  }
});

/* ============================================================
   POST /api/pagos/cancelar
   ============================================================
   Body: { pedidoId }
   Marca el pedido como cancelled si todavía no se pagó.
   ============================================================ */
router.post("/cancelar", requerirAutenticacion(), async (req, res, next) => {
  try {
    const { pedidoId } = req.body;
    if (!pedidoId) {
      return res.status(400).json({ mensaje: "Falta pedidoId." });
    }

    const pool = obtenerPool();

    const { rows } = await pool.query(
      `SELECT id, estado, usuario_id FROM pedidos WHERE id = $1 LIMIT 1`,
      [pedidoId]
    );
    if (!rows[0]) return res.status(404).json({ mensaje: "Pedido no encontrado." });
    if (rows[0].usuario_id !== req.usuario.id) {
      return res.status(403).json({ mensaje: "Este pedido no te pertenece." });
    }

    // Solo cancelar si todavía no se pagó
    if (rows[0].estado === "awaiting_payment") {
      await pool.query(
        `UPDATE pedidos SET estado = 'cancelled', actualizado_en = NOW() WHERE id = $1`,
        [pedidoId]
      );
    }

    res.json({ ok: true, pedidoId, estado: "cancelled" });
  } catch (e) { next(e); }
});

/* ============================================================
   GET /api/pagos/pedido/:id
   ============================================================ */
router.get("/pedido/:id", requerirAutenticacion(), async (req, res, next) => {
  try {
    const data = await obtenerPedido(req.params.id);
    if (!data) return res.status(404).json({ mensaje: "Pedido no encontrado." });
    if (data.pedido.usuario_id !== req.usuario.id) {
      return res.status(403).json({ mensaje: "No autorizado." });
    }
    res.json(data);
  } catch (e) { next(e); }
});

export default router;