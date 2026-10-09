// test-paypal.js
// Prueba completa del flujo PayPal (crear orden -> aprobar -> capturar) con Express.
//
// Instalación:
//   npm init -y
//   npm i express dotenv @paypal/paypal-server-sdk
//   (en package.json agregá:  "type": "module")
//
// .env:
//   PAYPAL_CLIENT_ID=tu_client_id_sandbox
//   PAYPAL_CLIENT_SECRET=tu_secret_sandbox
//   PAYPAL_ENV=sandbox
//
// Correr:  node test-paypal.js   y abrir  http://localhost:3000

import 'dotenv/config';
import express from 'express';
import {
  Client,
  Environment,
  OrdersController,
  CheckoutPaymentIntent,
} from '@paypal/paypal-server-sdk';

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

// ---------- Validación de variables de entorno ----------
if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
  console.error('❌ Faltan PAYPAL_CLIENT_ID o PAYPAL_CLIENT_SECRET en el .env');
  process.exit(1);
}

const esLive = process.env.PAYPAL_ENV === 'live';

// ---------- Cliente PayPal ----------
const client = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: process.env.PAYPAL_CLIENT_ID,
    oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET,
  },
  environment: esLive ? Environment.Production : Environment.Sandbox,
});

const ordersController = new OrdersController(client);

// ---------- Helpers ----------
const log = (titulo, data) => {
  console.log(`\n──────── ${titulo} ────────`);
  if (data !== undefined) {
    console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }
};

// Algunos valores del SDK pueden venir como BigInt: los convertimos a string
const safeJson = (obj) =>
  JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);

const manejarError = (res, error) => {
  console.error('❌ Error:', error.message);
  if (error.statusCode) console.error('Status HTTP:', error.statusCode);
  if (error.result) console.error('Detalle:', safeJson(error.result));
  res.status(error.statusCode || 500).type('json').send(
    safeJson({
      error: error.message,
      statusCode: error.statusCode,
      detalle: error.result,
    })
  );
};

// ---------- Express ----------
const app = express();

// Página de inicio
app.get('/', (req, res) => {
  res.send(`
    <html>
      <body style="font-family:sans-serif;max-width:600px;margin:60px auto;">
        <h1>🌹 Test PayPal — Speaking Roses</h1>
        <p>Entorno: <b>${esLive ? 'LIVE ⚠️' : 'SANDBOX'}</b></p>
        <p><a href="/crear-orden">▶ Crear orden de $10.00 USD y pagar</a></p>
        <p><a href="/crear-orden?json=1">▶ Solo crear la orden (ver JSON)</a></p>
        <p style="color:#666">Mirá la consola de la terminal para ver todo el detalle.</p>
      </body>
    </html>
  `);
});

// 1) Crear orden
app.get('/crear-orden', async (req, res) => {
  try {
    log('1. Creando orden...');

    const { result: order, statusCode } = await ordersController.createOrder({
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [
          {
            amount: { currencyCode: 'USD', value: '10.00' },
            description: 'Prueba de integración Speaking Roses',
          },
        ],
        // Con esto PayPal redirige de vuelta a tu localhost al aprobar/cancelar
        paymentSource: {
          paypal: {
            experienceContext: {
              returnUrl: `${BASE_URL}/exito`,
              cancelUrl: `${BASE_URL}/cancelado`,
              userAction: 'PAY_NOW',
              brandName: 'Speaking Roses',
            },
          },
        },
      },
      prefer: 'return=representation',
    });

    log('✅ Orden creada', { id: order.id, status: order.status, httpStatus: statusCode });
    log('Respuesta completa de PayPal', safeJson(order));

    // Con paymentSource.paypal el link viene como "payer-action"; si no, como "approve"
    const approveLink = order.links?.find(
      (l) => l.rel === 'payer-action' || l.rel === 'approve'
    )?.href;

    log('🔗 Link de aprobación', approveLink);

    if (req.query.json) {
      return res.type('json').send(safeJson(order));
    }

    // Redirige al usuario a PayPal para que apruebe el pago
    res.redirect(approveLink);
  } catch (error) {
    manejarError(res, error);
  }
});

// 2) PayPal vuelve acá después de que el usuario aprueba. El "token" es el ID de la orden.
app.get('/exito', async (req, res) => {
  const orderId = req.query.token;
  log('2. Usuario volvió de PayPal', { query: req.query });

  if (!orderId) {
    return res.status(400).send('Falta el parámetro token (ID de la orden)');
  }

  try {
    log('3. Capturando pago...', orderId);

    const { result: capture, statusCode } = await ordersController.captureOrder({
      id: orderId,
      prefer: 'return=representation',
    });

    const captura = capture.purchaseUnits?.[0]?.payments?.captures?.[0];

    log('✅ Pago capturado', {
      status: capture.status,
      httpStatus: statusCode,
      captureId: captura?.id,
      monto: captura?.amount,
      pagador: capture.payer?.emailAddress,
    });
    log('Respuesta completa de PayPal', safeJson(capture));

    res.type('json').send(safeJson(capture));
  } catch (error) {
    manejarError(res, error);
  }
});

// 3) El usuario canceló en PayPal
app.get('/cancelado', (req, res) => {
  log('⚠️ El usuario canceló el pago', { query: req.query });
  res.send('Pago cancelado. <a href="/">Volver</a>');
});

app.listen(PORT, () => {
  console.log(`\n🚀 Servidor listo en ${BASE_URL}`);
  console.log(`   Entorno PayPal: ${esLive ? 'LIVE ⚠️' : 'SANDBOX'}`);
  console.log(`   Abrí ${BASE_URL} en el navegador para probar\n`);
});