import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// Rutas base
// ============================================================
export const ALMACENAMIENTO_RAIZ = path.join(__dirname, '..', '..', 'almacenamiento');
export const ROSAS_RAIZ = path.join(ALMACENAMIENTO_RAIZ, 'rosas');

// ============================================================
// Reglas de validación
// ============================================================
export const TIPOS_PERMITIDOS = ['boxphoto', 'customrose', 'rosephoto', 'frasephoto'];

export const FORMATOS_PERMITIDOS = ['image/webp', 'image/png', 'image/jpeg'];
export const TAMANO_MAX_BYTES = 10 * 1024 * 1024;

export const DIMENSIONES = {
  minAncho: 200,
  minAlto: 200,
  maxAncho: 4000,
  maxAlto: 4000,
};

// ============================================================
// Helpers
// ============================================================
export function fechaHoy() {
  return new Date().toISOString().slice(0, 10);
}

export function rutaAbsoluta(tipo, slug, fecha, uuidArchivo, extension) {
  return path.join(ROSAS_RAIZ, tipo, slug, fecha, `${uuidArchivo}.${extension}`);
}

export function rutaRelativa(tipo, slug, fecha, uuidArchivo, extension) {
  return path
    .join('rosas', tipo, slug, fecha, `${uuidArchivo}.${extension}`)
    .replace(/\\/g, '/');
}

export function construirSlotId(tipo, slug) {
  return `sr-${tipo}-${slug}`;
}