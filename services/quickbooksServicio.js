// backend/services/quickbooksServicio.js
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";

/* ============================================================
   QUICKBOOKS — Facturas + clientes
   ============================================================
   Reutiliza el archivo qb-tokens.json que generó test-quickbooks.js
   ============================================================ */

const esSandbox = process.env.QB_ENVIRONMENT !== "production";
const API_BASE = esSandbox
  ? "https://sandbox-quickbooks.api.intuit.com"
  : "https://quickbooks.api.intuit.com";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const MINOR_VERSION = 75;

const TOKENS_FILE = new URL("../../qb-tokens.json", import.meta.url);

const basicAuth = Buffer.from(
  `${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`
).toString("base64");

// Cache en memoria
let tokens = {
  accessToken: process.env.QB_ACCESS_TOKEN || null,
  refreshToken: process.env.QB_REFRESH_TOKEN || null,
  realmId: process.env.QB_REALM_ID || null,
};

/* ---------- Cargar tokens del archivo ---------- */
export async function cargarTokensQuickBooks() {
  try {
    const saved = JSON.parse(await readFile(TOKENS_FILE, "utf8"));
    tokens = { ...tokens, ...saved };
    return tokens;
  } catch {
    return tokens;
  }
}

async function guardarTokens() {
  try {
    await writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2));
  } catch { /* noop */ }
}

/* ---------- Refrescar access token ---------- */
async function refrescarAccessToken() {
  if (!tokens.refreshToken) {
    const err = new Error("QuickBooks no tiene refresh token. Reconectá la app.");
    err.estado = 401;
    throw err;
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    }).toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error("No se pudo refrescar el token de QuickBooks.");
    err.estado = res.status;
    err.detalle = data;
    throw err;
  }
  tokens.accessToken = data.access_token;
  if (data.refresh_token) tokens.refreshToken = data.refresh_token;
  await guardarTokens();
}

/* ---------- Llamada a la API ---------- */
async function qb(path, { method = "GET", body } = {}, reintento = true) {
  if (!tokens.accessToken || !tokens.realmId) {
    await cargarTokensQuickBooks();
  }
  if (!tokens.accessToken || !tokens.realmId) {
    const err = new Error("QuickBooks no está conectado. Corré test-quickbooks.js → /conectar.");
    err.estado = 401;
    throw err;
  }

  const sep = path.includes("?") ? "&" : "?";
  const url = `${API_BASE}/v3/company/${tokens.realmId}${path}${sep}minorversion=${MINOR_VERSION}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && reintento) {
    await refrescarAccessToken();
    return qb(path, { method, body }, false);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`QuickBooks respondió ${res.status}`);
    err.estado = res.status;
    err.detalle = data;
    throw err;
  }
  return data;
}

/* ============================================================
   API PÚBLICA
   ============================================================ */

/**
 * Busca un cliente por email. Si no existe, lo crea.
 */
export async function buscarOCrearCliente({ nombre, email, telefono, direccion }) {
  const emailLimpio = String(email || "").replace(/'/g, "");
  const q = `select * from Customer where PrimaryEmailAddr = '${emailLimpio}'`;
  const found = await qb(`/query?query=${encodeURIComponent(q)}`);
  const existing = found.QueryResponse?.Customer?.[0];
  if (existing) return existing.Id;

  const body = {
    DisplayName: nombre || email || "Cliente",
    PrimaryEmailAddr: { Address: email },
    ...(telefono ? { PrimaryPhone: { FreeFormNumber: telefono } } : {}),
    ...(direccion
      ? {
          BillAddr: {
            Line1: direccion.direccion || "",
            City: direccion.ciudad || "",
            CountrySubDivisionCode: direccion.provincia || "",
            PostalCode: direccion.codigo_postal || "",
            Country: direccion.pais || "US",
          },
        }
      : {}),
  };
  const created = await qb("/customer", { method: "POST", body });
  return created.Customer.Id;
}

/**
 * Crea una factura para un pedido.
 */
export async function crearFacturaDesdePedido(pedido, items) {
  const customerId = await buscarOCrearCliente({
    nombre: pedido.envio_nombre,
    email: pedido.envio_email,
    telefono: pedido.envio_telefono,
    direccion: {
      direccion: pedido.envio_direccion,
      ciudad: pedido.envio_ciudad,
      provincia: pedido.envio_provincia,
      codigo_postal: pedido.envio_codigo_postal,
      pais: pedido.envio_pais,
    },
  });

  const Line = items.map((it) => {
    const descripcion = [
      it.color_codigo,
      it.color_nombre,
      it.tipo_mensaje === "standard" ? it.frase_texto : "Custom",
      `${it.cajas} cajas × ${it.rosas} rosas`,
    ].filter(Boolean).join(" · ");

    return {
      Amount: Number(it.subtotal) || 0,
      DetailType: "SalesItemLineDetail",
      Description: descripcion,
      SalesItemLineDetail: {
        ItemRef: { value: "1", name: "Speaking Roses" },
        Qty: it.cajas,
        UnitPrice: Number(it.precio_por_rosa) || 0,
      },
    };
  });

  const body = {
    DocNumber: pedido.numero,
    CustomerRef: { value: customerId },
    BillEmail: { Address: pedido.envio_email },
    Line,
  };

  const data = await qb("/invoice", { method: "POST", body });
  const inv = data.Invoice;
  return {
    invoiceId: inv.Id,
    docNumber: inv.DocNumber,
    total: inv.TotalAmt,
    invoiceUrl: inv.InvoiceLink || null,
    customerId,
  };
}

export async function marcarFacturaPagada(invoiceId) {
  return null;
}

export function obtenerEstadoConexion() {
  return {
    conectado: Boolean(tokens.accessToken && tokens.realmId),
    realmId: tokens.realmId,
    entorno: esSandbox ? "sandbox" : "production",
  };
}