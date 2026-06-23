import { SqlSchemaAnalyzerService } from './sql-schema-analyzer.service';

describe('SqlSchemaAnalyzerService', () => {
  const service = new SqlSchemaAnalyzerService();

  describe('Restricciones CHECK numéricas simples', () => {
    it('detecta CHECK inline de un solo lado (>=) en la columna', () => {
      const sql = `
        CREATE TABLE transacciones (
          id INT PRIMARY KEY,
          monto DECIMAL(12,2) NOT NULL CHECK (monto >= 0)
        );
      `;

      const result = service.analyze(sql, 'postgresql');
      const monto = result.schema!.tables[0].columns.find((c) => c.name === 'monto')!;

      expect(monto.checkMin).toBe(0);
      expect(monto.checkMax ?? null).toBeNull();
    });

    it('detecta CHECK a nivel de tabla con CONSTRAINT y BETWEEN', () => {
      const sql = `
        CREATE TABLE descuentos (
          id INT PRIMARY KEY,
          porcentaje DECIMAL(5,2) NOT NULL,
          CONSTRAINT chk_porcentaje CHECK (porcentaje BETWEEN 0 AND 100)
        );
      `;

      const result = service.analyze(sql, 'postgresql');
      const porcentaje = result.schema!.tables[0].columns.find(
        (c) => c.name === 'porcentaje',
      )!;

      expect(porcentaje.checkMin).toBe(0);
      expect(porcentaje.checkMax).toBe(100);
    });

    it('detecta CHECK combinado con dos comparaciones unidas por AND', () => {
      const sql = `
        CREATE TABLE inventario (
          id INT PRIMARY KEY,
          stock INT NOT NULL CHECK (stock >= 0 AND stock <= 10000)
        );
      `;

      const result = service.analyze(sql, 'postgresql');
      const stock = result.schema!.tables[0].columns.find((c) => c.name === 'stock')!;

      expect(stock.checkMin).toBe(0);
      expect(stock.checkMax).toBe(10000);
    });

    it('ignora un CHECK que no puede interpretar como rango numérico simple, sin fallar', () => {
      const sql = `
        CREATE TABLE pedidos (
          id INT PRIMARY KEY,
          fecha_entrega DATE,
          fecha_pedido DATE,
          CHECK (fecha_entrega > fecha_pedido)
        );
      `;

      const result = service.analyze(sql, 'postgresql');

      expect(result.valid).toBe(true);
      const fechaEntrega = result.schema!.tables[0].columns.find(
        (c) => c.name === 'fecha_entrega',
      )!;
      expect(fechaEntrega.checkMin ?? null).toBeNull();
      expect(fechaEntrega.checkMax ?? null).toBeNull();
    });
  });

  describe('Detección de dialecto equivocado', () => {
    it('rechaza un script con sintaxis PostgreSQL (SERIAL) cuando se eligió MySQL', () => {
      const sql = `
        CREATE TABLE clientes (
          id SERIAL PRIMARY KEY,
          nombre VARCHAR(100) NOT NULL
        );
      `;

      const result = service.analyze(sql, 'mysql');

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('PostgreSQL'))).toBe(true);
    });

    it('rechaza un script con RETURNING (PostgreSQL) cuando se eligió MySQL', () => {
      const sql = `
        CREATE TABLE clientes (id INT PRIMARY KEY, nombre VARCHAR(50));
        INSERT INTO clientes (id, nombre) VALUES (1, 'Ana') RETURNING id;
      `;

      const result = service.analyze(sql, 'mysql');

      expect(result.valid).toBe(false);
    });

    it('rechaza un script con sintaxis MySQL (backticks + AUTO_INCREMENT) cuando se eligió PostgreSQL', () => {
      const sql = `
        CREATE TABLE \`clientes\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`nombre\` VARCHAR(100) NOT NULL,
          PRIMARY KEY (\`id\`)
        ) ENGINE=InnoDB;
      `;

      const result = service.analyze(sql, 'postgresql');

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('MySQL'))).toBe(true);
    });

    it('acepta SQL genérico (sin marcadores de ningún dialecto) con cualquier dialecto declarado', () => {
      const sql = `
        CREATE TABLE clientes (
          id INT PRIMARY KEY,
          nombre VARCHAR(100) NOT NULL
        );
      `;

      expect(service.analyze(sql, 'postgresql').valid).toBe(true);
      expect(service.analyze(sql, 'mysql').valid).toBe(true);
    });
  });

  describe('Dialecto PostgreSQL (comportamiento existente, sin regresiones)', () => {
    it('detecta tablas, PK, FK inline y tipos básicos', () => {
      const sql = `
        CREATE TABLE clientes (
          id SERIAL PRIMARY KEY,
          nombre VARCHAR(100) NOT NULL,
          email VARCHAR(100) UNIQUE
        );

        CREATE TABLE pedidos (
          id SERIAL PRIMARY KEY,
          cliente_id INT REFERENCES clientes(id),
          fecha DATE,
          creado_en TIMESTAMP,
          total DECIMAL(10,2)
        );
      `;

      const result = service.analyze(sql, 'postgresql');

      expect(result.valid).toBe(true);
      expect(result.schema?.dialect).toBe('postgresql');

      const tableNames = result.schema?.tables.map((t) => t.name);
      expect(tableNames).toEqual(['clientes', 'pedidos']);

      const pedidos = result.schema!.tables.find((t) => t.name === 'pedidos')!;
      const clienteId = pedidos.columns.find((c) => c.name === 'cliente_id')!;
      expect(clienteId.references).toEqual({ table: 'clientes', column: 'id' });

      expect(pedidos.columns.find((c) => c.name === 'fecha')!.normalizedType).toBe('DATE');
      expect(pedidos.columns.find((c) => c.name === 'creado_en')!.normalizedType).toBe('DATETIME');
      expect(pedidos.columns.find((c) => c.name === 'total')!.normalizedType).toBe('DECIMAL');

      const clientes = result.schema!.tables.find((t) => t.name === 'clientes')!;
      expect(clientes.columns.find((c) => c.name === 'id')!.normalizedType).toBe('SERIAL');
    });

    it('procesa restricciones definidas vía ALTER TABLE (PK y FK separadas)', () => {
      const sql = `
        CREATE TABLE clientes (id INT, nombre VARCHAR(50));
        CREATE TABLE pedidos (id INT, cliente_id INT);
        ALTER TABLE clientes ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);
        ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id);
      `;

      const result = service.analyze(sql, 'postgresql');

      const clientes = result.schema!.tables.find((t) => t.name === 'clientes')!;
      expect(clientes.primaryKeys).toEqual(['id']);

      const pedidos = result.schema!.tables.find((t) => t.name === 'pedidos')!;
      expect(pedidos.foreignKeys).toEqual([
        { column: 'cliente_id', referencesTable: 'clientes', referencesColumn: 'id' },
      ]);
    });
  });

  describe('Dialecto MySQL', () => {
    it('analiza identificadores con backticks, AUTO_INCREMENT, ENGINE/CHARSET y FK con backticks', () => {
      const sql = `
        CREATE TABLE \`clientes\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`nombre\` VARCHAR(100) NOT NULL,
          \`email\` VARCHAR(100) UNIQUE,
          PRIMARY KEY (\`id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

        CREATE TABLE \`pedidos\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`cliente_id\` INT NOT NULL,
          \`fecha\` DATETIME,
          \`activo\` TINYINT(1) DEFAULT 1,
          \`estado\` ENUM('pendiente','pagado') DEFAULT 'pendiente',
          PRIMARY KEY (\`id\`),
          KEY \`idx_cliente\` (\`cliente_id\`),
          FOREIGN KEY (\`cliente_id\`) REFERENCES \`clientes\`(\`id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `;

      const result = service.analyze(sql, 'mysql');

      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      expect(result.schema?.dialect).toBe('mysql');

      const tableNames = result.schema?.tables.map((t) => t.name);
      expect(tableNames).toEqual(['clientes', 'pedidos']);

      const clientes = result.schema!.tables.find((t) => t.name === 'clientes')!;
      expect(clientes.primaryKeys).toEqual(['id']);
      expect(clientes.columns.find((c) => c.name === 'id')!.normalizedType).toBe('SERIAL');

      const pedidos = result.schema!.tables.find((t) => t.name === 'pedidos')!;

      // AUTO_INCREMENT detectado aunque venga después de NOT NULL (orden típico de MySQL)
      expect(pedidos.columns.find((c) => c.name === 'id')!.normalizedType).toBe('SERIAL');

      // La FK con backticks se detecta y la columna queda referenciada
      expect(pedidos.foreignKeys).toEqual([
        { column: 'cliente_id', referencesTable: 'clientes', referencesColumn: 'id' },
      ]);
      expect(pedidos.columns.find((c) => c.name === 'cliente_id')!.references).toEqual({
        table: 'clientes',
        column: 'id',
      });

      // KEY suelta (índice) no se confunde con una columna
      expect(pedidos.columns.find((c) => c.name === 'idx_cliente')).toBeUndefined();

      // Tipos específicos de MySQL
      expect(pedidos.columns.find((c) => c.name === 'fecha')!.normalizedType).toBe('DATETIME');
      expect(pedidos.columns.find((c) => c.name === 'activo')!.normalizedType).toBe('BOOLEAN');
      expect(pedidos.columns.find((c) => c.name === 'estado')!.normalizedType).toBe('STRING');
    });

    it('detecta PK/FK definidas con ALTER TABLE usando backticks', () => {
      const sql = `
        CREATE TABLE \`clientes\` (\`id\` INT, \`nombre\` VARCHAR(50)) ENGINE=InnoDB;
        CREATE TABLE \`pedidos\` (\`id\` INT, \`cliente_id\` INT) ENGINE=InnoDB;
        ALTER TABLE \`clientes\` ADD CONSTRAINT \`clientes_pkey\` PRIMARY KEY (\`id\`);
        ALTER TABLE \`pedidos\` ADD CONSTRAINT \`pedidos_cliente_fkey\` FOREIGN KEY (\`cliente_id\`) REFERENCES \`clientes\`(\`id\`);
      `;

      const result = service.analyze(sql, 'mysql');

      const clientes = result.schema!.tables.find((t) => t.name === 'clientes')!;
      expect(clientes.primaryKeys).toEqual(['id']);

      const pedidos = result.schema!.tables.find((t) => t.name === 'pedidos')!;
      expect(pedidos.foreignKeys).toEqual([
        { column: 'cliente_id', referencesTable: 'clientes', referencesColumn: 'id' },
      ]);
    });

    it('no confunde el contenido de un VARCHAR con una opción de tabla al quitar ENGINE/CHARSET', () => {
      // Caso límite: muchas columnas, para asegurar que el "stripping" de
      // opciones de tabla no recorta el cuerpo de la tabla en el paréntesis equivocado.
      const sql = `
        CREATE TABLE \`productos\` (
          \`id\` INT NOT NULL AUTO_INCREMENT,
          \`nombre\` VARCHAR(150) NOT NULL,
          \`descripcion\` TEXT,
          \`precio\` DECIMAL(10,2) NOT NULL,
          PRIMARY KEY (\`id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `;

      const result = service.analyze(sql, 'mysql');

      const productos = result.schema!.tables.find((t) => t.name === 'productos')!;
      expect(productos.columns.map((c) => c.name)).toEqual([
        'id',
        'nombre',
        'descripcion',
        'precio',
      ]);
      expect(productos.columns.find((c) => c.name === 'descripcion')!.normalizedType).toBe('TEXT');
      expect(productos.columns.find((c) => c.name === 'precio')!.normalizedType).toBe('DECIMAL');
    });
  });
});
