// migrar.js
// ============================================================
// Verifica y carga todas las tablas + asigna rol admin
// ============================================================

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PUERTO),
  user: process.env.PG_USUARIO,
  password: process.env.PG_CONTRASENA,
  database: process.env.PG_BASE_DE_DATOS,
  ssl: process.env.PG_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

pool.on('error', (err) => {
  console.error('❌ Error inesperado en el pool:', err);
});

// ============================================================
// SQL DE TODAS LAS MIGRACIONES (en orden correcto)
// ============================================================

const MIGRACIONES = [
  {
    nombre: '01_roles',
    sql: `
      CREATE TABLE IF NOT EXISTS roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre VARCHAR(50) UNIQUE NOT NULL,
        descripcion VARCHAR(255),
        creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_roles_nombre ON roles (nombre);

      CREATE TABLE IF NOT EXISTS usuarios_roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        rol_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        asignado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        asignado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        UNIQUE (usuario_id, rol_id)
      );

      CREATE INDEX IF NOT EXISTS idx_usuarios_roles_usuario
        ON usuarios_roles (usuario_id);
      CREATE INDEX IF NOT EXISTS idx_usuarios_roles_rol
        ON usuarios_roles (rol_id);

      INSERT INTO roles (nombre, descripcion) VALUES
        ('admin',    'Administrador con acceso total al sistema'),
        ('vendedor', 'Puede gestionar ventas y productos'),
        ('cliente',  'Usuario final que compra o consulta')
      ON CONFLICT (nombre) DO NOTHING;

      CREATE OR REPLACE FUNCTION asignar_rol_cliente_por_defecto()
      RETURNS TRIGGER AS $$
      DECLARE
        rol_cliente_id UUID;
      BEGIN
        SELECT id INTO rol_cliente_id FROM roles WHERE nombre = 'cliente';
        IF rol_cliente_id IS NOT NULL THEN
          INSERT INTO usuarios_roles (usuario_id, rol_id)
          VALUES (NEW.id, rol_cliente_id)
          ON CONFLICT DO NOTHING;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_usuario_rol_cliente ON usuarios;
      CREATE TRIGGER trg_usuario_rol_cliente
      AFTER INSERT ON usuarios
      FOR EACH ROW
      EXECUTE FUNCTION asignar_rol_cliente_por_defecto();
    `,
  },

  {
    nombre: '02_usuarios_detalles',
    sql: `
      CREATE TABLE IF NOT EXISTS usuarios_detalles (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id            UUID UNIQUE NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        nombre                VARCHAR(120),
        apellido              VARCHAR(120),
        nombre_tienda         VARCHAR(120),
        contacto              VARCHAR(120),
        sitio_web             VARCHAR(255),
        tax_id                VARCHAR(60),
        telefono              VARCHAR(40),
        direccion             TEXT,
        ciudad                VARCHAR(120),
        provincia             VARCHAR(120),
        codigo_postal         VARCHAR(20),
        pais                  VARCHAR(120),
        avatar_url            TEXT,
        idioma                VARCHAR(5)  NOT NULL DEFAULT 'es',
        zona_horaria          VARCHAR(60) NOT NULL DEFAULT 'America/New_York',
        formato_fecha         VARCHAR(20) NOT NULL DEFAULT 'DD/MM/YYYY',
        moneda                VARCHAR(10) NOT NULL DEFAULT 'USD',
        notif_autoship        BOOLEAN NOT NULL DEFAULT TRUE,
        notif_factura         BOOLEAN NOT NULL DEFAULT TRUE,
        notif_diseno          BOOLEAN NOT NULL DEFAULT TRUE,
        notif_pedido          BOOLEAN NOT NULL DEFAULT TRUE,
        notif_marketing       BOOLEAN NOT NULL DEFAULT FALSE,
        canal_email           BOOLEAN NOT NULL DEFAULT TRUE,
        canal_whatsapp        BOOLEAN NOT NULL DEFAULT FALSE,
        canal_sms             BOOLEAN NOT NULL DEFAULT FALSE,
        activo                BOOLEAN NOT NULL DEFAULT TRUE,
        creado_en             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_usuarios_detalles_usuario
        ON usuarios_detalles (usuario_id);
      CREATE INDEX IF NOT EXISTS idx_usuarios_detalles_activo
        ON usuarios_detalles (activo);

      CREATE OR REPLACE FUNCTION crear_detalle_usuario_por_defecto()
      RETURNS TRIGGER AS $$
      BEGIN
        INSERT INTO usuarios_detalles (usuario_id, nombre)
        VALUES (NEW.id, NEW.nombre)
        ON CONFLICT (usuario_id) DO NOTHING;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_usuario_detalle_auto ON usuarios;
      CREATE TRIGGER trg_usuario_detalle_auto
      AFTER INSERT ON usuarios
      FOR EACH ROW
      EXECUTE FUNCTION crear_detalle_usuario_por_defecto();

      INSERT INTO usuarios_detalles (usuario_id, nombre)
      SELECT id, nombre FROM usuarios
      ON CONFLICT (usuario_id) DO NOTHING;
    `,
  },

  {
    nombre: '03_rose_library',
    sql: `
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS catalogo_colores (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        codigo          VARCHAR(20)  NOT NULL UNIQUE,
        nombre          VARCHAR(50)  NOT NULL,
        slug            VARCHAR(50)  NOT NULL UNIQUE,
        hex             VARCHAR(9)   NOT NULL,
        edge            VARCHAR(9)   NOT NULL,
        ink             VARCHAR(9)   NOT NULL,
        orden           INTEGER      NOT NULL DEFAULT 0,
        activo          BOOLEAN      NOT NULL DEFAULT TRUE,
        creado_en       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_colores_slug   ON catalogo_colores (slug);
      CREATE INDEX IF NOT EXISTS idx_colores_activo ON catalogo_colores (activo);

      CREATE TABLE IF NOT EXISTS catalogo_categorias (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre_es       VARCHAR(80)  NOT NULL,
        nombre_en       VARCHAR(80)  NOT NULL,
        slug            VARCHAR(80)  NOT NULL UNIQUE,
        orden           INTEGER      NOT NULL DEFAULT 0,
        activo          BOOLEAN      NOT NULL DEFAULT TRUE,
        creado_en       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_categorias_slug   ON catalogo_categorias (slug);
      CREATE INDEX IF NOT EXISTS idx_categorias_activo ON catalogo_categorias (activo);

      CREATE TABLE IF NOT EXISTS catalogo_frases (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        categoria_id    UUID         NOT NULL REFERENCES catalogo_categorias(id) ON DELETE CASCADE,
        texto           VARCHAR(150) NOT NULL,
        slug            VARCHAR(150) NOT NULL,
        orden           INTEGER      NOT NULL DEFAULT 0,
        activo          BOOLEAN      NOT NULL DEFAULT TRUE,
        creado_en       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        UNIQUE (categoria_id, slug)
      );

      CREATE INDEX IF NOT EXISTS idx_frases_categoria ON catalogo_frases (categoria_id);
      CREATE INDEX IF NOT EXISTS idx_frases_activo    ON catalogo_frases (activo);

      CREATE TABLE IF NOT EXISTS biblioteca_imagenes (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tipo              VARCHAR(20)  NOT NULL,
        color_id          UUID         REFERENCES catalogo_colores(id) ON DELETE CASCADE,
        frase_id          UUID         REFERENCES catalogo_frases(id) ON DELETE CASCADE,
        slot_id           VARCHAR(80)  NOT NULL,
        ruta_relativa     TEXT         NOT NULL,
        uuid_archivo      UUID         NOT NULL,
        nombre_original   VARCHAR(255) NOT NULL,
        mime_type         VARCHAR(80)  NOT NULL,
        extension         VARCHAR(10)  NOT NULL,
        ancho             INTEGER,
        alto              INTEGER,
        tamano_bytes      BIGINT       NOT NULL,
        hash_sha256       VARCHAR(64)  NOT NULL,
        version           INTEGER      NOT NULL DEFAULT 1,
        activo            BOOLEAN      NOT NULL DEFAULT TRUE,
        subido_por        UUID         REFERENCES usuarios(id) ON DELETE SET NULL,
        creado_en         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        actualizado_en    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      ALTER TABLE biblioteca_imagenes
        DROP CONSTRAINT IF EXISTS biblioteca_imagenes_tipo_check;

      ALTER TABLE biblioteca_imagenes
        ADD CONSTRAINT biblioteca_imagenes_tipo_check
        CHECK (tipo IN ('boxphoto', 'customrose', 'rosephoto', 'frasephoto'));

      ALTER TABLE biblioteca_imagenes
        DROP CONSTRAINT IF EXISTS chk_frasephoto_requiere_frase_color;

      ALTER TABLE biblioteca_imagenes
        ADD CONSTRAINT chk_frasephoto_requiere_frase_color
        CHECK (
          (tipo = 'frasephoto' AND frase_id IS NOT NULL AND color_id IS NOT NULL)
          OR
          (tipo IN ('boxphoto', 'customrose', 'rosephoto') AND frase_id IS NULL)
        );

      CREATE UNIQUE INDEX IF NOT EXISTS uniq_biblioteca_slot_activo
        ON biblioteca_imagenes (slot_id)
        WHERE activo = TRUE;

      CREATE INDEX IF NOT EXISTS idx_biblioteca_color  ON biblioteca_imagenes (color_id);
      CREATE INDEX IF NOT EXISTS idx_biblioteca_frase  ON biblioteca_imagenes (frase_id);
      CREATE INDEX IF NOT EXISTS idx_biblioteca_tipo   ON biblioteca_imagenes (tipo);
      CREATE INDEX IF NOT EXISTS idx_biblioteca_activo ON biblioteca_imagenes (activo);
      CREATE INDEX IF NOT EXISTS idx_biblioteca_hash   ON biblioteca_imagenes (hash_sha256);

      CREATE TABLE IF NOT EXISTS print_areas (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        color_id        UUID         NOT NULL UNIQUE REFERENCES catalogo_colores(id) ON DELETE CASCADE,
        x               NUMERIC(6,3) NOT NULL DEFAULT 24.000,
        y               NUMERIC(6,3) NOT NULL DEFAULT 30.000,
        w               NUMERIC(6,3) NOT NULL DEFAULT 52.000,
        h               NUMERIC(6,3) NOT NULL DEFAULT 36.000,
        creado_en       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      INSERT INTO catalogo_colores (codigo, nombre, slug, hex, edge, ink, orden) VALUES
        ('WHI 01', 'White', 'white', '#f1ece6', '#d9d1c8', '#a8843f', 1),
        ('RED 02', 'Red',   'red',   '#a3141c', '#6e0a10', '#e7c675', 2),
        ('PIN 99', 'Pink',  'pink',  '#f0b9c6', '#d98ea2', '#8a5a1f', 3)
      ON CONFLICT (slug) DO NOTHING;

      INSERT INTO catalogo_categorias (nombre_es, nombre_en, slug, orden) VALUES
        ('Funeral',     'Funeral',     'funeral',     1),
        ('Aniversario', 'Anniversary', 'anniversary', 2),
        ('Cumpleaños',  'Birthday',    'birthday',    3)
      ON CONFLICT (slug) DO NOTHING;

      INSERT INTO catalogo_frases (categoria_id, texto, slug, orden)
      SELECT c.id, f.texto, f.slug, f.orden
      FROM catalogo_categorias c,
        (VALUES
          ('In Loving Memory',       'in-loving-memory',       1),
          ('Forever In Our Hearts',  'forever-in-our-hearts',  2),
          ('Sending Love & Prayers', 'sending-love-prayers',   3)
        ) AS f(texto, slug, orden)
      WHERE c.slug = 'funeral'
      ON CONFLICT (categoria_id, slug) DO NOTHING;

      INSERT INTO catalogo_frases (categoria_id, texto, slug, orden)
      SELECT c.id, f.texto, f.slug, f.orden
      FROM catalogo_categorias c,
        (VALUES
          ('I Love You',        'i-love-you',        1),
          ('Endless Love',      'endless-love',      2),
          ('Happy Anniversary', 'happy-anniversary', 3)
        ) AS f(texto, slug, orden)
      WHERE c.slug = 'anniversary'
      ON CONFLICT (categoria_id, slug) DO NOTHING;

      INSERT INTO catalogo_frases (categoria_id, texto, slug, orden)
      SELECT c.id, f.texto, f.slug, f.orden
      FROM catalogo_categorias c,
        (VALUES
          ('Happy Birthday', 'happy-birthday', 1),
          ('Best Wishes',    'best-wishes',    2),
          ('Make A Wish',    'make-a-wish',    3)
        ) AS f(texto, slug, orden)
      WHERE c.slug = 'birthday'
      ON CONFLICT (categoria_id, slug) DO NOTHING;

      INSERT INTO print_areas (color_id, x, y, w, h)
      SELECT id, 24, 30, 52, 36
      FROM catalogo_colores
      ON CONFLICT (color_id) DO NOTHING;
    `,
  },

  {
    nombre: '04_precios_v2',
    sql: `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      ALTER TABLE usuarios
        ADD COLUMN IF NOT EXISTS referido_por UUID
        REFERENCES usuarios(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_usuarios_referido_por
        ON usuarios (referido_por);

      CREATE TABLE IF NOT EXISTS configuracion_precios (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        autoship_precio_por_rosa NUMERIC(10,2) NOT NULL DEFAULT 5.99,
        onetime_precio_por_rosa NUMERIC(10,2) NOT NULL DEFAULT 7.99,
        autoship_min_cajas INTEGER NOT NULL DEFAULT 17,
        onetime_min_cajas INTEGER NOT NULL DEFAULT 1,
        rosas_por_caja INTEGER NOT NULL DEFAULT 6,
        personalizacion_texto_precio NUMERIC(10,2) NOT NULL DEFAULT 9.99,
        personalizacion_foto_precio NUMERIC(10,2) NOT NULL DEFAULT 14.99,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        vigente_desde TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_autoship_positivo CHECK (autoship_precio_por_rosa > 0),
        CONSTRAINT chk_onetime_positivo CHECK (onetime_precio_por_rosa > 0),
        CONSTRAINT chk_autoship_min_pos CHECK (autoship_min_cajas >= 1),
        CONSTRAINT chk_onetime_min_pos CHECK (onetime_min_cajas >= 1),
        CONSTRAINT chk_rosas_por_caja_pos CHECK (rosas_por_caja >= 1),
        CONSTRAINT chk_texto_positivo CHECK (personalizacion_texto_precio >= 0),
        CONSTRAINT chk_foto_positivo CHECK (personalizacion_foto_precio >= 0)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uniq_precios_activo
        ON configuracion_precios (activo)
        WHERE activo = TRUE;

      CREATE TABLE IF NOT EXISTS vendedores_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID UNIQUE NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        costo_autoship_precio_por_rosa NUMERIC(10,2) NOT NULL DEFAULT 4.50,
        costo_onetime_precio_por_rosa NUMERIC(10,2) NOT NULL DEFAULT 5.50,
        costo_personalizacion_texto_precio NUMERIC(10,2) NOT NULL DEFAULT 7.00,
        costo_personalizacion_foto_precio NUMERIC(10,2) NOT NULL DEFAULT 10.00,
        venta_autoship_precio_por_rosa NUMERIC(10,2),
        venta_onetime_precio_por_rosa NUMERIC(10,2),
        venta_personalizacion_texto_precio NUMERIC(10,2),
        venta_personalizacion_foto_precio NUMERIC(10,2),
        max_autoship_precio_por_rosa NUMERIC(10,2),
        max_onetime_precio_por_rosa NUMERIC(10,2),
        max_personalizacion_texto_precio NUMERIC(10,2),
        max_personalizacion_foto_precio NUMERIC(10,2),
        min_sugerido_autoship_precio_por_rosa NUMERIC(10,2),
        min_sugerido_onetime_precio_por_rosa NUMERIC(10,2),
        nombre_comercial VARCHAR(120),
        logo_url TEXT,
        color_marca VARCHAR(9),
        notas TEXT,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_costo_autoship_pos CHECK (costo_autoship_precio_por_rosa > 0),
        CONSTRAINT chk_costo_onetime_pos CHECK (costo_onetime_precio_por_rosa > 0),
        CONSTRAINT chk_costo_texto_pos CHECK (costo_personalizacion_texto_precio >= 0),
        CONSTRAINT chk_costo_foto_pos CHECK (costo_personalizacion_foto_precio >= 0)
      );

      CREATE INDEX IF NOT EXISTS idx_vendedores_config_activo
        ON vendedores_config (activo);

      CREATE TABLE IF NOT EXISTS precios_historial (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('global', 'costo', 'venta')),
        referencia_id UUID,
        usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        cambios JSONB NOT NULL,
        notas TEXT,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_historial_tipo ON precios_historial (tipo);
      CREATE INDEX IF NOT EXISTS idx_historial_usuario ON precios_historial (usuario_id);
      CREATE INDEX IF NOT EXISTS idx_historial_creado ON precios_historial (creado_en DESC);

      INSERT INTO configuracion_precios (
        autoship_precio_por_rosa,
        onetime_precio_por_rosa,
        autoship_min_cajas,
        onetime_min_cajas,
        rosas_por_caja,
        personalizacion_texto_precio,
        personalizacion_foto_precio,
        activo
      )
      SELECT 5.99, 7.99, 17, 1, 6, 9.99, 14.99, TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM configuracion_precios WHERE activo = TRUE
      );

      CREATE OR REPLACE FUNCTION obtener_precios_vigentes()
      RETURNS TABLE (
        id UUID,
        autoship_precio_por_rosa NUMERIC,
        onetime_precio_por_rosa NUMERIC,
        autoship_min_cajas INTEGER,
        onetime_min_cajas INTEGER,
        rosas_por_caja INTEGER,
        personalizacion_texto_precio NUMERIC,
        personalizacion_foto_precio NUMERIC
      )
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RETURN QUERY
        SELECT
          cp.id,
          cp.autoship_precio_por_rosa,
          cp.onetime_precio_por_rosa,
          cp.autoship_min_cajas,
          cp.onetime_min_cajas,
          cp.rosas_por_caja,
          cp.personalizacion_texto_precio,
          cp.personalizacion_foto_precio
        FROM configuracion_precios cp
        WHERE cp.activo = TRUE
        ORDER BY cp.vigente_desde DESC
        LIMIT 1;
      END;
      $$;

      CREATE OR REPLACE FUNCTION obtener_precio_para_usuario(
        p_usuario_id UUID
      )
      RETURNS TABLE (
        autoship_precio_por_rosa NUMERIC,
        onetime_precio_por_rosa NUMERIC,
        personalizacion_texto_precio NUMERIC,
        personalizacion_foto_precio NUMERIC,
        tipo_precio VARCHAR
      )
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_precios RECORD;
        v_rol TEXT;
        v_referido_por UUID;
        v_vendedor RECORD;
      BEGIN
        SELECT * INTO v_precios FROM obtener_precios_vigentes();
        IF NOT FOUND THEN
          RAISE EXCEPTION 'No hay configuración de precios activa';
        END IF;

        SELECT r.nombre INTO v_rol
        FROM usuarios_roles ur
        INNER JOIN roles r ON r.id = ur.rol_id
        WHERE ur.usuario_id = p_usuario_id
        ORDER BY CASE r.nombre
          WHEN 'admin' THEN 1
          WHEN 'vendedor' THEN 2
          WHEN 'cliente' THEN 3
          ELSE 4
        END
        LIMIT 1;

        IF v_rol = 'admin' THEN
          RETURN QUERY SELECT
            v_precios.autoship_precio_por_rosa,
            v_precios.onetime_precio_por_rosa,
            v_precios.personalizacion_texto_precio,
            v_precios.personalizacion_foto_precio,
            'global'::VARCHAR;
          RETURN;
        END IF;

        IF v_rol = 'vendedor' THEN
          SELECT * INTO v_vendedor FROM vendedores_config
          WHERE usuario_id = p_usuario_id AND activo = TRUE;

          IF FOUND THEN
            RETURN QUERY SELECT
              v_vendedor.costo_autoship_precio_por_rosa,
              v_vendedor.costo_onetime_precio_por_rosa,
              v_vendedor.costo_personalizacion_texto_precio,
              v_vendedor.costo_personalizacion_foto_precio,
              'costo'::VARCHAR;
            RETURN;
          END IF;

          RETURN QUERY SELECT
            v_precios.autoship_precio_por_rosa,
            v_precios.onetime_precio_por_rosa,
            v_precios.personalizacion_texto_precio,
            v_precios.personalizacion_foto_precio,
            'global'::VARCHAR;
          RETURN;
        END IF;

        SELECT u.referido_por INTO v_referido_por
        FROM usuarios u WHERE u.id = p_usuario_id;

        IF v_referido_por IS NOT NULL THEN
          SELECT * INTO v_vendedor FROM vendedores_config
          WHERE usuario_id = v_referido_por AND activo = TRUE;

          IF FOUND THEN
            RETURN QUERY SELECT
              COALESCE(v_vendedor.venta_autoship_precio_por_rosa, v_vendedor.costo_autoship_precio_por_rosa),
              COALESCE(v_vendedor.venta_onetime_precio_por_rosa, v_vendedor.costo_onetime_precio_por_rosa),
              COALESCE(v_vendedor.venta_personalizacion_texto_precio, v_vendedor.costo_personalizacion_texto_precio),
              COALESCE(v_vendedor.venta_personalizacion_foto_precio, v_vendedor.costo_personalizacion_foto_precio),
              'venta'::VARCHAR;
            RETURN;
          END IF;
        END IF;

        RETURN QUERY SELECT
          v_precios.autoship_precio_por_rosa,
          v_precios.onetime_precio_por_rosa,
          v_precios.personalizacion_texto_precio,
          v_precios.personalizacion_foto_precio,
          'global'::VARCHAR;
      END;
      $$;
    `,
  },

  {
    nombre: '05_pedidos_pagos',
    sql: `
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS pedidos (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        numero                VARCHAR(20) UNIQUE NOT NULL,
        usuario_id            UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
        vendedor_id           UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        programa              VARCHAR(20) NOT NULL CHECK (programa IN ('autoship', 'onetime')),
        cajas                 INTEGER NOT NULL DEFAULT 0,
        rosas                 INTEGER NOT NULL DEFAULT 0,
        precio_por_rosa       NUMERIC(10,2) NOT NULL DEFAULT 0,
        subtotal              NUMERIC(10,2) NOT NULL DEFAULT 0,
        impuesto              NUMERIC(10,2) NOT NULL DEFAULT 0,
        total                 NUMERIC(10,2) NOT NULL DEFAULT 0,
        moneda                VARCHAR(3) NOT NULL DEFAULT 'USD',
        envio_nombre          VARCHAR(120),
        envio_email           VARCHAR(120),
        envio_telefono        VARCHAR(40),
        envio_direccion       TEXT,
        envio_ciudad          VARCHAR(120),
        envio_provincia       VARCHAR(120),
        envio_codigo_postal   VARCHAR(20),
        envio_pais            VARCHAR(120),
        fact_nombre           VARCHAR(120),
        fact_email            VARCHAR(120),
        fact_direccion        TEXT,
        fact_ciudad           VARCHAR(120),
        fact_provincia        VARCHAR(120),
        fact_codigo_postal    VARCHAR(20),
        fact_pais             VARCHAR(120),
        estado                VARCHAR(30) NOT NULL DEFAULT 'awaiting_payment'
                              CHECK (estado IN ('awaiting_payment','paid','paused_unpaid','cancelled','refunded')),
        client_ref            VARCHAR(80) UNIQUE NOT NULL,
        qbo_invoice_id        VARCHAR(80),
        qbo_invoice_number    VARCHAR(40),
        qbo_invoice_url       TEXT,
        qbo_customer_id       VARCHAR(80),
        qbo_enviada_en        TIMESTAMPTZ,
        pagado_en             TIMESTAMPTZ,
        recordatorio_en       TIMESTAMPTZ,
        pausado_en            TIMESTAMPTZ,
        notas                 TEXT,
        metadata              JSONB DEFAULT '{}'::jsonb,
        creado_en             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_pedido_cajas_pos CHECK (cajas >= 0),
        CONSTRAINT chk_pedido_rosas_pos CHECK (rosas >= 0),
        CONSTRAINT chk_pedido_total_pos CHECK (total >= 0)
      );

      CREATE INDEX IF NOT EXISTS idx_pedidos_usuario        ON pedidos (usuario_id);
      CREATE INDEX IF NOT EXISTS idx_pedidos_vendedor       ON pedidos (vendedor_id);
      CREATE INDEX IF NOT EXISTS idx_pedidos_estado         ON pedidos (estado);
      CREATE INDEX IF NOT EXISTS idx_pedidos_programa       ON pedidos (programa);
      CREATE INDEX IF NOT EXISTS idx_pedidos_creado         ON pedidos (creado_en DESC);
      CREATE INDEX IF NOT EXISTS idx_pedidos_client_ref     ON pedidos (client_ref);
      CREATE INDEX IF NOT EXISTS idx_pedidos_qbo_invoice    ON pedidos (qbo_invoice_id);

      CREATE SEQUENCE IF NOT EXISTS pedidos_numero_seq START 1;

      CREATE OR REPLACE FUNCTION generar_numero_pedido()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.numero IS NULL OR NEW.numero = '' THEN
          NEW.numero := 'SR-' || LPAD(nextval('pedidos_numero_seq')::TEXT, 6, '0');
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_pedido_numero ON pedidos;
      CREATE TRIGGER trg_pedido_numero
      BEFORE INSERT ON pedidos
      FOR EACH ROW
      EXECUTE FUNCTION generar_numero_pedido();

      CREATE TABLE IF NOT EXISTS pedido_items (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pedido_id             UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
        orden                 INTEGER NOT NULL DEFAULT 1,
        color_id              UUID REFERENCES catalogo_colores(id) ON DELETE SET NULL,
        color_codigo          VARCHAR(20),
        color_nombre          VARCHAR(50),
        tipo_mensaje          VARCHAR(20) NOT NULL DEFAULT 'standard'
                              CHECK (tipo_mensaje IN ('standard', 'custom')),
        categoria_id          UUID REFERENCES catalogo_categorias(id) ON DELETE SET NULL,
        categoria_nombre      VARCHAR(80),
        frase_id              UUID REFERENCES catalogo_frases(id) ON DELETE SET NULL,
        frase_texto           VARCHAR(150),
        custom_mode           VARCHAR(20) CHECK (custom_mode IN ('phrase', 'file')),
        custom_lines          JSONB,
        custom_font           VARCHAR(20),
        design_image_url      TEXT,
        design_sig            VARCHAR(128),
        design_content        JSONB DEFAULT NULL,
        recurring             BOOLEAN,
        replacement_color     VARCHAR(20),
        replacement_categoria VARCHAR(80),
        replacement_frase     VARCHAR(150),
        cajas                 INTEGER NOT NULL DEFAULT 1,
        rosas                 INTEGER NOT NULL DEFAULT 6,
        precio_por_rosa       NUMERIC(10,2) NOT NULL DEFAULT 0,
        precio_personalizacion NUMERIC(10,2) NOT NULL DEFAULT 0,
        subtotal              NUMERIC(10,2) NOT NULL DEFAULT 0,
        metadata              JSONB DEFAULT '{}'::jsonb,
        creado_en             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_pedido_items_pedido    ON pedido_items (pedido_id);
      CREATE INDEX IF NOT EXISTS idx_pedido_items_color     ON pedido_items (color_id);
      CREATE INDEX IF NOT EXISTS idx_pedido_items_frase     ON pedido_items (frase_id);
      CREATE INDEX IF NOT EXISTS idx_pedido_items_orden     ON pedido_items (pedido_id, orden);
      CREATE INDEX IF NOT EXISTS idx_pedido_items_design_sig
        ON pedido_items (design_sig) WHERE design_sig IS NOT NULL;

      CREATE TABLE IF NOT EXISTS pagos (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pedido_id             UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
        proveedor             VARCHAR(20) NOT NULL
                              CHECK (proveedor IN ('paypal', 'venmo', 'quickbooks', 'otro')),
        proveedor_order_id    VARCHAR(120),
        proveedor_capture_id  VARCHAR(120),
        proveedor_payer_id    VARCHAR(120),
        proveedor_invoice_id  VARCHAR(120),
        monto                 NUMERIC(10,2) NOT NULL,
        moneda                VARCHAR(3) NOT NULL DEFAULT 'USD',
        comision              NUMERIC(10,2) DEFAULT 0,
        monto_neto            NUMERIC(10,2) DEFAULT 0,
        estado                VARCHAR(30) NOT NULL DEFAULT 'pendiente'
                              CHECK (estado IN ('pendiente','aprobado','completado','rechazado','cancelado','reembolsado','fallido')),
        respuesta             JSONB DEFAULT '{}'::jsonb,
        metadata              JSONB DEFAULT '{}'::jsonb,
        creado_en             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_pagos_pedido           ON pagos (pedido_id);
      CREATE INDEX IF NOT EXISTS idx_pagos_proveedor        ON pagos (proveedor);
      CREATE INDEX IF NOT EXISTS idx_pagos_estado           ON pagos (estado);
      CREATE INDEX IF NOT EXISTS idx_pagos_order_id         ON pagos (proveedor_order_id);
      CREATE INDEX IF NOT EXISTS idx_pagos_capture_id       ON pagos (proveedor_capture_id);
      CREATE INDEX IF NOT EXISTS idx_pagos_creado           ON pagos (creado_en DESC);

      CREATE TABLE IF NOT EXISTS suscripciones (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id            UUID UNIQUE NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        vendedor_id           UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        estado                VARCHAR(30) NOT NULL DEFAULT 'active'
                              CHECK (estado IN ('active','paused_unpaid','paused','cancelled')),
        fecha_inicio          DATE NOT NULL DEFAULT CURRENT_DATE,
        proxima_fecha         DATE NOT NULL,
        ultimo_pedido_id      UUID REFERENCES pedidos(id) ON DELETE SET NULL,
        ultimo_pedido_en      TIMESTAMPTZ,
        plan                  JSONB NOT NULL DEFAULT '[]'::jsonb,
        cajas_por_mes         INTEGER NOT NULL DEFAULT 17,
        rosas_por_mes         INTEGER NOT NULL DEFAULT 102,
        cambios_historial     JSONB DEFAULT '[]'::jsonb,
        metadata              JSONB DEFAULT '{}'::jsonb,
        creado_en             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_suscripciones_usuario        ON suscripciones (usuario_id);
      CREATE INDEX IF NOT EXISTS idx_suscripciones_vendedor       ON suscripciones (vendedor_id);
      CREATE INDEX IF NOT EXISTS idx_suscripciones_estado         ON suscripciones (estado);
      CREATE INDEX IF NOT EXISTS idx_suscripciones_proxima        ON suscripciones (proxima_fecha);

      CREATE TABLE IF NOT EXISTS disenos_pagados (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id            UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        firma                 VARCHAR(128) NOT NULL,
        tipo                  VARCHAR(20) NOT NULL CHECK (tipo IN ('texto', 'foto')),
        color_codigo          VARCHAR(20),
        contenido             JSONB,
        precio                NUMERIC(10,2) NOT NULL DEFAULT 0,
        pedido_id             UUID REFERENCES pedidos(id) ON DELETE SET NULL,
        creado_en             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uniq_diseno_usuario_firma
        ON disenos_pagados (usuario_id, firma);

      CREATE INDEX IF NOT EXISTS idx_disenos_usuario       ON disenos_pagados (usuario_id);
      CREATE INDEX IF NOT EXISTS idx_disenos_firma         ON disenos_pagados (firma);
      CREATE INDEX IF NOT EXISTS idx_disenos_creado        ON disenos_pagados (creado_en DESC);

      CREATE TABLE IF NOT EXISTS auditoria (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id            UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        accion                VARCHAR(80) NOT NULL,
        entidad               VARCHAR(80),
        entidad_id            UUID,
        cambios               JSONB DEFAULT '{}'::jsonb,
        ip                    VARCHAR(45),
        user_agent            TEXT,
        creado_en             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_auditoria_usuario      ON auditoria (usuario_id);
      CREATE INDEX IF NOT EXISTS idx_auditoria_accion       ON auditoria (accion);
      CREATE INDEX IF NOT EXISTS idx_auditoria_entidad      ON auditoria (entidad, entidad_id);
      CREATE INDEX IF NOT EXISTS idx_auditoria_creado       ON auditoria (creado_en DESC);

      CREATE OR REPLACE FUNCTION recalcular_totales_pedido(p_pedido_id UUID)
      RETURNS VOID AS $$
      DECLARE
        v_cajas INTEGER;
        v_rosas INTEGER;
        v_subtotal NUMERIC(10,2);
      BEGIN
        SELECT
          COALESCE(SUM(cajas), 0),
          COALESCE(SUM(rosas), 0),
          COALESCE(SUM(subtotal), 0)
        INTO v_cajas, v_rosas, v_subtotal
        FROM pedido_items
        WHERE pedido_id = p_pedido_id;

        UPDATE pedidos
        SET cajas = v_cajas,
            rosas = v_rosas,
            subtotal = v_subtotal,
            total = v_subtotal + impuesto,
            actualizado_en = NOW()
        WHERE id = p_pedido_id;
      END;
      $$ LANGUAGE plpgsql;

      CREATE OR REPLACE FUNCTION set_actualizado_en()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.actualizado_en := NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_pedidos_actualizado ON pedidos;
      CREATE TRIGGER trg_pedidos_actualizado
      BEFORE UPDATE ON pedidos
      FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

      DROP TRIGGER IF EXISTS trg_pedido_items_actualizado ON pedido_items;
      CREATE TRIGGER trg_pedido_items_actualizado
      BEFORE UPDATE ON pedido_items
      FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

      DROP TRIGGER IF EXISTS trg_pagos_actualizado ON pagos;
      CREATE TRIGGER trg_pagos_actualizado
      BEFORE UPDATE ON pagos
      FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

      DROP TRIGGER IF EXISTS trg_suscripciones_actualizado ON suscripciones;
      CREATE TRIGGER trg_suscripciones_actualizado
      BEFORE UPDATE ON suscripciones
      FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

      CREATE OR REPLACE VIEW v_pedidos_completo AS
      SELECT
        p.*,
        u.correo          AS cliente_correo,
        u.nombre          AS cliente_nombre,
        ud.nombre_tienda  AS cliente_tienda,
        v.correo          AS vendedor_correo,
        v.nombre          AS vendedor_nombre,
        vc.nombre_comercial AS vendedor_comercial
      FROM pedidos p
      LEFT JOIN usuarios u ON u.id = p.usuario_id
      LEFT JOIN usuarios_detalles ud ON ud.usuario_id = p.usuario_id
      LEFT JOIN usuarios v ON v.id = p.vendedor_id
      LEFT JOIN vendedores_config vc ON vc.usuario_id = p.vendedor_id;
    `,
  },
];

// ============================================================
// HELPERS
// ============================================================

async function tablasExistentes() {
  const { rows } = await pool.query(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `);
  return new Set(rows.map((r) => r.tablename));
}

async function ejecutarMigracion({ nombre, sql }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log(`   ✅ ${nombre} OK`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`   ❌ ${nombre} falló:`, err.message);
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================
// ASIGNAR ROL ADMIN (reemplazando todos los roles)
// ============================================================

async function asignarAdmin(correo = 'portafolioivan2026@gmail.com') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verificar que el usuario exista
    const { rows: usuarioRows } = await client.query(
      'SELECT id, correo FROM usuarios WHERE correo = $1',
      [correo]
    );

    if (usuarioRows.length === 0) {
      console.log(`\n⚠️  Usuario ${correo} NO existe. No se asignó rol.`);
      await client.query('ROLLBACK');
      return;
    }

    const usuarioId = usuarioRows[0].id;
    console.log(`\n👤 Usuario encontrado: ${correo} (${usuarioId})`);

    // Paso 1: eliminar TODOS los roles actuales
    const del = await client.query(
      'DELETE FROM usuarios_roles WHERE usuario_id = $1',
      [usuarioId]
    );
    console.log(`   🗑️  Roles eliminados: ${del.rowCount}`);

    // Paso 2: asignar únicamente el rol admin
    const ins = await client.query(
      `INSERT INTO usuarios_roles (usuario_id, rol_id)
       SELECT $1, r.id FROM roles r WHERE r.nombre = 'admin'
       ON CONFLICT (usuario_id, rol_id) DO NOTHING`,
      [usuarioId]
    );
    console.log(`   ✅ Rol admin asignado (${ins.rowCount} fila)`);

    // Verificación
    const { rows: verificacion } = await client.query(
      `SELECT r.nombre AS rol, ur.asignado_en
       FROM usuarios_roles ur
       INNER JOIN roles r ON r.id = ur.rol_id
       WHERE ur.usuario_id = $1
       ORDER BY r.nombre`,
      [usuarioId]
    );
    console.log('   📋 Roles finales:', verificacion);

    await client.query('COMMIT');
    console.log('   ✅ Cambios confirmados (COMMIT)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('   ❌ Error asignando admin:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('🚀 Iniciando migración y verificación...\n');

  // 1. Probar conexión
  const { rows } = await pool.query(
    'SELECT NOW() AS ahora, current_database() AS db'
  );
  console.log(`✅ Conectado a "${rows[0].db}" (${rows[0].ahora})\n`);

  // 2. Cargar TODAS las migraciones (idempotentes)
  console.log('📦 Ejecutando migraciones (idempotentes)...');
  for (const migracion of MIGRACIONES) {
    console.log(`\n▶️  ${migracion.nombre}`);
    await ejecutarMigracion(migracion);
  }

  // 3. Verificar tablas resultantes
  console.log('\n🔍 Verificando tablas en la BD...');
  const existentes = await tablasExistentes();
  const requeridas = [
    'roles', 'usuarios_roles',
    'catalogo_colores', 'catalogo_categorias', 'catalogo_frases',
    'biblioteca_imagenes', 'print_areas',
    'configuracion_precios', 'vendedores_config', 'precios_historial',
    'usuarios_detalles',
    'pedidos', 'pedido_items', 'pagos', 'suscripciones',
    'disenos_pagados', 'auditoria',
  ];

  console.log('\n📊 Estado de tablas:');
  for (const t of requeridas) {
    console.log(`   ${existentes.has(t) ? '✅' : '❌'} ${t}`);
  }

  // 4. Asignar rol admin
  await asignarAdmin('portafolioivan2026@gmail.com');

  console.log('\n🎉 Proceso completado.\n');
}

main()
  .catch((err) => {
    console.error('\n💥 Error fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });