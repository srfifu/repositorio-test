// test-quickbooks.js
// Prueba completa de QuickBooks Online (sandbox): OAuth2 + empresa + clientes + factura de prueba.
//
// Instalación (Node 18+):
//   npm i express dotenv
//   (en package.json: "type": "module")
//
// .env:
//   QB_CLIENT_ID=...
//   QB_CLIENT_SECRET=...
//   QB_REALM_ID=...            (opcional: se completa solo desde el callback)
//   QB_ENVIRONMENT=sandbox
//   QB_REDIRECT_URI=http://localhost:3000/callback
//
// IMPORTANTE: el Redirect URI debe estar cargado EXACTAMENTE igual en
// developer.intuit.com -> tu app -> Keys & credentials -> Redirect URIs.
//
// Correr:  node test-quickbooks.js   y abrir  http://localhost:3000
// (si tenés el test de PayPal corriendo en el 3000, cerralo antes)

import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const PORT = 3000;
const {
  QB_CLIENT_ID,
  QB_CLIENT_SECRET,
  QB_REDIRECT_URI = `http://localhost:${PORT}/callback`,
  QB_ENVIRONMENT = 'sandbox',
} = process.env;

if (!QB_CLIENT_ID || !QB_CLIENT_SECRET) {
  console.error('❌ Faltan QB_CLIENT_ID o QB_CLIENT_SECRET en el .env');
  process.exit(1);
}

const esSandbox = QB_ENVIRONMENT !== 'production';
const API_BASE = esSandbox
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';
const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const MINOR_VERSION = 75;
const TOKENS_FILE = new URL('./qb-tokens.json', import.meta.url);

const basicAuth = Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64');

// ---------- Helpers ----------
const log = (titulo, data) => {
  console.log(`\n──────── ${titulo} ────────`);
  if (data !== undefined) console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
};

// Tokens en memoria + archivo qb-tokens.json (así sobreviven a reinicios)
let tokens = { accessToken: null, refreshToken: null, realmId: process.env.QB_REALM_ID || null };

async function cargarTokens() {
  try {
    const saved = JSON.parse(await readFile(TOKENS_FILE, 'utf8'));
    tokens = { ...tokens, ...saved };
    log('Tokens cargados desde qb-tokens.json', { realmId: tokens.realmId, tieneAccess: !!tokens.accessToken });
  } catch {
    /* primera vez: no hay archivo */
  }
}

async function guardarTokens() {
  await writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

async function pedirTokens(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error('Error pidiendo tokens a Intuit'), { status: res.status, detalle: data });
  return data;
}

async function refrescarAccessToken() {
  if (!tokens.refreshToken) throw new Error('No hay refresh token. Conectá primero en /conectar');
  log('🔄 Refrescando access token...');
  const data = await pedirTokens({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
  tokens.accessToken = data.access_token;
  tokens.refreshToken = data.refresh_token ?? tokens.refreshToken;
  await guardarTokens();
  log('✅ Access token refrescado');
}

// Llamada a la API de QuickBooks con refresh automático si da 401
async function qb(path, { method = 'GET', body } = {}, reintento = true) {
  if (!tokens.accessToken || !tokens.realmId) {
    throw Object.assign(new Error('No estás conectado. Abrí /conectar primero'), { status: 401 });
  }
  const sep = path.includes('?') ? '&' : '?';
  const url = `${API_BASE}/v3/company/${tokens.realmId}${path}${sep}minorversion=${MINOR_VERSION}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && reintento) {
    await refrescarAccessToken();
    return qb(path, { method, body }, false);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`QuickBooks respondió ${res.status}`), { status: res.status, detalle: data });
  return data;
}

const query = (sql) => qb(`/query?query=${encodeURIComponent(sql)}`);

const manejarError = (res, error) => {
  console.error('❌ Error:', error.message);
  if (error.detalle) console.error('Detalle:', JSON.stringify(error.detalle, null, 2));
  res.status(error.status || 500).json({ error: error.message, detalle: error.detalle });
};

// ---------- Express ----------
const app = express();
const estados = new Set(); // protección CSRF del parámetro "state"

app.get('/', (req, res) => {
  res.send(`
    <html><body style="font-family:sans-serif;max-width:620px;margin:50px auto;line-height:1.9">
      <h1>🌹 Test QuickBooks (${esSandbox ? 'SANDBOX' : 'PRODUCCIÓN ⚠️'})</h1>
      <p>Conectado: <b>${tokens.accessToken ? 'sí ✅' : 'no ❌'}</b> &nbsp; Realm ID: <b>${tokens.realmId ?? '—'}</b></p>
      <ol>
        <li><a href="/conectar">Conectar con QuickBooks (OAuth2)</a></li>
        <li><a href="/empresa">Ver datos de la empresa</a></li>
        <li><a href="/clientes">Listar clientes</a></li>
        <li><a href="/items">Listar productos/servicios</a></li>
        <li><a href="/crear-cliente">Crear cliente de prueba</a></li>
        <li><a href="/crear-factura">Crear factura de prueba (cliente nuevo + item + factura)</a></li>
        <li><a href="/refrescar">Forzar refresh del token</a></li>
      </ol>
      <p style="color:#666">Todo el detalle sale también en la consola de la terminal.</p>
    </body></html>
  `);
});

// 1) Iniciar OAuth
app.get('/conectar', (req, res) => {
  const state = randomUUID();
  estados.add(state);
  const url =
    `${AUTH_URL}?` +
    new URLSearchParams({
      client_id: QB_CLIENT_ID,
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting',
      redirect_uri: QB_REDIRECT_URI,
      state,
    }).toString();
  log('1. Redirigiendo a Intuit para autorizar', url);
  res.redirect(url);
});

// 2) Intuit vuelve acá con code + realmId
app.get('/callback', async (req, res) => {
  try {
    const { code, realmId, state, error } = req.query;
    log('2. Callback de Intuit', { query: { ...req.query, code: code ? '(recibido)' : undefined } });

    if (error) throw new Error(`Intuit devolvió error: ${error}`);
    if (!code || !realmId) throw new Error('Falta code o realmId en el callback');
    if (!estados.has(state)) throw new Error('El parámetro state no coincide (posible CSRF o servidor reiniciado)');
    estados.delete(state);

    if (process.env.QB_REALM_ID && process.env.QB_REALM_ID !== realmId) {
      log('⚠️ El realmId autorizado NO coincide con QB_REALM_ID del .env', {
        env: process.env.QB_REALM_ID,
        autorizado: realmId,
      });
    }

    const data = await pedirTokens({
      grant_type: 'authorization_code',
      code,
      redirect_uri: QB_REDIRECT_URI,
    });

    tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      realmId, // usamos el realmId real que autorizó el usuario
    };
    await guardarTokens();

    log('✅ Conectado a QuickBooks', {
      realmId,
      accessTokenExpiraEnSeg: data.expires_in,
      refreshTokenExpiraEnSeg: data.x_refresh_token_expires_in,
    });

    res.redirect('/empresa');
  } catch (error) {
    manejarError(res, error);
  }
});

// 3) Datos de la empresa
app.get('/empresa', async (req, res) => {
  try {
    const data = await qb(`/companyinfo/${tokens.realmId}`);
    log('🏢 Empresa', data.CompanyInfo);
    res.json(data.CompanyInfo);
  } catch (error) {
    manejarError(res, error);
  }
});

// 4) Clientes
app.get('/clientes', async (req, res) => {
  try {
    const data = await query('select * from Customer maxresults 10');
    const lista = data.QueryResponse.Customer ?? [];
    log(`👥 Clientes (${lista.length})`, lista.map((c) => ({ Id: c.Id, DisplayName: c.DisplayName, Balance: c.Balance })));
    res.json(lista);
  } catch (error) {
    manejarError(res, error);
  }
});

// 5) Items (productos/servicios)
app.get('/items', async (req, res) => {
  try {
    const data = await query('select * from Item maxresults 10');
    const lista = data.QueryResponse.Item ?? [];
    log(`📦 Items (${lista.length})`, lista.map((i) => ({ Id: i.Id, Name: i.Name, Type: i.Type, UnitPrice: i.UnitPrice })));
    res.json(lista);
  } catch (error) {
    manejarError(res, error);
  }
});

// 6) Crear cliente
const crearCliente = () =>
  qb('/customer', {
    method: 'POST',
    body: {
      DisplayName: `Florist Test ${Date.now()}`,
      GivenName: 'Florist',
      FamilyName: 'Test',
      PrimaryEmailAddr: { Address: 'florist.test@example.com' },
    },
  });

app.get('/crear-cliente', async (req, res) => {
  try {
    const data = await crearCliente();
    log('✅ Cliente creado', { Id: data.Customer.Id, DisplayName: data.Customer.DisplayName });
    res.json(data.Customer);
  } catch (error) {
    manejarError(res, error);
  }
});

// 7) Crear factura de prueba (cliente nuevo + primer item de tipo Service)
app.get('/crear-factura', async (req, res) => {
  try {
    const { Customer } = await crearCliente();
    log('Cliente para la factura', { Id: Customer.Id, DisplayName: Customer.DisplayName });

    const items = await query("select * from Item where Type = 'Service' maxresults 1");
    const item = items.QueryResponse.Item?.[0];
    if (!item) throw new Error('No hay items de tipo Service en la empresa sandbox. Creá uno en QuickBooks.');
    log('Item usado', { Id: item.Id, Name: item.Name });

    const data = await qb('/invoice', {
      method: 'POST',
      body: {
        CustomerRef: { value: Customer.Id },
        Line: [
          {
            Amount: 100,
            DetailType: 'SalesItemLineDetail',
            Description: 'Prueba de integración Speaking Roses',
            SalesItemLineDetail: { ItemRef: { value: item.Id }, Qty: 1, UnitPrice: 100 },
          },
        ],
      },
    });

    log('✅ Factura creada', {
      Id: data.Invoice.Id,
      DocNumber: data.Invoice.DocNumber,
      Total: data.Invoice.TotalAmt,
      Cliente: data.Invoice.CustomerRef,
    });
    res.json(data.Invoice);
  } catch (error) {
    manejarError(res, error);
  }
});

// 8) Forzar refresh
app.get('/refrescar', async (req, res) => {
  try {
    await refrescarAccessToken();
    res.json({ ok: true });
  } catch (error) {
    manejarError(res, error);
  }
});

await cargarTokens();

app.listen(PORT, () => {
  console.log(`\n🚀 Test QuickBooks en http://localhost:${PORT}`);
  console.log(`   Entorno: ${esSandbox ? 'SANDBOX' : 'PRODUCCIÓN ⚠️'}`);
  console.log(`   Redirect URI: ${QB_REDIRECT_URI}`);
  console.log('   Abrí la página y empezá por "Conectar con QuickBooks"\n');
});