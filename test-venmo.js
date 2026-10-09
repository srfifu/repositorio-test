// test-venmo.js
// Prueba completa de Venmo (sandbox) con el PayPal JS SDK v6 + backend Express.
//
// Instalación (solo necesita express y dotenv, Node 18+):
//   npm i express dotenv
//   (en package.json: "type": "module")
//
// .env (mismas credenciales SANDBOX que el test anterior):
//   PAYPAL_CLIENT_ID=...
//   PAYPAL_CLIENT_SECRET=...
//
// Correr:  node test-venmo.js   y abrir  http://localhost:3001
//
// Requisitos de Venmo: pago en USD, comprador de EE.UU. y una cuenta sandbox
// de comprador con Venmo. Venmo es "mobile first": en escritorio puede no ser elegible.

import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';

const PORT = 3001;
const API = 'https://api-m.sandbox.paypal.com'; // Venmo de prueba: solo sandbox
const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;

if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  console.error('❌ Faltan PAYPAL_CLIENT_ID o PAYPAL_CLIENT_SECRET en el .env');
  process.exit(1);
}

const basicAuth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');

// ---------- Helpers ----------
const log = (titulo, data) => {
  console.log(`\n──────── ${titulo} ────────`);
  if (data !== undefined) console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
};

async function pedirToken(body) {
  const res = await fetch(`${API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error('Error pidiendo token a PayPal'), { status: res.status, detalle: data });
  return data.access_token;
}

// Token de servidor (para crear/capturar órdenes)
const getAccessToken = () => pedirToken('grant_type=client_credentials');

// Token seguro para el navegador (lo usa el SDK v6)
const getClientToken = () =>
  pedirToken('grant_type=client_credentials&response_type=client_token&intent=sdk_init');

const manejarError = (res, error) => {
  console.error('❌ Error:', error.message);
  if (error.detalle) console.error('Detalle:', JSON.stringify(error.detalle, null, 2));
  res.status(error.status || 500).json({ error: error.message, detalle: error.detalle });
};

// ---------- Express ----------
const app = express();
app.use(express.json());

// Token para el SDK del navegador
app.get('/api/client-token', async (req, res) => {
  try {
    const clientToken = await getClientToken();
    log('🔑 Client token generado para el navegador');
    res.json({ clientToken });
  } catch (error) {
    manejarError(res, error);
  }
});

// Crear orden (USD, requerido por Venmo)
app.post('/api/crear-orden', async (req, res) => {
  try {
    const accessToken = await getAccessToken();

    const response = await fetch(`${API}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': randomUUID(),
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: { currency_code: 'USD', value: '10.00' },
            description: 'Prueba Venmo Speaking Roses',
          },
        ],
        payment_source: {
          venmo: {
            experience_context: { shipping_preference: 'NO_SHIPPING' },
          },
        },
      }),
    });

    const order = await response.json();
    if (!response.ok) throw Object.assign(new Error('PayPal rechazó la creación de la orden'), { status: response.status, detalle: order });

    log('✅ Orden creada', { id: order.id, status: order.status });
    log('Respuesta completa de PayPal', order);

    res.json({ orderId: order.id });
  } catch (error) {
    manejarError(res, error);
  }
});

// Capturar orden (se llama cuando el usuario aprobó en Venmo)
app.post('/api/capturar-orden/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    log('3. Capturando orden...', orderId);

    const accessToken = await getAccessToken();
    const response = await fetch(`${API}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        'PayPal-Request-Id': randomUUID(),
      },
    });

    const capture = await response.json();
    if (!response.ok) throw Object.assign(new Error('PayPal rechazó la captura'), { status: response.status, detalle: capture });

    const c = capture.purchase_units?.[0]?.payments?.captures?.[0];
    log('✅ Pago capturado', {
      status: capture.status,
      captureId: c?.id,
      monto: c?.amount,
      pagador: capture.payment_source?.venmo ?? capture.payer,
    });
    log('Respuesta completa de PayPal', capture);

    res.json(capture);
  } catch (error) {
    manejarError(res, error);
  }
});

// Página de prueba
const PAGE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Test Venmo - Speaking Roses</title>
  <style>
    body { font-family: sans-serif; max-width: 560px; margin: 50px auto; padding: 0 16px; text-align: center; }
    #venmo-container { margin: 30px 0; min-height: 50px; }
    #status { font-size: 15px; color: #333; margin-bottom: 12px; }
    #log { text-align: left; background: #111; color: #9fe870; padding: 12px; border-radius: 8px;
           font-size: 12px; max-height: 320px; overflow: auto; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>🌹 Test Venmo (sandbox)</h1>
  <p>Monto de prueba: <b>$10.00 USD</b></p>

  <div id="status">Cargando SDK...</div>
  <div id="venmo-container">
    <venmo-button id="venmo-button" type="pay" hidden></venmo-button>
  </div>
  <pre id="log"></pre>

  <script>
    const statusEl = document.getElementById('status');
    const logEl = document.getElementById('log');

    function log(msg, data) {
      const line = '[' + new Date().toLocaleTimeString() + '] ' + msg +
        (data !== undefined ? '\\n' + JSON.stringify(data, null, 2) : '');
      logEl.textContent += line + '\\n\\n';
      logEl.scrollTop = logEl.scrollHeight;
      console.log(msg, data);
    }

    async function crearOrden() {
      const res = await fetch('/api/crear-orden', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error('crear-orden falló: ' + JSON.stringify(data));
      log('Orden creada en el backend', data);
      return { orderId: data.orderId };
    }

    async function capturarOrden(orderId) {
      const res = await fetch('/api/capturar-orden/' + orderId, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error('capturar-orden falló: ' + JSON.stringify(data));
      return data;
    }

    async function onPayPalWebSdkLoaded() {
      try {
        log('SDK cargado, pidiendo client token...');
        const tokenRes = await fetch('/api/client-token');
        const { clientToken } = await tokenRes.json();
        if (!clientToken) throw new Error('No llegó el client token (revisá la consola del servidor)');

        const sdkInstance = await window.paypal.createInstance({
          clientToken: clientToken,
          components: ['venmo-payments'],
          pageType: 'checkout',
          testBuyerCountry: 'US', // solo sandbox
        });
        log('SDK inicializado');

        // countryCode: 'US' es clave: si no se pasa, el SDK detecta tu país real (AR) y Venmo da false
        const methods = await sdkInstance.findEligibleMethods({
          currencyCode: 'USD',
          countryCode: 'US',
        });
        const elegible = methods.isEligible('venmo');
        log('¿Venmo elegible?', elegible);
        try { log('Detalle de Venmo', methods.getDetails('venmo')); } catch (e) { log('Sin detalle de Venmo', e.message); }

        // Diagnóstico: si PayPal tampoco es elegible, el problema son las credenciales/cuenta, no Venmo
        log('Diagnóstico de elegibilidad', {
          paypal: methods.isEligible('paypal'),
          paylater: methods.isEligible('paylater'),
          venmo: elegible,
        });

        if (!elegible) {
          statusEl.textContent = '⚠️ Venmo no es elegible en este navegador/dispositivo/cuenta.';
          return;
        }

        statusEl.textContent = 'Venmo disponible. Hacé clic en el botón.';

        const session = sdkInstance.createVenmoOneTimePaymentSession({
          onApprove: async function (data) {
            log('✅ onApprove', data);
            statusEl.textContent = 'Pago aprobado, capturando...';
            try {
              const capture = await capturarOrden(data.orderId);
              statusEl.textContent = '✅ Pago capturado: ' + capture.status;
              log('Captura completa', capture);
            } catch (e) {
              statusEl.textContent = '❌ ' + e.message;
              log('❌ Error capturando', e.message);
            }
          },
          onCancel: function (data) {
            statusEl.textContent = '⚠️ Pago cancelado';
            log('⚠️ onCancel', data);
          },
          onError: function (err) {
            statusEl.textContent = '❌ Error en el pago';
            log('❌ onError', String(err && err.message ? err.message : JSON.stringify(err)));
          },
        });

        const button = document.getElementById('venmo-button');
        button.removeAttribute('hidden');

        button.addEventListener('click', async function () {
          try {
            log('Click en Venmo, iniciando sesión de pago...');
            await session.start({ presentationMode: 'auto' }, crearOrden());
          } catch (e) {
            statusEl.textContent = '❌ ' + e.message;
            log('❌ Error en session.start', e.message);
          }
        });
      } catch (e) {
        statusEl.textContent = '❌ Error al iniciar: ' + e.message;
        log('❌ Error init', e.message);
      }
    }
  </script>

  <script async src="https://www.sandbox.paypal.com/web-sdk/v6/core" onload="onPayPalWebSdkLoaded()"></script>
</body>
</html>`;

app.get('/', (req, res) => res.send(PAGE));

app.listen(PORT, () => {
  console.log(`\n🚀 Test Venmo en http://localhost:${PORT}`);
  console.log('   Entorno: SANDBOX');
  console.log('   Venmo es mobile-first: si no aparece como elegible en escritorio, probá desde el celular (con un túnel HTTPS tipo ngrok).\n');
});