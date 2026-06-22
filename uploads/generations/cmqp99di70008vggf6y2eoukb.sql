-- Archivo generado por SynData
-- Datos sintéticos para PostgreSQL
INSERT INTO "clientes" ("id", "nombre", "email") VALUES
(1, 'Samuel Burgos Sosa', 'samuel.burgossosa1@example.com'),
(2, 'Francisca Lucero Borrego', 'francisca.luceroborrego2@example.com'),
(3, 'Rafael Salgado Carrasquillo', 'rafael.salgadocarrasquillo3@example.com'),
(4, 'Hernán Perea Batista', 'hernan.pereabatista4@example.com'),
(5, 'Virginia Portillo Armendáriz', 'virginia.portilloarmendariz5@example.com');

INSERT INTO "productos" ("id", "nombre", "precio") VALUES
(1, 'Guillermina Cavazos Ibarra', 3841.5),
(2, 'Jaime Carrasquillo Durán', 1847.01),
(3, 'Luis Miguel Valles Escobar', 1046.72),
(4, 'Marta Carrasco Quezada', 3702.54),
(5, 'Sofía Trejo Cotto', 4559.1);

INSERT INTO "facturas" ("id", "cliente_id", "total") VALUES
(1, 3, 488.22),
(2, 4, 4096.63),
(3, 1, 168.41),
(4, 5, 2036.88),
(5, 2, 4466.14);

INSERT INTO "detalle_factura" ("id", "factura_id", "producto_id", "cantidad") VALUES
(1, 2, 5, 8),
(2, 5, 2, 7),
(3, 1, 3, 10),
(4, 4, 1, 5),
(5, 3, 4, 9);
