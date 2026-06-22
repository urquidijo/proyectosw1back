-- Archivo generado por SynData
-- Datos sintéticos para PostgreSQL
INSERT INTO "productos" ("id", "nombre", "precio") VALUES
(1, 'Estela Almanza Rodarte', 2806.36),
(2, 'Reina Beltrán Gracia', 1401.79),
(3, 'Amalia Barraza Juárez', 2577.23),
(4, 'Carolina Quintero Tamez', 1276.87),
(5, 'Emilia Ramos Batista', 3984.17),
(6, 'Sofía Robledo Ortega', 1960.44),
(7, 'Arturo Brito Curiel', 3736.27),
(8, 'Teresa Porras Calvillo', 3685.76),
(9, 'Cristián Aranda Nevárez', 3211.29),
(10, 'Martín Collado Marín', 3247.42);

INSERT INTO "facturas" ("id", "total") VALUES
(1, 82090.6),
(2, 133086.18),
(3, 16838.16),
(4, 64294.41),
(5, 92987.6);

INSERT INTO "detalle_factura" ("id", "factura_id", "producto_id", "cantidad", "precio_unitario", "subtotal") VALUES
(1, 5, 8, 4, 3685.76, 14743.04),
(2, 5, 9, 5, 3211.29, 16056.45),
(3, 5, 10, 14, 3247.42, 45463.88),
(4, 2, 7, 9, 3736.27, 33626.43),
(5, 1, 10, 6, 3247.42, 19484.52),
(6, 2, 5, 8, 3984.17, 31873.36),
(7, 2, 9, 12, 3211.29, 38535.48),
(8, 4, 4, 11, 1276.87, 14045.57),
(9, 4, 6, 13, 1960.44, 25485.72),
(10, 5, 2, 1, 1401.79, 1401.79),
(11, 4, 7, 1, 3736.27, 3736.27),
(12, 1, 1, 4, 2806.36, 11225.44),
(13, 5, 4, 12, 1276.87, 15322.44),
(14, 2, 8, 3, 3685.76, 11057.28),
(15, 2, 3, 5, 2577.23, 12886.15),
(16, 1, 9, 5, 3211.29, 16056.45),
(17, 2, 4, 4, 1276.87, 5107.48),
(18, 4, 2, 15, 1401.79, 21026.85),
(19, 3, 1, 6, 2806.36, 16838.16),
(20, 1, 9, 11, 3211.29, 35324.19);
