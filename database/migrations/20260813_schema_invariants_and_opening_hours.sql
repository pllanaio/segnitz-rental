-- Standarddaten werden nur für fehlende Wochentage ergänzt. Bereits konfigurierte
-- Öffnungszeiten bleiben unverändert.
INSERT INTO opening_hours (weekday, is_open, open_time, close_time)
VALUES
    (0, 0, NULL, NULL),
    (1, 1, '08:00:00', '17:00:00'),
    (2, 1, '08:00:00', '17:00:00'),
    (3, 1, '08:00:00', '17:00:00'),
    (4, 1, '08:00:00', '17:00:00'),
    (5, 1, '08:00:00', '17:00:00'),
    (6, 0, NULL, NULL)
ON DUPLICATE KEY UPDATE weekday = VALUES(weekday);
