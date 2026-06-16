import { Test, TestingModule } from '@nestjs/testing';
import { SyntheticDataGeneratorService } from './synthetic-data-generator.service';
import { GenerationPlanExecutorService } from './generation-plan-executor.service';
import { DetectedSchema } from '../sql-imports/types/detected-schema.type';

describe('SyntheticDataGeneratorService', () => {
  let service: SyntheticDataGeneratorService;
  let planExecutor: GenerationPlanExecutorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyntheticDataGeneratorService,
        GenerationPlanExecutorService,
      ],
    }).compile();

    service = module.get<SyntheticDataGeneratorService>(SyntheticDataGeneratorService);
    planExecutor = module.get<GenerationPlanExecutorService>(GenerationPlanExecutorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Implicit FKs and Business Heuristics', () => {
    it('should enrich schema, sort tables, generate records and apply business heuristics', () => {
      // 1. Definir un esquema con FK explícita e implícitas
      // Categorias (no depende de nada)
      // Productos (FK implícita: id_categoria -> categorias)
      // Ventas (no depende de nada)
      // DetalleVentas (FK explícita: id_venta -> ventas, FK implícita: id_producto -> productos)
      const schema: DetectedSchema = {
        dialect: 'postgresql',
        tables: [
          {
            name: 'productos',
            primaryKeys: ['id'],
            foreignKeys: [], // Implícita: id_categoria -> categorias
            columns: [
              { name: 'id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
              { name: 'nombre', rawType: 'VARCHAR', normalizedType: 'STRING', isPrimaryKey: false, isNullable: false, isUnique: false },
              { name: 'precio', rawType: 'DECIMAL', normalizedType: 'DECIMAL', isPrimaryKey: false, isNullable: false, isUnique: false },
              { name: 'id_categoria', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: false, isNullable: false, isUnique: false },
            ],
          },
          {
            name: 'categorias',
            primaryKeys: ['id'],
            foreignKeys: [],
            columns: [
              { name: 'id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
              { name: 'nombre', rawType: 'VARCHAR', normalizedType: 'STRING', isPrimaryKey: false, isNullable: false, isUnique: true },
            ],
          },
          {
            name: 'ventas',
            primaryKeys: ['id'],
            foreignKeys: [],
            columns: [
              { name: 'id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
              { name: 'fecha', rawType: 'DATE', normalizedType: 'DATE', isPrimaryKey: false, isNullable: false, isUnique: false },
              { name: 'total', rawType: 'DECIMAL', normalizedType: 'DECIMAL', isPrimaryKey: false, isNullable: false, isUnique: false },
            ],
          },
          {
            name: 'detalle_ventas',
            primaryKeys: ['id'],
            foreignKeys: [
              { column: 'id_venta', referencesTable: 'ventas', referencesColumn: 'id' },
            ], // id_producto es implícita
            columns: [
              { name: 'id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
              { name: 'id_venta', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: false, isNullable: false, isUnique: false },
              { name: 'id_producto', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: false, isNullable: false, isUnique: false },
              { name: 'cantidad', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: false, isNullable: false, isUnique: false },
              { name: 'precio_unitario', rawType: 'DECIMAL', normalizedType: 'DECIMAL', isPrimaryKey: false, isNullable: false, isUnique: false },
              { name: 'subtotal', rawType: 'DECIMAL', normalizedType: 'DECIMAL', isPrimaryKey: false, isNullable: false, isUnique: false },
            ],
          },
        ],
      };

      const rowConfig = {
        categorias: 3,
        productos: 5,
        ventas: 2,
        detalle_ventas: 6,
      };

      const result = service.generate(schema, rowConfig, null, 'GENERIC');

      // A. Verificar ordenación de tablas
      // categorias debe venir antes de productos
      // ventas y productos deben venir antes de detalle_ventas
      const order = result.orderedTables;
      expect(order.indexOf('categorias')).toBeLessThan(order.indexOf('productos'));
      expect(order.indexOf('ventas')).toBeLessThan(order.indexOf('detalle_ventas'));
      expect(order.indexOf('productos')).toBeLessThan(order.indexOf('detalle_ventas'));

      // B. Verificar que las filas fueron creadas
      expect(result.rowsByTable.categorias.length).toBe(3);
      expect(result.rowsByTable.productos.length).toBe(5);
      expect(result.rowsByTable.ventas.length).toBe(2);
      expect(result.rowsByTable.detalle_ventas.length).toBe(6);

      // C. Verificar resolución de FK implícitas
      // Productos: id_categoria debe pertenecer a categorias generadas
      const categoriaIds = result.rowsByTable.categorias.map(c => c.id);
      for (const prod of result.rowsByTable.productos) {
        expect(categoriaIds).toContain(prod.id_categoria);
      }

      // DetalleVentas: id_producto debe pertenecer a productos generados
      const productoIds = result.rowsByTable.productos.map(p => p.id);
      for (const det of result.rowsByTable.detalle_ventas) {
        expect(productoIds).toContain(det.id_producto);
      }

      // D. Verificar Heurísticas Lógicas de Negocio
      // 1. El precio_unitario del detalle de venta debe coincidir con el precio del producto
      for (const det of result.rowsByTable.detalle_ventas) {
        const prod = result.rowsByTable.productos.find(p => p.id === det.id_producto);
        expect(det.precio_unitario).toBe(prod?.precio);

        // 2. subtotal = cantidad * precio_unitario
        const expectedSubtotal = Number((Number(det.cantidad) * Number(det.precio_unitario)).toFixed(2));
        expect(det.subtotal).toBe(expectedSubtotal);
      }

      // 3. ventas.total = suma de los subtotales de sus detalle_ventas
      for (const venta of result.rowsByTable.ventas) {
        const matchingDetails = result.rowsByTable.detalle_ventas.filter(d => d.id_venta === venta.id);
        const sum = matchingDetails.reduce((acc, curr) => acc + (curr.subtotal as number), 0);
        expect(venta.total).toBe(Number(sum.toFixed(2)));
      }
    });
  });

  describe('Localization Support (Bolivia)', () => {
    it('should generate Bolivian specific data (cities and valid mobile numbers)', () => {
      const schema: DetectedSchema = {
        dialect: 'postgresql',
        tables: [
          {
            name: 'clientes',
            primaryKeys: ['id'],
            foreignKeys: [],
            columns: [
              { name: 'id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
              { name: 'nombre', rawType: 'VARCHAR', normalizedType: 'STRING', isPrimaryKey: false, isNullable: false, isUnique: false },
              { name: 'telefono', rawType: 'VARCHAR', normalizedType: 'STRING', isPrimaryKey: false, isNullable: false, isUnique: false },
              { name: 'ciudad', rawType: 'VARCHAR', normalizedType: 'STRING', isPrimaryKey: false, isNullable: false, isUnique: false },
            ],
          },
        ],
      };

      const result = service.generate(schema, { clientes: 20 }, null, 'BOLIVIA');

      const bolivianCities = [
        'Santa Cruz de la Sierra',
        'La Paz',
        'Cochabamba',
        'Sucre',
        'Oruro',
        'Potosí',
        'Tarija',
        'Trinidad',
        'Cobija',
        'Montero',
        'Warnes',
        'El Alto',
        'Quillacollo',
        'Sacaba',
        'Yacuiba',
        'Riberalta',
      ];

      for (const cliente of result.rowsByTable.clientes) {
        // Verificar ciudad boliviana
        expect(bolivianCities).toContain(cliente.ciudad);

        // Verificar teléfono boliviano: empieza con 6 o 7, tiene 8 caracteres
        const tel = String(cliente.telefono);
        expect(tel.length).toBe(8);
        expect(['6', '7']).toContain(tel[0]);
      }
    });
  });

  describe('Name Elements Division', () => {
    it('should generate first name and last name separately when column names match', () => {
      const schema: DetectedSchema = {
        dialect: 'postgresql',
        tables: [
          {
            name: 'empleados',
            primaryKeys: ['id'],
            foreignKeys: [],
            columns: [
              { name: 'id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
              { name: 'primer_nombre', rawType: 'VARCHAR', normalizedType: 'STRING', isPrimaryKey: false, isNullable: false, isUnique: false },
              { name: 'apellidos', rawType: 'VARCHAR', normalizedType: 'STRING', isPrimaryKey: false, isNullable: false, isUnique: false },
              { name: 'nombre_completo', rawType: 'VARCHAR', normalizedType: 'STRING', isPrimaryKey: false, isNullable: false, isUnique: false },
            ],
          },
        ],
      };

      const result = service.generate(schema, { empleados: 5 }, null, 'GENERIC');

      for (const emp of result.rowsByTable.empleados) {
        // Verificar que primer_nombre y apellidos sean cadenas no vacías y distintas
        expect(typeof emp.primer_nombre).toBe('string');
        expect((emp.primer_nombre as string).length).toBeGreaterThan(0);
        expect(typeof emp.apellidos).toBe('string');
        expect((emp.apellidos as string).length).toBeGreaterThan(0);

        // El primer nombre y el apellido deben ser una palabra/texto simple (no el nombre completo completo)
        expect((emp.primer_nombre as string).split(' ').length).toBeLessThanOrEqual(2);

        // nombre_completo debe contener al menos dos palabras
        expect(typeof emp.nombre_completo).toBe('string');
        expect((emp.nombre_completo as string).split(' ').length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('Advanced Heuristics (School Database Context)', () => {
    it('should link users to teachers/students, enforce composite PK uniqueness, and use domain dictionaries', () => {
      const schema: DetectedSchema = {
        dialect: 'postgresql',
        tables: [
          {
            name: 'profesores',
            primaryKeys: ['id_profesor'],
            foreignKeys: [],
            columns: [
              { name: 'id_profesor', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
              { name: 'nombres', rawType: 'VARCHAR', normalizedType: 'STRING', isPrimaryKey: false, isNullable: false, isUnique: false },
              { name: 'apellidos', rawType: 'VARCHAR', normalizedType: 'STRING', isPrimaryKey: false, isNullable: false, isUnique: false },
              { name: 'email', rawType: 'VARCHAR', normalizedType: 'STRING', isPrimaryKey: false, isNullable: false, isUnique: false },
            ],
          },
          {
            name: 'materias',
            primaryKeys: ['id_materia'],
            foreignKeys: [],
            columns: [
              { name: 'id_materia', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
              { name: 'nombre', rawType: 'VARCHAR', normalizedType: 'STRING', isPrimaryKey: false, isNullable: false, isUnique: false },
              { name: 'descripcion', rawType: 'TEXT', normalizedType: 'TEXT', isPrimaryKey: false, isNullable: true, isUnique: false },
            ],
          },
          {
            name: 'profesor_materia',
            primaryKeys: ['id_profesor', 'id_materia'],
            foreignKeys: [
              { column: 'id_profesor', referencesTable: 'profesores', referencesColumn: 'id_profesor' },
              { column: 'id_materia', referencesTable: 'materias', referencesColumn: 'id_materia' },
            ],
            columns: [
              { name: 'id_profesor', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: false },
              { name: 'id_materia', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: false },
            ],
          },
          {
            name: 'usuarios',
            primaryKeys: ['id_usuario'],
            foreignKeys: [],
            columns: [
              { name: 'id_usuario', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
              { name: 'nombre_usuario', rawType: 'VARCHAR', normalizedType: 'STRING', isPrimaryKey: false, isNullable: false, isUnique: true },
              { name: 'rol', rawType: 'VARCHAR', normalizedType: 'STRING', isPrimaryKey: false, isNullable: false, isUnique: false },
            ],
          },
        ],
      };

      const rowConfig = {
        profesores: 3,
        materias: 2,
        profesor_materia: 6, // 3 * 2 = 6 combinaciones únicas máximas posibles
        usuarios: 3,
      };

      const result = service.generate(schema, rowConfig, null, 'GENERIC');

      // 1. Verificar Unicidad de Claves Primarias Compuestas en profesor_materia
      expect(result.rowsByTable.profesor_materia.length).toBe(6);
      const keys = result.rowsByTable.profesor_materia.map(r => `${r.id_profesor}|${r.id_materia}`);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(6); // Todos los registros deben ser combinaciones únicas

      // 2. Verificar Diccionarios de Dominio de Materias
      const validSubjects = [
        'Matemáticas', 'Física', 'Química', 'Biología', 'Lenguaje y Literatura',
        'Historia', 'Geografía', 'Educación Cívica', 'Filosofía', 'Psicología',
        'Artes Plásticas', 'Música', 'Educación Física', 'Computación e Informática',
        'Inglés', 'Religión y Ética'
      ];
      for (const m of result.rowsByTable.materias) {
        expect(validSubjects).toContain(m.nombre);
        expect(typeof m.descripcion).toBe('string');
        expect(m.descripcion).not.toContain('Lorem'); // No debe usar texto en latín
      }

      // 3. Verificar Identity Pooling (usuarios vinculados a profesores)
      expect(result.rowsByTable.usuarios.length).toBe(3);
      const profesoresNombres = result.rowsByTable.profesores.map(p => {
        const cleanN = p.nombres.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '');
        const cleanA = p.apellidos.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '');
        return `${cleanN}.${cleanA}`;
      });

      for (const u of result.rowsByTable.usuarios) {
        expect(u.rol).toBe('profesor'); // Vinculado al rol correcto
        expect(profesoresNombres).toContain(u.nombre_usuario); // Nombre usuario debe corresponder a un profesor real
      }
    });
  });
});

