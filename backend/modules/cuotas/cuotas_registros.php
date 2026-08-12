<?php
declare(strict_types=1);

require_once __DIR__ . '/cuotas_consultas.php';

abstract class CuotasRegistros extends CuotasConsultas
{
    protected static function operationCodeFromContext(?array $context, string $fallbackPrefix): string
    {
        $provided = trim((string)($context['codigo_operacion'] ?? ''));
        return $provided === ''
            ? self::operationCode($fallbackPrefix)
            : clean_text($provided, 64, false);
    }

    protected static function persistRegistration(PDO $db, ?array $context, callable $callback): mixed
    {
        return filter_var($context['sin_transaccion'] ?? false, FILTER_VALIDATE_BOOL)
            ? $callback()
            : transaction($db, $callback);
    }

    /**
     * Eliminar un pago/condonación debe liberar realmente el período para que
     * pueda volver a cobrarse. La auditoría conserva el snapshot previo, por lo
     * que no hace falta mantener una fila ANULADA dentro de la tabla operativa.
     *
     * Se intenta DELETE primero. Solo si una instalación antigua posee una FK externa
     * que impide eliminar, se usa estado ANULADO como fallback compatible.
     */
    protected static function annulLockedRows(
        PDO $db,
        string $table,
        string $idColumn,
        array $ids
    ): array {
        if ($ids === []) {
            return [
                'afectados' => 0,
                'eliminacion_fisica' => false,
                'fallback_anulado' => false,
            ];
        }
        if (!in_array($table, ['pagos', 'pagos_inscripciones'], true)) {
            throw new InvalidArgumentException('Tabla no permitida para anulación.');
        }
        if (!in_array($idColumn, ['id_pago', 'id_pago_inscripcion'], true)) {
            throw new InvalidArgumentException('Columna no permitida para anulación.');
        }

        $ids = array_values(array_unique(array_map('intval', $ids)));
        $placeholders = implode(',', array_fill(0, count($ids), '?'));

        try {
            $statement = $db->prepare(
                "DELETE FROM {$table}
                 WHERE {$idColumn} IN ({$placeholders})
                   AND estado IN ('PAGADO','CONDONADO')"
            );
            $statement->execute($ids);

            return [
                'afectados' => $statement->rowCount(),
                'eliminacion_fisica' => true,
                'fallback_anulado' => false,
            ];
        } catch (PDOException $error) {
            // 23000/1451: un esquema viejo puede tener otra tabla apuntando a
            // pagos. En ese único caso se conserva la fila como ANULADA.
            if ((string)$error->getCode() !== '23000') {
                throw $error;
            }

            $statement = $db->prepare(
                "UPDATE {$table}
                 SET estado = 'ANULADO'
                 WHERE {$idColumn} IN ({$placeholders})
                   AND estado IN ('PAGADO','CONDONADO')"
            );
            $statement->execute($ids);

            return [
                'afectados' => $statement->rowCount(),
                'eliminacion_fisica' => false,
                'fallback_anulado' => true,
            ];
        }
    }

    protected static function registrarPagoDatos(array $auth, array $body, ?array $context = null): array
    {
        $db = $auth['db'];
        $principalId = positive_id($body['id_socio'] ?? null, 'socio');
        $applyFamily = filter_var($body['aplicar_familia'] ?? false, FILTER_VALIDATE_BOOL);
        $condoned = filter_var($body['condonado'] ?? false, FILTER_VALIDATE_BOOL);
        $date = valid_date($body['fecha_pago'] ?? date('Y-m-d'), 'pago');
        if ($date > date('Y-m-d')) api_error('La fecha de pago no puede ser futura.', 'VALIDATION_ERROR');
        $observations = optional_text($body['observaciones'] ?? null, 500);
        $reason = $condoned ? required_text($body, 'motivo_condonacion', 'motivo de condonación', 500) : null;
        $requestedModality = self::paymentModality($db, $body['modalidad'] ?? 'MENSUAL');
        $modalityCode = $requestedModality['codigo'];
        $modalityLabel = self::modalityLabel($modalityCode);

        $obligations = is_array($body['obligaciones'] ?? null) ? $body['obligaciones'] : [];
        if ($obligations === [] || count($obligations) > 500) {
            api_error('Seleccioná entre 1 y 500 cuotas.', 'VALIDATION_ERROR');
        }

        $allowed = self::allowedRecipients($db, $principalId, $applyFamily);
        $normalized = [];
        foreach ($obligations as $obligation) {
            if (!is_array($obligation)) continue;
            $partnerId = positive_id($obligation['id_socio'] ?? null, 'socio');
            $categoryId = positive_id($obligation['id_categoria'] ?? null, 'categoría');
            $year = filter_var($obligation['anio'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 2000, 'max_range' => self::maximumEnabledYear()],
            ]);
            $month = filter_var($obligation['id_mes'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 1, 'max_range' => 12],
            ]);
            if ($year === false || $month === false) api_error('Uno de los períodos no es válido.', 'VALIDATION_ERROR');
            if (!in_array($partnerId, $allowed, true)) {
                api_error('Uno de los socios seleccionados no pertenece al alcance del pago.', 'SOCIO_FUERA_DE_FAMILIA');
            }
            $key = self::periodKey($partnerId, $categoryId, (int)$year, (int)$month);
            $normalized[$key] = [
                'id_socio' => $partnerId,
                'id_categoria' => $categoryId,
                'anio' => (int)$year,
                'id_mes' => (int)$month,
            ];
        }
        if ($normalized === []) api_error('No hay cuotas válidas seleccionadas.', 'VALIDATION_ERROR');

        if (self::isPackageModality($modalityCode)) {
            $first = reset($normalized);
            $categoryId = (int)$first['id_categoria'];
            $year = (int)$first['anio'];
            foreach ($normalized as $obligation) {
                if ((int)$obligation['id_categoria'] !== $categoryId || (int)$obligation['anio'] !== $year) {
                    api_error('Un pago semestral o anual debe corresponder a una sola categoría y un solo año.', 'MODALIDAD_INCONSISTENTE');
                }
            }

            $recipients = $applyFamily
                ? self::recipientsWithCategory($db, $allowed, $categoryId, $year)
                : [$principalId];
            if ($recipients === []) {
                api_error('No hay socios con esa categoría para la modalidad seleccionada.', 'MODALIDAD_NO_DISPONIBLE');
            }

            $requiredMonths = self::modalityMonths($modalityCode);
            $package = [];
            foreach ($recipients as $partnerId) {
                // Regla comercial: si ya existe cualquier cuota del año,
                // CONTADO ANUAL y PRIMERA MITAD dejan de ser opciones.
                if (in_array($modalityCode, ['CONTADO_ANUAL', 'PRIMERA_MITAD'], true)
                    && self::hasRegisteredYear($db, $partnerId, $categoryId, $year)) {
                    api_error(
                        'La modalidad ' . $modalityLabel . ' ya no está disponible porque el socio tiene cuotas registradas en ese año.',
                        'MODALIDAD_NO_DISPONIBLE',
                        409
                    );
                }
                foreach ($requiredMonths as $month) {
                    if (!self::hasAssignmentForPeriod($db, $partnerId, $categoryId, $year, $month)) {
                        api_error(
                            'La modalidad ' . $modalityLabel . ' no corresponde a todo el período para uno de los socios seleccionados.',
                            'MODALIDAD_NO_DISPONIBLE',
                            409
                        );
                    }
                    if (self::hasRegisteredPeriod($db, $partnerId, $categoryId, $year, $month)) {
                        api_error(
                            'La modalidad ' . $modalityLabel . ' ya no está disponible porque uno de sus meses está pagado o condonado.',
                            'MODALIDAD_NO_DISPONIBLE',
                            409
                        );
                    }
                    $key = self::periodKey($partnerId, $categoryId, $year, $month);
                    $package[$key] = [
                        'id_socio' => $partnerId,
                        'id_categoria' => $categoryId,
                        'anio' => $year,
                        'id_mes' => $month,
                    ];
                }
            }
            $normalized = $package;
        } elseif ($applyFamily) {
            $periodsToApply = [];
            foreach ($normalized as $obligation) {
                $periodKey = $obligation['id_categoria'] . '-' . $obligation['anio'] . '-' . $obligation['id_mes'];
                $periodsToApply[$periodKey] = [
                    'id_categoria' => $obligation['id_categoria'],
                    'anio' => $obligation['anio'],
                    'id_mes' => $obligation['id_mes'],
                ];
            }

            $expanded = [];
            foreach ($periodsToApply as $period) {
                foreach ($allowed as $familyPartnerId) {
                    if (!self::hasAssignmentForPeriod(
                        $db,
                        $familyPartnerId,
                        $period['id_categoria'],
                        $period['anio'],
                        $period['id_mes']
                    ) || self::hasRegisteredPeriod(
                        $db,
                        $familyPartnerId,
                        $period['id_categoria'],
                        $period['anio'],
                        $period['id_mes']
                    )) {
                        continue;
                    }
                    $key = self::periodKey(
                        $familyPartnerId,
                        $period['id_categoria'],
                        $period['anio'],
                        $period['id_mes']
                    );
                    $expanded[$key] = [
                        'id_socio' => $familyPartnerId,
                        'id_categoria' => $period['id_categoria'],
                        'anio' => $period['anio'],
                        'id_mes' => $period['id_mes'],
                    ];
                }
            }
            $normalized = $expanded;
        }

        $normalized = array_values($normalized);
        if ($normalized === []) api_error('No hay cuotas válidas seleccionadas.', 'VALIDATION_ERROR');

        $mediumId = $condoned
            ? self::condonationMediumId($db)
            : self::normalPaymentMediumId($db, $body['id_medio_pago'] ?? null);
        $modalityId = (int)$requestedModality['id_modalidad_pago'];
        $categoryIds = array_values(array_unique(array_column($normalized, 'id_categoria')));
        $categoryRows = self::categoryMap($db, $categoryIds);
        $prices = self::priceHistory($db, $categoryIds);
        $rules = self::discountRules($db);
        $operationCode = self::operationCodeFromContext($context, $condoned ? 'COND-CUO' : 'CUO');
        $auditEnabled = !filter_var($context['sin_auditoria'] ?? false, FILTER_VALIDATE_BOOL);
        $state = $condoned ? 'CONDONADO' : 'PAGADO';
        $mediumName = self::paymentMediumName($db, $mediumId);
        $discountCache = [];

        try {
            $saved = self::persistRegistration($db, $context, static function () use (
                $db, $auth, $normalized, $modalityId, $modalityCode, $modalityLabel,
                $categoryRows, $prices, $rules, $operationCode, $state, $mediumId,
                $mediumName, $date, $observations, $reason, &$discountCache, $auditEnabled
            ): array {
                $lines = [];
                $charged = 0.0;
                $theoretical = 0.0;

                // Revalidación dentro de la misma transacción. Evita que un
                // pago concurrente habilite por error CONTADO ANUAL o PRIMERA
                // MITAD después de la validación previa del formulario.
                if (in_array($modalityCode, ['CONTADO_ANUAL', 'PRIMERA_MITAD'], true)) {
                    $packageGroups = [];
                    foreach ($normalized as $obligation) {
                        $groupKey = $obligation['id_socio'] . '-' . $obligation['id_categoria'] . '-' . $obligation['anio'];
                        $packageGroups[$groupKey] = [
                            'id_socio' => (int)$obligation['id_socio'],
                            'id_categoria' => (int)$obligation['id_categoria'],
                            'anio' => (int)$obligation['anio'],
                        ];
                    }
                    $yearLock = $db->prepare(
                        "SELECT id_pago FROM pagos
                         WHERE id_socio = ? AND id_categoria = ? AND anio = ?
                           AND estado IN ('PAGADO','CONDONADO')
                         FOR UPDATE"
                    );
                    foreach ($packageGroups as $group) {
                        $yearLock->execute([$group['id_socio'], $group['id_categoria'], $group['anio']]);
                        if ($yearLock->fetchColumn()) {
                            api_error(
                                'La modalidad ' . $modalityLabel . ' ya no está disponible porque el socio tiene cuotas registradas en ese año.',
                                'MODALIDAD_NO_DISPONIBLE',
                                409
                            );
                        }
                    }
                }

                foreach ($normalized as $obligation) {
                    $partnerId = $obligation['id_socio'];
                    $categoryId = $obligation['id_categoria'];
                    $year = $obligation['anio'];
                    $month = $obligation['id_mes'];
                    self::validateAssignmentForPeriod($db, $partnerId, $categoryId, $year, $month);
                    $category = $categoryRows[$categoryId] ?? null;
                    if (!$category) api_error('Una categoría seleccionada no existe.', 'CATEGORIA_NO_ENCONTRADA', 404);

                    $lock = $db->prepare(
                        'SELECT * FROM pagos WHERE id_socio = ? AND id_categoria = ? AND anio = ? AND id_mes = ? FOR UPDATE'
                    );
                    $lock->execute([$partnerId, $categoryId, $year, $month]);
                    $existing = $lock->fetch();
                    if ($existing && in_array($existing['estado'], self::ESTADOS_REGISTRADOS, true)) {
                        api_error('Una de las cuotas seleccionadas ya está pagada o condonada.', 'CUOTA_YA_REGISTRADA', 409);
                    }

                    $discountContext = self::discountContextForPartner($db, $partnerId, $rules, $discountCache);
                    $partnerSnapshot = self::partnerSnapshot($db, $partnerId);
                    $categoryName = (string)$category['nombre'];
                    $base = self::priceForPeriod($prices[$categoryId] ?? [], (float)$category['monto_actual'], $year, $month);
                    $discounted = self::amountWithFamilyDiscount($base, (float)$discountContext['porcentaje']);
                    $amount = $state === 'CONDONADO' ? 0.0 : $discounted;

                    if ($existing) {
                        $update = $db->prepare(
                            'UPDATE pagos SET codigo_operacion = ?, id_familia = ?, id_medio_pago = ?, id_modalidad_pago = ?,
                             monto_base = ?, porcentaje_descuento_modalidad = 0, porcentaje_descuento_familiar = ?, monto = ?,
                             fecha_pago = ?, estado = ?, motivo_condonacion = ?, observaciones = ?,
                             socio_nombre_snapshot = ?, socio_dni_snapshot = ?, categoria_nombre_snapshot = ?,
                             medio_pago_nombre_snapshot = ? WHERE id_pago = ?'
                        );
                        $update->execute([
                            $operationCode, $discountContext['id_familia'], $mediumId, $modalityId,
                            number_format($base, 2, '.', ''), number_format($discountContext['porcentaje'], 2, '.', ''), number_format($amount, 2, '.', ''),
                            $date, $state, $reason, $observations,
                            $partnerSnapshot['socio'], $partnerSnapshot['dni'], $categoryName, $mediumName, $existing['id_pago'],
                        ]);
                        $paymentId = (int)$existing['id_pago'];
                    } else {
                        $insert = $db->prepare(
                            'INSERT INTO pagos
                             (codigo_operacion, id_socio, id_familia, id_categoria, id_mes, id_medio_pago, id_modalidad_pago,
                              anio, monto_base, porcentaje_descuento_modalidad, porcentaje_descuento_familiar, monto,
                              fecha_pago, estado, motivo_condonacion, observaciones, socio_nombre_snapshot,
                              socio_dni_snapshot, categoria_nombre_snapshot, medio_pago_nombre_snapshot)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                        );
                        $insert->execute([
                            $operationCode, $partnerId, $discountContext['id_familia'], $categoryId, $month, $mediumId, $modalityId,
                            $year, number_format($base, 2, '.', ''), number_format($discountContext['porcentaje'], 2, '.', ''), number_format($amount, 2, '.', ''),
                            $date, $state, $reason, $observations,
                            $partnerSnapshot['socio'], $partnerSnapshot['dni'], $categoryName, $mediumName,
                        ]);
                        $paymentId = (int)$db->lastInsertId();
                    }

                    $lines[] = [
                        'id_pago' => $paymentId,
                        'id_socio' => $partnerId,
                        'id_categoria' => $categoryId,
                        'anio' => $year,
                        'id_mes' => $month,
                        'modalidad' => $modalityCode,
                        'monto_base' => number_format($base, 2, '.', ''),
                        'porcentaje_descuento_familiar' => number_format($discountContext['porcentaje'], 2, '.', ''),
                        'monto' => number_format($amount, 2, '.', ''),
                    ];
                    $theoretical += $discounted;
                    $charged += $amount;
                }

                if ($auditEnabled) {
                    audit_change(
                        $db,
                        $auth,
                        'CUOTAS',
                        $state === 'CONDONADO' ? 'CONDONAR_CUOTAS' : 'REGISTRAR_PAGO',
                        'pagos',
                        $operationCode,
                        $state === 'CONDONADO'
                            ? 'Se condonó un registro de ' . $modalityLabel . '.'
                            : 'Se registró un pago de ' . $modalityLabel . '.',
                        null,
                        ['codigo_operacion' => $operationCode, 'modalidad' => $modalityCode, 'lineas' => $lines]
                    );
                }
                return [
                    'lineas' => count($lines),
                    'modalidad' => $modalityCode,
                    'modalidad_label' => $modalityLabel,
                    'monto_teorico' => number_format($theoretical, 2, '.', ''),
                    'monto' => number_format($charged, 2, '.', ''),
                ];
            });
        } catch (Throwable $error) {
            if (duplicate_key($error)) {
                api_error('Una de las cuotas seleccionadas ya está pagada o condonada.', 'CUOTA_YA_REGISTRADA', 409);
            }
            throw $error;
        }

        return ['codigo_operacion' => $operationCode, 'estado' => $state] + $saved;
    }

    protected static function registrarInscripcionDatos(array $auth, array $body, ?array $context = null): array
    {
        $db = $auth['db'];
        $principalId = positive_id($body['id_socio'] ?? null, 'socio');
        $categoryId = positive_id($body['id_categoria'] ?? null, 'categoría');
        $year = filter_var($body['anio'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 2000, 'max_range' => self::maximumEnabledYear()]]);
        if ($year === false) api_error('El año de inscripción no es válido.', 'VALIDATION_ERROR');
        // El importe de inscripción es una configuración del sistema y nunca se
        // acepta desde el navegador. Así, una petición manipulada no puede
        // registrar un monto diferente al definido en Configuración.
        $baseAmount = self::registrationAmount($db);
        if ((float)$baseAmount <= 0) {
            api_error(
                'Configurá un monto de inscripción válido antes de registrar el pago.',
                'MONTO_INSCRIPCION_NO_CONFIGURADO',
                409
            );
        }
        $applyFamily = filter_var($body['aplicar_familia'] ?? false, FILTER_VALIDATE_BOOL);
        $condoned = filter_var($body['condonado'] ?? false, FILTER_VALIDATE_BOOL);
        $date = valid_date($body['fecha_pago'] ?? date('Y-m-d'), 'pago');
        if ($date > date('Y-m-d')) api_error('La fecha de pago no puede ser futura.', 'VALIDATION_ERROR');
        $description = optional_text($body['descripcion'] ?? null, 255) ?? ('INSCRIPCIÓN ' . $year);
        $observations = optional_text($body['observaciones'] ?? null, 500);
        $reason = $condoned ? required_text($body, 'motivo_condonacion', 'motivo de condonación', 500) : null;
        $mediumId = $condoned
            ? self::condonationMediumId($db)
            : self::normalPaymentMediumId($db, $body['id_medio_pago'] ?? null);
        $allowed = self::allowedRecipients($db, $principalId, $applyFamily);
        $recipients = self::recipientsWithCategory($db, $allowed, $categoryId, (int)$year);
        if ($recipients === []) api_error('Ningún socio seleccionado tiene esa categoría en el año indicado.', 'CATEGORIA_NO_ASIGNADA');

        $pendingRecipients = [];
        $registered = $db->prepare(
            "SELECT id_pago_inscripcion FROM pagos_inscripciones
             WHERE id_socio = ? AND id_categoria = ? AND anio = ?
               AND estado IN ('PAGADO','CONDONADO') LIMIT 1"
        );
        foreach ($recipients as $recipientId) {
            $registered->execute([$recipientId, $categoryId, (int)$year]);
            if (!$registered->fetch()) $pendingRecipients[] = $recipientId;
        }
        $recipients = $pendingRecipients;
        if ($recipients === []) api_error('La inscripción ya está pagada o condonada para los socios seleccionados.', 'INSCRIPCION_YA_REGISTRADA', 409);

        $rules = self::discountRules($db);
        $discountCache = [];
        $operationCode = self::operationCodeFromContext($context, $condoned ? 'COND-INS' : 'INS');
        $auditEnabled = !filter_var($context['sin_auditoria'] ?? false, FILTER_VALIDATE_BOOL);
        $state = $condoned ? 'CONDONADO' : 'PAGADO';
        $base = (float)$baseAmount;
        $category = self::categoryMap($db, [$categoryId])[$categoryId] ?? null;
        if (!$category) api_error('La categoría seleccionada no existe.', 'CATEGORIA_NO_ENCONTRADA', 404);
        $categoryName = (string)$category['nombre'];
        $mediumName = self::paymentMediumName($db, $mediumId);

        try {
            $saved = self::persistRegistration($db, $context, static function () use (
            $db, $auth, $recipients, $categoryId, $year, $base, $rules, &$discountCache,
            $operationCode, $state, $mediumId, $mediumName, $categoryName, $date, $description, $observations, $reason,
            $auditEnabled
        ): array {
            $lines = [];
            $charged = 0.0;
            $theoretical = 0.0;
            $partnerLock = $db->prepare('SELECT id_socio FROM socios WHERE id_socio = ? FOR UPDATE');
            foreach ($recipients as $partnerId) {
                $partnerLock->execute([$partnerId]);
                if (!$partnerLock->fetchColumn()) {
                    api_error('Uno de los socios seleccionados ya no existe.', 'SOCIO_NO_DISPONIBLE', 404);
                }
                $lock = $db->prepare(
                    "SELECT * FROM pagos_inscripciones
                     WHERE id_socio = ? AND id_categoria = ? AND anio = ?
                     ORDER BY id_pago_inscripcion DESC FOR UPDATE"
                );
                $lock->execute([$partnerId, $categoryId, $year]);
                $existingRows = $lock->fetchAll();
                $active = array_values(array_filter($existingRows, static fn(array $row): bool => in_array($row['estado'], self::ESTADOS_REGISTRADOS, true)));
                if ($active !== []) api_error('Una de las inscripciones ya está pagada o condonada.', 'INSCRIPCION_YA_REGISTRADA', 409);

                $discountContext = self::discountContextForPartner($db, $partnerId, $rules, $discountCache);
                $partnerSnapshot = self::partnerSnapshot($db, $partnerId);
                $discounted = self::amountWithFamilyDiscount($base, (float)$discountContext['porcentaje']);
                $amount = $state === 'CONDONADO' ? 0.0 : $discounted;
                $reusable = $existingRows[0] ?? null;
                if ($reusable) {
                    $update = $db->prepare(
                        'UPDATE pagos_inscripciones SET codigo_operacion = ?, id_familia = ?, id_medio_pago = ?, descripcion = ?, anio = ?,
                         monto_base = ?, porcentaje_descuento_familiar = ?, monto = ?, fecha_pago = ?, estado = ?,
                         motivo_condonacion = ?, observaciones = ?, socio_nombre_snapshot = ?, socio_dni_snapshot = ?,
                         categoria_nombre_snapshot = ?, medio_pago_nombre_snapshot = ? WHERE id_pago_inscripcion = ?'
                    );
                    $update->execute([
                        $operationCode, $discountContext['id_familia'], $mediumId, $description, $year,
                        number_format($base, 2, '.', ''), number_format($discountContext['porcentaje'], 2, '.', ''), number_format($amount, 2, '.', ''),
                        $date, $state, $reason, $observations,
                        $partnerSnapshot['socio'], $partnerSnapshot['dni'], $categoryName, $mediumName,
                        $reusable['id_pago_inscripcion'],
                    ]);
                    $registrationId = (int)$reusable['id_pago_inscripcion'];
                } else {
                    $insert = $db->prepare(
                        'INSERT INTO pagos_inscripciones
                         (codigo_operacion, id_socio, id_categoria, id_familia, id_medio_pago, descripcion, anio,
                          monto_base, porcentaje_descuento_familiar, monto, fecha_pago, estado, motivo_condonacion, observaciones,
                          socio_nombre_snapshot, socio_dni_snapshot, categoria_nombre_snapshot, medio_pago_nombre_snapshot)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                    );
                    $insert->execute([
                        $operationCode, $partnerId, $categoryId, $discountContext['id_familia'], $mediumId, $description, $year,
                        number_format($base, 2, '.', ''), number_format($discountContext['porcentaje'], 2, '.', ''), number_format($amount, 2, '.', ''),
                        $date, $state, $reason, $observations,
                        $partnerSnapshot['socio'], $partnerSnapshot['dni'], $categoryName, $mediumName,
                    ]);
                    $registrationId = (int)$db->lastInsertId();
                }
                $lines[] = ['id_pago_inscripcion' => $registrationId, 'id_socio' => $partnerId, 'monto' => number_format($amount, 2, '.', '')];
                $theoretical += $discounted;
                $charged += $amount;
            }

            if ($auditEnabled) {
                audit_change(
                    $db,
                    $auth,
                    'CUOTAS',
                    $state === 'CONDONADO' ? 'CONDONAR_INSCRIPCION' : 'REGISTRAR_INSCRIPCION',
                    'pagos_inscripciones',
                    $operationCode,
                    $state === 'CONDONADO' ? 'Se condonó una inscripción.' : 'Se registró un pago de inscripción.',
                    null,
                    ['codigo_operacion' => $operationCode, 'lineas' => $lines]
                );
            }
            return [
                'lineas' => count($lines),
                'monto_teorico' => number_format($theoretical, 2, '.', ''),
                'monto' => number_format($charged, 2, '.', ''),
            ];
            });
        } catch (Throwable $error) {
            if (duplicate_key($error)) {
                api_error('La inscripción ya está pagada o condonada para uno de los socios.', 'INSCRIPCION_YA_REGISTRADA', 409);
            }
            throw $error;
        }

        return ['codigo_operacion' => $operationCode, 'estado' => $state] + $saved;
    }

    protected static function registrarCobroDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $obligations = is_array($body['obligaciones'] ?? null) ? $body['obligaciones'] : [];
        $includeRegistration = filter_var(
            $body['incluir_inscripcion'] ?? false,
            FILTER_VALIDATE_BOOL
        );

        if (count($obligations) > 500) {
            api_error('No se pueden registrar más de 500 cuotas por cobro.', 'VALIDATION_ERROR');
        }
        if ($obligations === [] && !$includeRegistration) {
            api_error('Seleccioná al menos una cuota o incluí la inscripción.', 'VALIDATION_ERROR');
        }

        if ($includeRegistration && $obligations !== []) {
            $registrationCategoryId = positive_id($body['id_categoria'] ?? null, 'categoría');
            $registrationYear = filter_var($body['anio'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 2000, 'max_range' => self::maximumEnabledYear()],
            ]);
            if ($registrationYear === false) {
                api_error('El año del cobro combinado no es válido.', 'VALIDATION_ERROR');
            }
            foreach ($obligations as $obligation) {
                if (!is_array($obligation)) {
                    api_error('Una de las cuotas seleccionadas no es válida.', 'VALIDATION_ERROR');
                }
                if (
                    (int)($obligation['id_categoria'] ?? 0) !== $registrationCategoryId
                    || (int)($obligation['anio'] ?? 0) !== (int)$registrationYear
                ) {
                    api_error(
                        'La inscripción y las cuotas del mismo cobro deben pertenecer a la misma categoría y año.',
                        'COBRO_COMBINADO_INCONSISTENTE'
                    );
                }
            }
        }

        $condoned = filter_var($body['condonado'] ?? false, FILTER_VALIDATE_BOOL);
        $state = $condoned ? 'CONDONADO' : 'PAGADO';
        $hasFees = $obligations !== [];
        $operationPrefix = $hasFees && $includeRegistration
            ? ($condoned ? 'COND-COB' : 'COB')
            : ($hasFees
                ? ($condoned ? 'COND-CUO' : 'CUO')
                : ($condoned ? 'COND-INS' : 'INS'));
        $operationCode = self::operationCode($operationPrefix);
        $context = [
            'codigo_operacion' => $operationCode,
            'sin_transaccion' => true,
            'sin_auditoria' => true,
        ];

        $saved = transaction($db, static function () use (
            $db,
            $auth,
            $body,
            $obligations,
            $includeRegistration,
            $context,
            $operationCode,
            $state
        ): array {
            $feesResult = null;
            $registrationResult = null;

            if ($obligations !== []) {
                $feesBody = $body;
                $feesBody['obligaciones'] = $obligations;
                $feesResult = self::registrarPagoDatos($auth, $feesBody, $context);
            }

            if ($includeRegistration) {
                $registrationResult = self::registrarInscripcionDatos($auth, $body, $context);
            }

            $rows = array_merge(
                self::paymentRows($db, null, $operationCode),
                self::registrationRows($db, null, $operationCode)
            );
            if ($rows === []) {
                api_error('No se pudo registrar ninguna línea del cobro.', 'COBRO_SIN_LINEAS', 500);
            }

            $operation = self::groupOperations($rows)[0] ?? null;
            $lineCount = (int)($feesResult['lineas'] ?? 0)
                + (int)($registrationResult['lineas'] ?? 0);
            $theoretical = (float)($feesResult['monto_teorico'] ?? 0)
                + (float)($registrationResult['monto_teorico'] ?? 0);
            $charged = (float)($feesResult['monto'] ?? 0)
                + (float)($registrationResult['monto'] ?? 0);
            $concepts = [];
            if ($feesResult !== null) $concepts[] = 'cuotas';
            if ($registrationResult !== null) $concepts[] = 'inscripción';
            $conceptLabel = implode(' e ', $concepts);

            audit_change(
                $db,
                $auth,
                'CUOTAS',
                $state === 'CONDONADO' ? 'CONDONAR_COBRO' : 'REGISTRAR_COBRO',
                $feesResult !== null ? 'pagos' : 'pagos_inscripciones',
                $operationCode,
                $state === 'CONDONADO'
                    ? 'Se condonó un cobro de ' . $conceptLabel . '.'
                    : 'Se registró un cobro de ' . $conceptLabel . '.',
                null,
                [
                    'codigo_operacion' => $operationCode,
                    'incluye_cuotas' => $feesResult !== null,
                    'incluye_inscripcion' => $registrationResult !== null,
                    'lineas' => $operation['lineas'] ?? [],
                    'monto' => number_format($charged, 2, '.', ''),
                ]
            );

            return [
                'lineas' => $lineCount,
                'monto_teorico' => number_format($theoretical, 2, '.', ''),
                'monto' => number_format($charged, 2, '.', ''),
                'incluye_cuotas' => $feesResult !== null,
                'incluye_inscripcion' => $registrationResult !== null,
                'modalidad' => $operation['modalidad_codigo'] ?? null,
                'modalidad_label' => $operation['modalidad_label'] ?? null,
            ];
        });

        return ['codigo_operacion' => $operationCode, 'estado' => $state] + $saved;
    }

    protected static function anularDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $code = required_text($body, 'codigo_operacion', 'código de operación', 64, false);
        $requestedLines = is_array($body['lineas'] ?? null) ? $body['lineas'] : [];
        if ($requestedLines === [] || count($requestedLines) > 500) {
            api_error('Indicá entre 1 y 500 líneas visibles para anular.', 'VALIDATION_ERROR');
        }

        $requested = [];
        foreach ($requestedLines as $line) {
            if (!is_array($line)) api_error('Una línea para anular no es válida.', 'VALIDATION_ERROR');
            $type = self::upper(clean_text($line['tipo'] ?? '', 20, false));
            if (!in_array($type, ['CUOTA', 'INSCRIPCION'], true)) {
                api_error('El tipo de línea no es válido.', 'VALIDATION_ERROR');
            }
            $id = positive_id($line['id_linea'] ?? null, 'línea');
            $requested[$type . '-' . $id] = ['tipo' => $type, 'id_linea' => $id];
        }

        $result = transaction($db, static function () use ($db, $auth, $code, $requested): array {
            $expanded = [];
            $packageLabels = [];

            $combinedOperation = preg_match('/^(?:COND-)?COB-/', $code) === 1;
            if ($combinedOperation) {
                $partnerIds = [];
                foreach ($requested as $line) {
                    $isPayment = $line['tipo'] === 'CUOTA';
                    $table = $isPayment ? 'pagos' : 'pagos_inscripciones';
                    $idColumn = $isPayment ? 'id_pago' : 'id_pago_inscripcion';
                    $legacyPrefix = $isPayment ? 'PAGO-' : 'INSCRIPCION-';
                    $requestedLock = $db->prepare(
                        "SELECT {$idColumn}, id_socio, codigo_operacion, estado
                         FROM {$table}
                         WHERE {$idColumn} = ?
                         FOR UPDATE"
                    );
                    $requestedLock->execute([$line['id_linea']]);
                    $row = $requestedLock->fetch();
                    $rowCode = $row
                        ? (string)($row['codigo_operacion'] ?: $legacyPrefix . $line['id_linea'])
                        : '';
                    if (!$row || $rowCode !== $code) {
                        api_error(
                            'Una línea ya no pertenece al cobro mostrado. Actualizá la tabla.',
                            'OPERACION_DESACTUALIZADA',
                            409
                        );
                    }
                    if (!in_array($row['estado'], self::ESTADOS_REGISTRADOS, true)) {
                        api_error('Una línea seleccionada ya fue anulada.', 'OPERACION_SIN_CAMBIOS', 409);
                    }
                    $partnerIds[(int)$row['id_socio']] = (int)$row['id_socio'];
                }

                $partnerIds = array_values($partnerIds);
                $placeholders = implode(',', array_fill(0, count($partnerIds), '?'));
                $paymentLock = $db->prepare(
                    "SELECT p.id_pago, modalidad.codigo AS modalidad_codigo, modalidad.nombre AS modalidad_nombre
                     FROM pagos p
                     INNER JOIN modalidades_pago modalidad ON modalidad.id_modalidad_pago = p.id_modalidad_pago
                     WHERE p.codigo_operacion = ?
                       AND p.id_socio IN ({$placeholders})
                       AND p.estado IN ('PAGADO','CONDONADO')
                     ORDER BY p.id_pago
                     FOR UPDATE"
                );
                $paymentLock->execute([$code, ...$partnerIds]);
                foreach ($paymentLock->fetchAll() as $row) {
                    $paymentId = (int)$row['id_pago'];
                    $expanded['CUOTA-' . $paymentId] = [
                        'tipo' => 'CUOTA',
                        'id_linea' => $paymentId,
                    ];
                    $modalityCode = self::upper((string)$row['modalidad_codigo']);
                    if (self::isPackageModality($modalityCode)) {
                        $packageLabels[$modalityCode] = (string)$row['modalidad_nombre'];
                    }
                }

                $registrationLock = $db->prepare(
                    "SELECT id_pago_inscripcion
                     FROM pagos_inscripciones
                     WHERE codigo_operacion = ?
                       AND id_socio IN ({$placeholders})
                       AND estado IN ('PAGADO','CONDONADO')
                     ORDER BY id_pago_inscripcion
                     FOR UPDATE"
                );
                $registrationLock->execute([$code, ...$partnerIds]);
                foreach ($registrationLock->fetchAll() as $row) {
                    $registrationId = (int)$row['id_pago_inscripcion'];
                    $expanded['INSCRIPCION-' . $registrationId] = [
                        'tipo' => 'INSCRIPCION',
                        'id_linea' => $registrationId,
                    ];
                }

                foreach ($requested as $key => $line) {
                    if (!isset($expanded[$key])) {
                        api_error(
                            'Una línea ya no pertenece al cobro mostrado o ya fue anulada. Actualizá la tabla.',
                            'OPERACION_DESACTUALIZADA',
                            409
                        );
                    }
                }
            } else {
                foreach ($requested as $line) {
                    if ($line['tipo'] === 'INSCRIPCION') {
                        $lock = $db->prepare(
                            'SELECT id_pago_inscripcion, codigo_operacion, estado
                             FROM pagos_inscripciones
                             WHERE id_pago_inscripcion = ? FOR UPDATE'
                        );
                        $lock->execute([$line['id_linea']]);
                        $row = $lock->fetch();
                        $rowCode = $row ? (string)($row['codigo_operacion'] ?: 'INSCRIPCION-' . $line['id_linea']) : '';
                        if (!$row || $rowCode !== $code) {
                            api_error('Una línea ya no pertenece al registro mostrado. Actualizá la tabla.', 'OPERACION_DESACTUALIZADA', 409);
                        }
                        if (!in_array($row['estado'], self::ESTADOS_REGISTRADOS, true)) {
                            api_error('Una línea seleccionada ya fue anulada.', 'OPERACION_SIN_CAMBIOS', 409);
                        }
                        $expanded['INSCRIPCION-' . $line['id_linea']] = $line;
                        continue;
                    }

                    $lock = $db->prepare(
                        "SELECT p.id_pago, p.codigo_operacion, p.estado, p.id_socio, p.id_categoria,
                                p.anio, p.id_modalidad_pago, modalidad.codigo AS modalidad_codigo,
                                modalidad.nombre AS modalidad_nombre
                         FROM pagos p
                         INNER JOIN modalidades_pago modalidad ON modalidad.id_modalidad_pago = p.id_modalidad_pago
                         WHERE p.id_pago = ? FOR UPDATE"
                    );
                    $lock->execute([$line['id_linea']]);
                    $row = $lock->fetch();
                    $rowCode = $row ? (string)($row['codigo_operacion'] ?: 'PAGO-' . $line['id_linea']) : '';
                    if (!$row || $rowCode !== $code) {
                        api_error('Una línea ya no pertenece al registro mostrado. Actualizá la tabla.', 'OPERACION_DESACTUALIZADA', 409);
                    }
                    if (!in_array($row['estado'], self::ESTADOS_REGISTRADOS, true)) {
                        api_error('Una línea seleccionada ya fue anulada.', 'OPERACION_SIN_CAMBIOS', 409);
                    }

                    $modalityCode = self::upper((string)$row['modalidad_codigo']);
                    if (!self::isPackageModality($modalityCode)) {
                        $expanded['CUOTA-' . $line['id_linea']] = $line;
                        continue;
                    }

                    // Los planes semestrales y anuales son atómicos: seleccionar
                    // enero o cualquier otro mes anula el paquete completo del
                    // socio, categoría y año, no una cuota aislada.
                    $package = $db->prepare(
                        "SELECT id_pago
                         FROM pagos
                         WHERE codigo_operacion = ?
                           AND id_socio = ? AND id_categoria = ? AND anio = ?
                           AND id_modalidad_pago = ?
                           AND estado IN ('PAGADO','CONDONADO')
                         ORDER BY id_mes
                         FOR UPDATE"
                    );
                    $package->execute([
                        $code,
                        (int)$row['id_socio'],
                        (int)$row['id_categoria'],
                        (int)$row['anio'],
                        (int)$row['id_modalidad_pago'],
                    ]);
                    $packageIds = array_map('intval', array_column($package->fetchAll(), 'id_pago'));
                    if ($packageIds === []) {
                        api_error('El pago semestral o anual ya no tiene líneas activas.', 'OPERACION_SIN_CAMBIOS', 409);
                    }
                    foreach ($packageIds as $packageId) {
                        $expanded['CUOTA-' . $packageId] = ['tipo' => 'CUOTA', 'id_linea' => $packageId];
                    }
                    $packageLabels[$modalityCode] = (string)$row['modalidad_nombre'];
                }
            }

            if ($expanded === [] || count($expanded) > 1000) {
                api_error('No hay líneas válidas para anular.', 'VALIDATION_ERROR');
            }
            ksort($expanded);

            $beforeRows = [];
            foreach ($expanded as $line) {
                $isPayment = $line['tipo'] === 'CUOTA';
                $table = $isPayment ? 'pagos' : 'pagos_inscripciones';
                $idColumn = $isPayment ? 'id_pago' : 'id_pago_inscripcion';
                $legacyPrefix = $isPayment ? 'PAGO-' : 'INSCRIPCION-';
                $lock = $db->prepare(
                    "SELECT {$idColumn}, codigo_operacion, estado
                     FROM {$table} WHERE {$idColumn} = ? FOR UPDATE"
                );
                $lock->execute([$line['id_linea']]);
                $row = $lock->fetch();
                $rowCode = $row ? (string)($row['codigo_operacion'] ?: $legacyPrefix . $line['id_linea']) : '';
                if (!$row || $rowCode !== $code) {
                    api_error('Una línea ya no pertenece al registro mostrado. Actualizá la tabla.', 'OPERACION_DESACTUALIZADA', 409);
                }
                if (!in_array($row['estado'], self::ESTADOS_REGISTRADOS, true)) {
                    api_error('Una línea seleccionada ya fue anulada.', 'OPERACION_SIN_CAMBIOS', 409);
                }
                $beforeRows = array_merge(
                    $beforeRows,
                    $isPayment
                        ? self::paymentRows($db, null, null, $line['id_linea'])
                        : self::registrationRows($db, null, null, $line['id_linea'])
                );
            }

            $paymentIds = [];
            $registrationIds = [];
            foreach ($expanded as $line) {
                if ($line['tipo'] === 'CUOTA') {
                    $paymentIds[] = (int)$line['id_linea'];
                } else {
                    $registrationIds[] = (int)$line['id_linea'];
                }
            }

            // Se actualiza por tabla y en bloque. Además de ser más eficiente,
            // evita estados parciales dentro de una misma operación.
            $paymentMutation = self::annulLockedRows($db, 'pagos', 'id_pago', $paymentIds);
            $registrationMutation = self::annulLockedRows(
                $db,
                'pagos_inscripciones',
                'id_pago_inscripcion',
                $registrationIds
            );
            $affected = (int)$paymentMutation['afectados'] + (int)$registrationMutation['afectados'];
            $physicalDeletion = (bool)$paymentMutation['eliminacion_fisica']
                || (bool)$registrationMutation['eliminacion_fisica'];
            $fallbackAnnulled = (bool)$paymentMutation['fallback_anulado']
                || (bool)$registrationMutation['fallback_anulado'];

            if ($affected !== count($expanded)) {
                api_error('No se pudieron anular todas las líneas del registro.', 'OPERACION_DESACTUALIZADA', 409);
            }

            $before = self::groupOperations($beforeRows)[0] ?? [
                'codigo_operacion' => $code,
                'lineas' => $beforeRows,
            ];
            $types = array_unique(array_column($expanded, 'tipo'));
            $auditTable = count($types) === 1 && reset($expanded)['tipo'] === 'INSCRIPCION'
                ? 'pagos_inscripciones'
                : 'pagos';
            $packageText = $combinedOperation
                ? 'Se anuló el cobro completo de cuotas e inscripción.'
                : ($packageLabels === []
                    ? 'Se anularon las líneas seleccionadas del registro.'
                    : 'Se anuló el paquete completo de ' . implode(' / ', array_values($packageLabels)) . '.');
            try {
                audit_change(
                    $db,
                    $auth,
                    'CUOTAS',
                    'ANULAR',
                    $auditTable,
                    $code,
                    $packageText,
                    $before,
                    [
                        'estado' => $physicalDeletion ? 'ELIMINADO' : 'ANULADO',
                        'modalidades_atomicas' => array_keys($packageLabels),
                        'lineas' => array_values($expanded),
                    ]
                );
            } catch (Throwable $auditError) {
                // La auditoría se registra siempre que la tabla esté disponible,
                // pero una inconsistencia histórica en ella no debe deshacer la
                // eliminación que ya fue validada y ejecutada correctamente.
                error_log(
                    'No se pudo auditar la anulación de cuotas ' . $code . ': '
                    . $auditError->getMessage()
                );
            }

            return [
                'registros_anulados' => $affected,
                'modalidades_atomicas' => array_values($packageLabels),
                'cobro_atomico' => $combinedOperation,
                'eliminacion_fisica' => $physicalDeletion,
                'compatibilidad_legacy' => $fallbackAnnulled,
            ];
        });

        return ['codigo_operacion' => $code] + $result;
    }
}
