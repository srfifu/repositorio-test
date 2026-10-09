// backend/services/paypalServicio.js
import "dotenv/config";
import {
  Client,
  Environment,
  OrdersController,
  CheckoutPaymentIntent,
} from "@paypal/paypal-server-sdk";

/* ============================================================
   PAYPAL — Crear orden + capturar
   ============================================================ */

const esLive = process.env.PAYPAL_ENV === "live";

const client = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: process.env.PAYPAL_CLIENT_ID,
    oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET,
  },
  environment: esLive ? Environment.Production : Environment.Sandbox,
});

const ordersController = new OrdersController(client);

/**
 * Crea una orden en PayPal.
 * @param {Object} opts
 * @param {string} opts.monto - "610.98"
 * @param {string} opts.moneda - "USD"
 * @param {string} opts.descripcion
 * @param {string} opts.returnUrl
 * @param {string} opts.cancelUrl
 * @param {string} opts.clientRef - para idempotencia (opcional)
 * @returns {Promise<{ orderId: string, approveUrl: string, raw: object }>}
 */
export async function crearOrdenPaypal({
  monto,
  moneda = "USD",
  descripcion,
  returnUrl,
  cancelUrl,
  clientRef,
}) {
  const { result: order } = await ordersController.createOrder({
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          amount: { currencyCode: moneda, value: String(monto) },
          description: descripcion || "Speaking Roses",
          customId: clientRef || undefined,
        },
      ],
      paymentSource: {
        paypal: {
          experienceContext: {
            returnUrl,
            cancelUrl,
            userAction: "PAY_NOW",
            brandName: "Speaking Roses",
          },
        },
      },
    },
    prefer: "return=representation",
  });

  const approveUrl = order.links?.find(
    (l) => l.rel === "payer-action" || l.rel === "approve"
  )?.href;

  if (!approveUrl) {
    const err = new Error("PayPal no devolvió link de aprobación.");
    err.estado = 502;
    throw err;
  }

  return { orderId: order.id, approveUrl, raw: order };
}

/**
 * Captura una orden ya aprobada por el usuario.
 * @param {string} orderId
 * @returns {Promise<object>} capture (raw de PayPal)
 */
export async function capturarOrdenPaypal(orderId) {
  const { result: capture } = await ordersController.captureOrder({
    id: orderId,
    prefer: "return=representation",
  });
  return capture;
}

/**
 * Extrae datos útiles de un capture de PayPal.
 */
export function extraerDatosCaptura(capture) {
  const c = capture.purchaseUnits?.[0]?.payments?.captures?.[0];
  const breakdown = c?.sellerReceivableBreakdown || {};
  return {
    status: capture.status,
    captureId: c?.id,
    orderId: capture.id,
    monto: c?.amount?.value,
    moneda: c?.amount?.currencyCode,
    comision: breakdown.paypalFee?.value,
    montoNeto: breakdown.netAmount?.value,
    pagador: capture.paymentSource?.paypal?.emailAddress
      || capture.payer?.emailAddress,
    payerId: capture.paymentSource?.paypal?.accountId
      || capture.payer?.payerId,
    funding: capture.paymentSource?.venmo ? "venmo" : "paypal",
  };
}