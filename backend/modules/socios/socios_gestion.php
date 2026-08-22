<?php
declare(strict_types=1);

trait SociosGestion
{
    /**
     * Contrato interno del trait.
     *
     * Estos métodos son implementados por SociosConsultas, que se compone
     * junto con SociosGestion dentro de la clase Socios. Declararlos como
     * requisitos abstractos permite que PHP e Intelephense conozcan el
     * contrato entre ambos traits sin duplicar la implementación.
     */
    abstract private static function detalle(PDO $db, int $id): ?array;
    abstract private static function impactoEliminacion(PDO $db, int $id): array;
    abstract private static function proximoIdSocio(PDO $db): int;

    private static function guardarDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = null;
        if (($body['id_socio'] ?? '') !== '' && ($body['id_socio'] ?? null) !== null) {
            $id = positive_id($body['id_socio'], 'socio');
        }

        $requestedNewId = null;
        if (($body['id_socio_nuevo'] ?? '') !== '' && ($body['id_socio_nuevo'] ?? null) !== null) {
            if ($id !== null) {
                api_error('No se puede enviar un número de alta al editar un socio.', 'VALIDATION_ERROR', 422, ['campo' => 'id_socio']);
            }
            $requestedNewId = positive_id($body['id_socio_nuevo'], 'número de socio');
        }

        $data = self::validarSocio($db, $body, $id);

        try {
            $result = transaction($db, function () use ($db, $auth, $data, $id, $requestedNewId): array {
                if ($id === null) {
                    $currentNextId = self::proximoIdSocio($db);
                    $newId = $requestedNewId ?? $currentNextId;
                    if ($requestedNewId !== null && $requestedNewId !== $currentNextId) {
                        api_error(
                            'El número de socio mostrado ya no está disponible. Se debe actualizar antes de crear el socio.',
                            'ID_SOCIO_DESACTUALIZADO',
                            409,
                            ['campo' => 'id_socio', 'id_socio_sugerido' => $currentNextId]
                        );
                    }

                    $statement = $db->prepare(
                        'INSERT INTO socios
                         (id_socio, nombre, id_cobrador, id_grupo_sanguineo, id_categoria, domicilio, numero,
                          telefono_movil, telefono_fijo, observaciones, fecha_nacimiento, id_estado,
                          domicilio_cobro, dni, fecha_ingreso, vigente)
                         VALUES
                         (:id_socio, :nombre, :id_cobrador, :id_grupo_sanguineo, :id_categoria, :domicilio, :numero,
                          :telefono_movil, :telefono_fijo, :observaciones, :fecha_nacimiento, :id_estado,
                          :domicilio_cobro, :dni, :fecha_ingreso, 1)'
                    );
                    $statement->execute(['id_socio' => $newId] + $data);
                    $after = self::detalle($db, $newId);
                    if (!$after) {
                        throw new RuntimeException('No se pudo recuperar el socio recién creado.');
                    }

                    self::insertarHistorialEstado(
                        $db,
                        $newId,
                        'ALTA',
                        null,
                        $after['id_estado'],
                        null,
                        true,
                        ($after['fecha_ingreso'] ?: date('Y-m-d')) . ' 00:00:00',
                        'ALTA DE SOCIO',
                        null,
                        $auth['id_usuario']
                    );
                    self::auditarSocio($db, $auth, 'socios', $newId, 'INSERT', null, $after);

                    return ['item' => $after, 'creado' => true];
                }

                $lock = $db->prepare('SELECT * FROM socios WHERE id_socio = ? FOR UPDATE');
                $lock->execute([$id]);
                $rawBefore = $lock->fetch();
                if (!$rawBefore) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);

                $before = self::detalle($db, $id);
                $statement = $db->prepare(
                    'UPDATE socios SET
                        nombre = :nombre,
                        id_cobrador = :id_cobrador,
                        id_grupo_sanguineo = :id_grupo_sanguineo,
                        id_categoria = :id_categoria,
                        domicilio = :domicilio,
                        numero = :numero,
                        telefono_movil = :telefono_movil,
                        telefono_fijo = :telefono_fijo,
                        observaciones = :observaciones,
                        fecha_nacimiento = :fecha_nacimiento,
                        id_estado = :id_estado,
                        domicilio_cobro = :domicilio_cobro,
                        dni = :dni,
                        fecha_ingreso = :fecha_ingreso
                     WHERE id_socio = :id_socio'
                );
                $statement->execute($data + ['id_socio' => $id]);

                $after = self::detalle($db, $id);
                if (!$after) throw new RuntimeException('No se pudo recuperar el socio actualizado.');

                $previousState = $rawBefore['id_estado'] === null ? null : (int)$rawBefore['id_estado'];
                $newState = $after['id_estado'];
                if ($previousState !== $newState) {
                    self::insertarHistorialEstado(
                        $db,
                        $id,
                        'CAMBIO_ESTADO',
                        $previousState,
                        $newState,
                        (bool)$rawBefore['vigente'],
                        (bool)$rawBefore['vigente'],
                        date('Y-m-d H:i:s'),
                        'CAMBIO DE ESTADO',
                        null,
                        $auth['id_usuario']
                    );
                }

                self::auditarSocio($db, $auth, 'socios', $id, 'UPDATE', $before, $after);
                return ['item' => $after, 'creado' => false];
            });
        } catch (PDOException $error) {
            self::resolverErrorPersistenciaSocio($db, $error);
        }

        return $result;
    }

    private static function darBajaDatos(array $auth, int $id, string $date, string $reason): array
    {
        $db = $auth['db'];
        $saved = transaction($db, function () use ($db, $auth, $id, $date, $reason): array {
            $lock = $db->prepare('SELECT * FROM socios WHERE id_socio = ? FOR UPDATE');
            $lock->execute([$id]);
            $raw = $lock->fetch();
            if (!$raw) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);
            if (!(bool)$raw['vigente']) api_error('El socio ya está dado de baja.', 'SOCIO_YA_BAJA', 409);

            if ($raw['fecha_ingreso'] && $date < (string)$raw['fecha_ingreso']) {
                api_error('La fecha de baja no puede ser anterior a la fecha de ingreso.', 'VALIDATION_ERROR', 422, ['campo' => 'fecha_baja']);
            }

            self::validarFechaTransicionSocio($db, $id, $date, 'baja');

            $before = self::detalle($db, $id);
            self::cerrarVinculosFamiliaresPorBaja($db, $id, $date);

            // Marcamos hasta qué fila de historial existía ANTES de cambiar la
            // vigencia. Algunas bases heredadas tienen un trigger sobre socios
            // que, al ejecutar el UPDATE siguiente, crea automáticamente una
            // BAJA sin motivo. Si luego insertáramos otra BAJA tendríamos dos
            // eventos para la misma transición y la fila automática (con la hora
            // actual) podría ganar en las consultas aunque motivo fuese NULL.
            $historyMarkerStatement = $db->prepare(
                'SELECT COALESCE(MAX(id_historial), 0)
                 FROM socios_historial_estados
                 WHERE id_socio = ?'
            );
            $historyMarkerStatement->execute([$id]);
            $historyMarker = (int)$historyMarkerStatement->fetchColumn();

            $db->prepare('UPDATE socios SET vigente = 0 WHERE id_socio = ?')->execute([$id]);

            self::registrarHistorialBajaTrasCambioVigencia(
                $db,
                $id,
                $raw['id_estado'] === null ? null : (int)$raw['id_estado'],
                $date,
                $reason,
                (int)$auth['id_usuario'],
                $historyMarker
            );

            $after = self::detalle($db, $id);
            if (!$after) throw new RuntimeException('No se pudo recuperar el socio después de la baja.');

            self::auditarSocio($db, $auth, 'socios', $id, 'UPDATE', $before, $after);
            return $after;
        });

        return ['item' => $saved];
    }

    /**
     * Registra la BAJA sin duplicar el evento que pueda crear un trigger
     * heredado al cambiar socios.vigente. Si el UPDATE generó una BAJA nueva
     * después de $historyMarker, completamos ESA misma fila con los datos
     * ingresados por el usuario. Si no existe trigger, usamos el flujo normal.
     */
    private static function registrarHistorialBajaTrasCambioVigencia(
        PDO $db,
        int $id,
        ?int $stateId,
        string $date,
        string $reason,
        int $userId,
        int $historyMarker
    ): void {
        $generated = $db->prepare(
            "SELECT id_historial
             FROM socios_historial_estados
             WHERE id_socio = ?
               AND id_historial > ?
               AND tipo_evento = 'BAJA'
               AND vigente_anterior = 1
               AND vigente_nuevo = 0
             ORDER BY id_historial DESC
             LIMIT 1
             FOR UPDATE"
        );
        $generated->execute([$id, $historyMarker]);
        $generatedId = (int)($generated->fetchColumn() ?: 0);

        if ($generatedId > 0) {
            $update = $db->prepare(
                "UPDATE socios_historial_estados
                 SET id_estado_anterior = ?,
                     id_estado_nuevo = ?,
                     vigente_anterior = 1,
                     vigente_nuevo = 0,
                     fecha_evento = ?,
                     motivo = ?,
                     id_usuario = ?,
                     origen = 'SISTEMA'
                 WHERE id_historial = ?"
            );
            $update->execute([
                $stateId,
                $stateId,
                $date . ' 00:00:00',
                $reason,
                $userId,
                $generatedId,
            ]);
            return;
        }

        self::insertarHistorialEstado(
            $db,
            $id,
            'BAJA',
            $stateId,
            $stateId,
            true,
            false,
            $date . ' 00:00:00',
            $reason,
            null,
            $userId
        );
    }

    private static function reactivarDatos(array $auth, int $id, string $date, ?string $reason): array
    {
        $db = $auth['db'];
        $saved = transaction($db, function () use ($db, $auth, $id, $date, $reason): array {
            $lock = $db->prepare('SELECT * FROM socios WHERE id_socio = ? FOR UPDATE');
            $lock->execute([$id]);
            $raw = $lock->fetch();
            if (!$raw) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);
            if ((bool)$raw['vigente']) api_error('El socio ya está vigente.', 'SOCIO_YA_VIGENTE', 409);

            self::validarFechaTransicionSocio($db, $id, $date, 'reactivación');

            $before = self::detalle($db, $id);
            $db->prepare('UPDATE socios SET vigente = 1 WHERE id_socio = ?')->execute([$id]);
            $after = self::detalle($db, $id);
            if (!$after) throw new RuntimeException('No se pudo recuperar el socio después de la reactivación.');

            self::insertarHistorialEstado(
                $db,
                $id,
                'REACTIVACION',
                $raw['id_estado'] === null ? null : (int)$raw['id_estado'],
                $raw['id_estado'] === null ? null : (int)$raw['id_estado'],
                false,
                true,
                $date . ' 00:00:00',
                $reason ?: 'REACTIVACIÓN DE SOCIO',
                null,
                $auth['id_usuario']
            );
            self::auditarSocio($db, $auth, 'socios', $id, 'UPDATE', $before, $after);
            return $after;
        });

        return ['item' => $saved];
    }

    /**
     * Una baja termina también la pertenencia familiar vigente en esa fecha.
     * Dejar el vínculo abierto haría que el socio siguiera contando para
     * descuentos familiares posteriores aunque ya no estuviera vigente.
     */
    private static function cerrarVinculosFamiliaresPorBaja(PDO $db, int $id, string $date): void
    {
        $statement = $db->prepare(
            'SELECT id_familia_socio, desde
             FROM familias_socios
             WHERE id_socio = ? AND activo = 1
             FOR UPDATE'
        );
        $statement->execute([$id]);
        $links = $statement->fetchAll(PDO::FETCH_ASSOC);
        foreach ($links as $link) {
            $from = trim((string)($link['desde'] ?? ''));
            if ($from !== '' && $date < $from) {
                api_error(
                    "La fecha de baja no puede ser anterior al inicio de una pertenencia familiar vigente ({$from}). Ajustá primero las fechas de la familia.",
                    'BAJA_SUPERPONE_FAMILIA',
                    409,
                    ['fecha_inicio_familia' => $from]
                );
            }
        }
        if ($links === []) return;

        $db->prepare(
            'UPDATE familias_socios
             SET activo = 0,
                 hasta = CASE WHEN hasta IS NULL OR hasta > ? THEN ? ELSE hasta END,
                 actualizado_en = CURRENT_TIMESTAMP
             WHERE id_socio = ? AND activo = 1'
        )->execute([$date, $date, $id]);
    }

    private static function validarFechaTransicionSocio(PDO $db, int $id, string $date, string $label): void
    {
        $statement = $db->prepare(
            "SELECT MAX(DATE(fecha_evento))
             FROM socios_historial_estados
             WHERE id_socio = ?
               AND fecha_evento IS NOT NULL
               AND tipo_evento IN ('ALTA','BAJA','REACTIVACION')"
        );
        $statement->execute([$id]);
        $lastDate = $statement->fetchColumn();
        if ($lastDate !== false && $lastDate !== null && $date < (string)$lastDate) {
            api_error(
                "La fecha de {$label} no puede ser anterior a la última transición registrada ({$lastDate}).",
                'CRONOLOGIA_SOCIO_INVALIDA',
                409,
                ['fecha_ultima_transicion' => (string)$lastDate]
            );
        }
    }

    private static function registrarContactoDatos(array $auth, array $body): array
    {
        $db = $auth['db'];
        $id = positive_id($body['id_socio'] ?? $body['id'] ?? null, 'socio');
        $date = valid_date($body['fecha_contacto'] ?? date('Y-m-d'), 'contacto');
        if ($date > date('Y-m-d')) {
            api_error('La fecha del contacto no puede ser futura.', 'VALIDATION_ERROR', 422, ['campo' => 'fecha_contacto']);
        }

        $status = strtoupper(trim((string)($body['estado_contacto'] ?? '')));
        if (!in_array($status, ['CONTACTADO', 'PENDIENTE', 'NO_CONTACTADO'], true)) {
            api_error('Seleccioná un estado de gestión válido.', 'VALIDATION_ERROR', 422, ['campo' => 'estado_contacto']);
        }
        $detail = optional_text($body['detalle_contacto'] ?? null, 4000);

        return transaction($db, function () use ($db, $auth, $id, $date, $status, $detail): array {
            $lock = $db->prepare('SELECT id_socio, nombre, fecha_nacimiento, vigente FROM socios WHERE id_socio = ? FOR UPDATE');
            $lock->execute([$id]);
            $socio = $lock->fetch();
            if (!$socio) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);

            $statement = $db->prepare(
                'INSERT INTO socios_contactos
                 (id_socio, fecha_contacto, estado_contacto, detalle_contacto, id_usuario)
                 VALUES (?, ?, ?, ?, ?)'
            );
            $statement->execute([$id, $date, $status, $detail, $auth['id_usuario']]);
            $contactId = (int)$db->lastInsertId();

            $contact = [
                'id_contacto' => $contactId,
                'id_socio' => $id,
                'fecha_contacto' => $date,
                'estado_contacto' => $status,
                'detalle_contacto' => $detail,
                'id_usuario' => $auth['id_usuario'],
                'usuario' => $auth['usuario'],
            ];
            self::auditarSocio($db, $auth, 'socios_contactos', $contactId, 'INSERT', null, $contact);

            // Solo una gestión efectivamente CONTACTADA cierra automáticamente
            // el aviso anual. PENDIENTE / NO_CONTACTADO conservan la tarjeta
            // para que el equipo pueda volver a intentar el seguimiento.
            if ($status === 'CONTACTADO') {
                self::cerrarAvisoCumpleaniosInterno($db, $auth, $socio, 'CONTACTO');
            }

            return [
                'contacto' => $contact,
                'item' => self::detalle($db, $id),
            ];
        });
    }

    private static function cerrarCumpleaniosDatos(array $auth, int $id): array
    {
        $db = $auth['db'];
        return transaction($db, function () use ($db, $auth, $id): array {
            $lock = $db->prepare('SELECT id_socio, nombre, fecha_nacimiento, vigente FROM socios WHERE id_socio = ? FOR UPDATE');
            $lock->execute([$id]);
            $socio = $lock->fetch();
            if (!$socio) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);
            if (!(bool)$socio['vigente']) api_error('El socio ya no está vigente.', 'SOCIO_NO_VIGENTE', 409);
            if (!$socio['fecha_nacimiento']) api_error('El socio no tiene fecha de nacimiento registrada.', 'SIN_FECHA_NACIMIENTO', 409);

            $age = self::edadActual((string)$socio['fecha_nacimiento']);
            if ($age < 18 || $age > 23) {
                api_error('El socio ya no pertenece al rango de avisos de 18 a 23 años.', 'FUERA_RANGO_CUMPLEANIOS', 409);
            }

            $closure = self::cerrarAvisoCumpleaniosInterno($db, $auth, $socio, 'MANUAL');
            return ['cierre' => $closure, 'id_socio' => $id];
        });
    }

    private static function eliminarDefinitivoDatos(array $auth, int $id): array
    {
        $db = $auth['db'];

        $result = transaction($db, function () use ($db, $id): array {
            $lock = $db->prepare('SELECT * FROM socios WHERE id_socio = ? FOR UPDATE');
            $lock->execute([$id]);
            $socio = $lock->fetch();
            if (!$socio) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);

            // El impacto es meramente informativo. Si una tabla opcional no
            // existe en una instalación local, nunca debe impedir el borrado.
            $impact = self::impactoEliminacion($db, $id);

            // Una eliminación definitiva sólo es válida para altas cargadas por
            // error que todavía no generaron historia económica ni familiar.
            // Los movimientos contables deben sobrevivir a la baja del socio.
            $financial = ((int)($impact['pagos'] ?? 0)) + ((int)($impact['pagos_inscripcion'] ?? 0));
            $familyLinks = (int)($impact['vinculos_familiares'] ?? 0);
            if ($financial > 0 || $familyLinks > 0) {
                api_error(
                    'No se puede eliminar definitivamente un socio con pagos, inscripciones o vínculos familiares históricos. Dale de baja para conservar intacta la información contable.',
                    'SOCIO_CON_HISTORIAL_NO_ELIMINABLE',
                    409,
                    [
                        'pagos' => (int)($impact['pagos'] ?? 0),
                        'pagos_inscripcion' => (int)($impact['pagos_inscripcion'] ?? 0),
                        'vinculos_familiares' => $familyLinks,
                    ]
                );
            }

            // Descubre relaciones a partir del esquema REAL de la conexión y
            // suma un fallback de las tablas conocidas de RH Negativo V2. De
            // esta manera una DB local levemente desactualizada no genera 500
            // por intentar borrar una tabla/columna que todavía no existe.
            $relations = self::descubrirRelacionesSocio($db);
            $eliminados = self::eliminarRelacionesSocio($db, $id, $relations);

            try {
                $delete = $db->prepare('DELETE FROM socios WHERE id_socio = ?');
                $delete->execute([$id]);
            } catch (PDOException $error) {
                // Si MySQL todavía informa una FK, intentamos descubrir de
                // nuevo únicamente las FK reales y limpiarlas una vez más.
                // Esto cubre esquemas que agregaron una tabla nueva y evita
                // desactivar FOREIGN_KEY_CHECKS, que podría dejar huérfanos.
                $driverCode = (int)($error->errorInfo[1] ?? 0);
                if ($driverCode !== 1451 && $driverCode !== 1452) throw $error;

                $extra = self::descubrirForeignKeysSocio($db);
                $extraDeleted = self::eliminarRelacionesSocio($db, $id, $extra);
                foreach ($extraDeleted as $table => $count) {
                    $eliminados[$table] = ($eliminados[$table] ?? 0) + $count;
                }

                $delete = $db->prepare('DELETE FROM socios WHERE id_socio = ?');
                $delete->execute([$id]);
            }

            if ($delete->rowCount() !== 1) {
                throw new RuntimeException('El registro principal del socio no fue eliminado.');
            }

            return [
                'id_socio' => $id,
                'impacto' => $impact,
                'eliminados' => $eliminados,
                '_auditoria' => [
                    'socio' => $socio,
                    'impacto' => $impact,
                    'eliminados' => $eliminados,
                ],
            ];
        });

        // La auditoría se escribe después del COMMIT. Si por un problema de
        // auditoría falla el INSERT, el socio ya eliminado no reaparece.
        $auditData = $result['_auditoria'] ?? null;
        unset($result['_auditoria']);
        if ($auditData !== null) {
            try {
                self::auditarSocio($db, $auth, 'socios', $id, 'DELETE', $auditData, null);
            } catch (Throwable $auditError) {
                error_log('[socios_eliminar_definitivo][auditoria] ' . $auditError->__toString());
                $result['auditoria_registrada'] = false;
            }
        }

        return $result;
    }

    /**
     * Devuelve todas las columnas que pueden relacionar una fila con socios.
     * Combina FK reales + columnas convencionales + fallback conocido.
     *
     * @return array<string,array<int,string>>
     */
    private static function descubrirRelacionesSocio(PDO $db): array
    {
        $relations = self::descubrirForeignKeysSocio($db);

        // Además de las FK buscamos columnas de relación convencionales. Esto
        // cubre socios_fusiones.id_socio_origen (sin FK en el dump actual) y
        // futuras tablas auxiliares del mismo sistema.
        try {
            $statement = $db->query(
                "SELECT TABLE_NAME, COLUMN_NAME
                   FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME <> 'socios'
                    AND COLUMN_NAME IN ('id_socio','id_socio_origen','id_socio_destino')"
            );
            if ($statement !== false) {
                foreach ($statement->fetchAll() as $row) {
                    self::agregarRelacionSocio(
                        $relations,
                        (string)($row['TABLE_NAME'] ?? ''),
                        (string)($row['COLUMN_NAME'] ?? '')
                    );
                }
            }
        } catch (Throwable $schemaError) {
            error_log('[socios_eliminar_definitivo][columns] ' . $schemaError->getMessage());
        }

        // Fallback compatible con el esquema entregado. La eliminación valida
        // existencia real antes de ejecutar, por lo que no rompe instalaciones
        // donde alguna de estas tablas todavía no fue creada.
        $fallback = [
            'familias_socios' => ['id_socio'],
            'pagos_inscripcion' => ['id_socio'],
            'pagos' => ['id_socio'],
            'socios_contactos' => ['id_socio'],
            'socios_cumpleanios_cierres' => ['id_socio'],
            'socios_historial_estados' => ['id_socio'],
            'socios_fusiones' => ['id_socio_origen', 'id_socio_destino'],
        ];
        foreach ($fallback as $table => $columns) {
            foreach ($columns as $column) self::agregarRelacionSocio($relations, $table, $column);
        }

        return $relations;
    }

    /** @return array<string,array<int,string>> */
    private static function descubrirForeignKeysSocio(PDO $db): array
    {
        $relations = [];
        try {
            $statement = $db->query(
                "SELECT TABLE_NAME, COLUMN_NAME
                   FROM information_schema.KEY_COLUMN_USAGE
                  WHERE TABLE_SCHEMA = DATABASE()
                    AND REFERENCED_TABLE_NAME = 'socios'
                    AND REFERENCED_COLUMN_NAME = 'id_socio'"
            );
            if ($statement !== false) {
                foreach ($statement->fetchAll() as $row) {
                    self::agregarRelacionSocio(
                        $relations,
                        (string)($row['TABLE_NAME'] ?? ''),
                        (string)($row['COLUMN_NAME'] ?? '')
                    );
                }
            }
        } catch (Throwable $schemaError) {
            error_log('[socios_eliminar_definitivo][foreign_keys] ' . $schemaError->getMessage());
        }
        return $relations;
    }

    private static function agregarRelacionSocio(array &$relations, string $table, string $column): void
    {
        if ($table === 'socios') return;
        if (!self::identificadorSqlSeguro($table) || !self::identificadorSqlSeguro($column)) return;
        $relations[$table] ??= [];
        if (!in_array($column, $relations[$table], true)) $relations[$table][] = $column;
    }

    /**
     * @param array<string,array<int,string>> $relations
     * @return array<string,int>
     */
    private static function eliminarRelacionesSocio(PDO $db, int $id, array $relations): array
    {
        $deleted = [];
        foreach ($relations as $table => $columns) {
            if (!self::identificadorSqlSeguro($table) || $table === 'socios') continue;

            $validColumns = [];
            foreach (array_unique($columns) as $column) {
                if (!self::identificadorSqlSeguro((string)$column)) continue;
                if (!self::columnaRelacionExiste($db, $table, (string)$column)) continue;
                $validColumns[] = (string)$column;
            }
            if ($validColumns === []) continue;

            $where = implode(' OR ', array_map(
                static fn(string $column): string => "`{$column}` = ?",
                $validColumns
            ));
            $params = array_fill(0, count($validColumns), $id);

            try {
                $statement = $db->prepare("DELETE FROM `{$table}` WHERE {$where}");
                $statement->execute($params);
                $deleted[$table] = ($deleted[$table] ?? 0) + $statement->rowCount();
            } catch (PDOException $error) {
                $driverCode = (int)($error->errorInfo[1] ?? 0);
                // 1146 = tabla inexistente / 1054 = columna inexistente. Son
                // diferencias de versión del esquema, no un motivo para abortar.
                if ($driverCode === 1146 || $driverCode === 1054) {
                    error_log('[socios_eliminar_definitivo][skip][' . $table . '] ' . $error->getMessage());
                    continue;
                }
                throw $error;
            }
        }
        return $deleted;
    }

    private static function columnaRelacionExiste(PDO $db, string $table, string $column): bool
    {
        try {
            $statement = $db->prepare(
                'SELECT COUNT(*)
                   FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = ?
                    AND COLUMN_NAME = ?'
            );
            $statement->execute([$table, $column]);
            return (int)$statement->fetchColumn() > 0;
        } catch (Throwable $schemaError) {
            // En hosting con information_schema restringido probamos la
            // consulta real y dejamos que eliminarRelacionesSocio maneje
            // únicamente los errores de tabla/columna inexistente.
            return true;
        }
    }

    private static function identificadorSqlSeguro(string $value): bool
    {
        return $value !== '' && preg_match('/^[A-Za-z0-9_]+$/D', $value) === 1;
    }

    private static function validarSocio(PDO $db, array $body, ?int $editingId): array
    {
        $current = null;
        if ($editingId !== null) {
            $currentStatement = $db->prepare(
                'SELECT id_cobrador, id_categoria, id_grupo_sanguineo, id_estado, fecha_ingreso FROM socios WHERE id_socio = ? LIMIT 1'
            );
            $currentStatement->execute([$editingId]);
            $current = $currentStatement->fetch();
            if (!$current) api_error('El socio no existe.', 'SOCIO_NO_ENCONTRADO', 404);
        }

        $name = required_text($body, 'nombre', 'nombre', 100);
        $collectorId = positive_id($body['id_cobrador'] ?? null, 'cobrador');
        $categoryId = positive_id($body['id_categoria'] ?? null, 'categoría');
        $bloodId = self::optionalPositiveId($body['id_grupo_sanguineo'] ?? null, 'grupo sanguíneo');
        $stateId = self::optionalPositiveId($body['id_estado'] ?? null, 'estado');

        self::validarCatalogo($db, 'cobrador', 'id_cobrador', $collectorId, 'cobrador', $current && (int)$current['id_cobrador'] === $collectorId);
        self::validarCatalogo($db, 'categoria', 'id_categoria', $categoryId, 'categoría', $current && (int)$current['id_categoria'] === $categoryId);
        if ($bloodId !== null) {
            self::validarCatalogo(
                $db,
                'grupo_sanguineo',
                'id_grupo_sanguineo',
                $bloodId,
                'grupo sanguíneo',
                $current && $current['id_grupo_sanguineo'] !== null && (int)$current['id_grupo_sanguineo'] === $bloodId
            );
        }
        if ($stateId !== null) {
            self::validarCatalogo(
                $db,
                'estado',
                'id_estado',
                $stateId,
                'estado',
                $current && $current['id_estado'] !== null && (int)$current['id_estado'] === $stateId
            );
        }

        $dni = preg_replace('/\D+/', '', (string)($body['dni'] ?? '')) ?? '';
        if ($dni !== '' && !preg_match('/^[0-9]{6,15}$/', $dni)) {
            api_error('El DNI debe contener entre 6 y 15 dígitos.', 'VALIDATION_ERROR', 422, ['campo' => 'dni']);
        }
        if ($dni !== '') {
            $sql = 'SELECT id_socio FROM socios WHERE dni = ?' . ($editingId !== null ? ' AND id_socio <> ?' : '') . ' LIMIT 1';
            $statement = $db->prepare($sql);
            $statement->execute($editingId !== null ? [$dni, $editingId] : [$dni]);
            if ($statement->fetchColumn()) api_error('Ya existe un socio con ese DNI.', 'DNI_DUPLICADO', 409, ['campo' => 'dni']);
        }

        $birth = valid_date($body['fecha_nacimiento'] ?? '', 'nacimiento', false);
        if ($birth !== null && $birth > date('Y-m-d')) {
            api_error('La fecha de nacimiento no puede ser futura.', 'VALIDATION_ERROR', 422, ['campo' => 'fecha_nacimiento']);
        }
        $joined = valid_date($body['fecha_ingreso'] ?? '', 'ingreso', false);
        if ($joined !== null && $joined > date('Y-m-d')) {
            api_error('La fecha de ingreso no puede ser futura.', 'VALIDATION_ERROR', 422, ['campo' => 'fecha_ingreso']);
        }
        if ($birth !== null && $joined !== null && $joined < $birth) {
            api_error('La fecha de ingreso no puede ser anterior a la fecha de nacimiento.', 'VALIDATION_ERROR', 422, ['campo' => 'fecha_ingreso']);
        }

        if ($editingId !== null && $current !== null) {
            $previousJoined = $current['fecha_ingreso'] === null ? null : (string)$current['fecha_ingreso'];
            if ($previousJoined !== $joined) {
                self::validarCambioFechaIngreso($db, $editingId, $joined);
            }
        }

        return [
            'nombre' => $name,
            'id_cobrador' => $collectorId,
            'id_grupo_sanguineo' => $bloodId,
            'id_categoria' => $categoryId,
            'domicilio' => optional_text($body['domicilio'] ?? null, 100),
            'numero' => optional_text($body['numero'] ?? null, 20),
            'telefono_movil' => self::normalizarTelefono($body['telefono_movil'] ?? null),
            'telefono_fijo' => self::normalizarTelefono($body['telefono_fijo'] ?? null),
            'observaciones' => optional_text($body['observaciones'] ?? null, 8000),
            'fecha_nacimiento' => $birth,
            'id_estado' => $stateId,
            'domicilio_cobro' => optional_text($body['domicilio_cobro'] ?? null, 150),
            'dni' => $dni === '' ? null : $dni,
            'fecha_ingreso' => $joined,
        ];
    }

    /**
     * La fecha de ingreso participa en deuda y reportes históricos. Si el socio
     * ya tiene actividad, sólo permitimos moverla a una fecha que no deje pagos,
     * inscripciones o transiciones de estado "antes de haber ingresado".
     */
    private static function validarCambioFechaIngreso(PDO $db, int $id, ?string $joined): void
    {
        $references = [];

        $statement = $db->prepare(
            'SELECT MIN(fecha_pago) FROM pagos WHERE id_socio = ?'
        );
        $statement->execute([$id]);
        $paymentDate = $statement->fetchColumn();
        if ($paymentDate !== false && $paymentDate !== null) {
            $references[] = (string)$paymentDate;
        }

        $statement = $db->prepare(
            "SELECT MIN(
                CASE
                    WHEN id_periodo = 7 THEN STR_TO_DATE(CONCAT(anio_aplicado, '-01-01'), '%Y-%m-%d')
                    WHEN id_periodo BETWEEN 1 AND 6 THEN STR_TO_DATE(
                        CONCAT(
                            anio_aplicado, '-',
                            LPAD(((id_periodo - 1) * 2) + 1, 2, '0'),
                            '-01'
                        ),
                        '%Y-%m-%d'
                    )
                    ELSE NULL
                END
             )
             FROM pagos
             WHERE id_socio = ?"
        );
        $statement->execute([$id]);
        $periodDate = $statement->fetchColumn();
        if ($periodDate !== false && $periodDate !== null) {
            $references[] = (string)$periodDate;
        }

        $statement = $db->prepare(
            'SELECT MIN(fecha_pago) FROM pagos_inscripcion WHERE id_socio = ?'
        );
        $statement->execute([$id]);
        $registrationDate = $statement->fetchColumn();
        if ($registrationDate !== false && $registrationDate !== null) {
            $references[] = (string)$registrationDate;
        }

        $statement = $db->prepare(
            "SELECT MIN(DATE(fecha_evento))
             FROM socios_historial_estados
             WHERE id_socio = ?
               AND fecha_evento IS NOT NULL
               AND tipo_evento IN ('BAJA','REACTIVACION')"
        );
        $statement->execute([$id]);
        $historyDate = $statement->fetchColumn();
        if ($historyDate !== false && $historyDate !== null) {
            $references[] = (string)$historyDate;
        }

        if ($references === []) return;

        sort($references, SORT_STRING);
        $earliest = $references[0];
        if ($joined === null || $joined > $earliest) {
            api_error(
                "La fecha de ingreso no puede quedar después del {$earliest} porque el socio ya posee actividad histórica. Podés corregirla a una fecha igual o anterior sin perder consistencia.",
                'FECHA_INGRESO_AFECTA_HISTORIAL',
                409,
                ['campo' => 'fecha_ingreso', 'fecha_limite' => $earliest]
            );
        }
    }

    private static function optionalPositiveId(mixed $value, string $label): ?int
    {
        if ($value === null || trim((string)$value) === '') return null;
        return positive_id($value, $label);
    }

    private static function validarCatalogo(PDO $db, string $table, string $idColumn, int $id, string $label, bool $allowInactive = false): void
    {
        $allowed = [
            'cobrador' => 'id_cobrador',
            'categoria' => 'id_categoria',
            'grupo_sanguineo' => 'id_grupo_sanguineo',
            'estado' => 'id_estado',
        ];
        if (($allowed[$table] ?? null) !== $idColumn) {
            throw new LogicException('Catálogo de socio no permitido.');
        }
        $statement = $db->prepare("SELECT activo FROM {$table} WHERE {$idColumn} = ? LIMIT 1");
        $statement->execute([$id]);
        $active = $statement->fetchColumn();
        if ($active === false) api_error("El {$label} seleccionado no existe.", 'VALIDATION_ERROR', 422);
        if (!(bool)$active && !$allowInactive) api_error("El {$label} seleccionado está inactivo.", 'VALIDATION_ERROR', 422);
    }

    private static function normalizarTelefono(mixed $value): ?string
    {
        $text = trim((string)$value);
        if ($text === '') return null;
        $digits = preg_replace('/\D+/', '', $text) ?? '';
        if ($digits === '' || strlen($digits) < 6 || strlen($digits) > 20) {
            api_error('El teléfono debe contener entre 6 y 20 dígitos.', 'VALIDATION_ERROR', 422);
        }
        return $digits;
    }

    private static function insertarHistorialEstado(
        PDO $db,
        int $id,
        string $event,
        ?int $previousState,
        ?int $newState,
        ?bool $previousActive,
        ?bool $newActive,
        string $eventDate,
        ?string $reason,
        ?string $observation,
        int $userId
    ): void {
        // Algunas instalaciones heredadas poseen triggers que ya registran el
        // ALTA. Sólo para ese evento absorbemos un duplicado exacto. Bajas y
        // reactivaciones pueden repetirse legítimamente el mismo día y siempre
        // deben conservar su secuencia completa.
        if ($event === 'ALTA') {
            $existing = $db->prepare(
                'SELECT id_historial, motivo, observacion, id_usuario
                 FROM socios_historial_estados
                 WHERE id_socio = ?
                   AND tipo_evento = ?
                   AND fecha_evento <=> ?
                   AND id_estado_nuevo <=> ?
                   AND vigente_nuevo <=> ?
                 ORDER BY id_historial DESC
                 LIMIT 1
                 FOR UPDATE'
            );
            $existing->execute([
                $id,
                $event,
                $eventDate,
                $newState,
                $newActive === null ? null : (int)$newActive,
            ]);
            $row = $existing->fetch(PDO::FETCH_ASSOC);
            if ($row) {
                $db->prepare(
                    'UPDATE socios_historial_estados
                     SET motivo = COALESCE(motivo, ?),
                         observacion = COALESCE(observacion, ?),
                         id_usuario = COALESCE(id_usuario, ?)
                     WHERE id_historial = ?'
                )->execute([$reason, $observation, $userId, (int)$row['id_historial']]);
                return;
            }
        }

        $statement = $db->prepare(
            'INSERT INTO socios_historial_estados
             (id_socio, tipo_evento, id_estado_anterior, id_estado_nuevo,
              vigente_anterior, vigente_nuevo, fecha_evento, motivo, observacion,
              id_usuario, origen)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'SISTEMA\')'
        );
        $statement->execute([
            $id,
            $event,
            $previousState,
            $newState,
            $previousActive === null ? null : (int)$previousActive,
            $newActive === null ? null : (int)$newActive,
            $eventDate,
            $reason,
            $observation,
            $userId,
        ]);
    }

    private static function cerrarAvisoCumpleaniosInterno(PDO $db, array $auth, array $socio, string $origin): ?array
    {
        $birth = trim((string)($socio['fecha_nacimiento'] ?? ''));
        if ($birth === '' || !(bool)($socio['vigente'] ?? false)) return null;
        $age = self::edadActual($birth);
        if ($age < 18 || $age > 23) return null;

        $year = (int)date('Y');
        $existing = $db->prepare(
            "SELECT id_cierre, cerrado_en FROM socios_cumpleanios_cierres
             WHERE id_socio = ? AND anio = ? AND rango = '18-23' LIMIT 1"
        );
        $existing->execute([(int)$socio['id_socio'], $year]);
        $row = $existing->fetch();
        if ($row) {
            return [
                'id_cierre' => (int)$row['id_cierre'],
                'id_socio' => (int)$socio['id_socio'],
                'anio' => $year,
                'rango' => '18-23',
                'edad_al_cierre' => $age,
                'ya_cerrado' => true,
            ];
        }

        $statement = $db->prepare(
            "INSERT INTO socios_cumpleanios_cierres
             (id_socio, anio, rango, edad_al_cierre, fecha_nacimiento,
              cerrado_por_usuario_id, cerrado_por_nombre, origen)
             VALUES (?, ?, '18-23', ?, ?, ?, ?, ?)"
        );
        $statement->execute([
            (int)$socio['id_socio'],
            $year,
            $age,
            $birth,
            $auth['id_usuario'],
            clean_text($auth['usuario'] ?? 'USUARIO', 100),
            clean_text($origin, 30),
        ]);
        $closureId = (int)$db->lastInsertId();
        $closure = [
            'id_cierre' => $closureId,
            'id_socio' => (int)$socio['id_socio'],
            'anio' => $year,
            'rango' => '18-23',
            'edad_al_cierre' => $age,
            'fecha_nacimiento' => $birth,
            'origen' => $origin,
            'ya_cerrado' => false,
        ];
        self::auditarSocio($db, $auth, 'socios_cumpleanios_cierres', $closureId, 'INSERT', null, $closure);
        return $closure;
    }

    private static function edadActual(string $birth): int
    {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $birth);
        if (!$date) return -1;
        return (int)$date->diff(new DateTimeImmutable('today'))->y;
    }

    /**
     * La estructura de `auditoria` en RH Negativo V2 es distinta al helper
     * global heredado. Esta escritura local evita romper las operaciones del
     * módulo y respeta exactamente el esquema actual.
     */
    private static function auditarSocio(
        PDO $db,
        array $auth,
        string $table,
        int $recordId,
        string $action,
        mixed $before,
        mixed $after
    ): void {
        if (!in_array($action, ['INSERT', 'UPDATE', 'DELETE', 'MIGRACION', 'FUSION'], true)) {
            throw new LogicException('Acción de auditoría no permitida.');
        }
        $encode = static function (mixed $value): ?string {
            if ($value === null) return null;
            $json = json_encode(
                $value,
                JSON_UNESCAPED_UNICODE
                    | JSON_UNESCAPED_SLASHES
                    | JSON_INVALID_UTF8_SUBSTITUTE
                    | JSON_PARTIAL_OUTPUT_ON_ERROR
                    | JSON_PRESERVE_ZERO_FRACTION
            );
            return is_string($json) ? $json : '{"error":"No se pudo serializar la auditoría."}';
        };

        $statement = $db->prepare(
            'INSERT INTO auditoria
             (tabla, id_registro, accion, datos_anteriores, datos_nuevos, id_usuario, origen)
             VALUES (?, ?, ?, ?, ?, ?, \'SISTEMA\')'
        );
        $statement->execute([
            clean_text($table, 64, false),
            $recordId,
            $action,
            $encode($before),
            $encode($after),
            $auth['id_usuario'],
        ]);
    }

    private static function resolverErrorPersistenciaSocio(PDO $db, PDOException $error): never
    {
        $driverCode = (int)($error->errorInfo[1] ?? 0);
        if ($driverCode === 1062) {
            $message = strtoupper($error->getMessage());
            if (str_contains($message, 'PRIMARY')) {
                api_error(
                    'El número de socio mostrado acaba de ser utilizado por otra alta. Actualizalo y volvé a guardar.',
                    'ID_SOCIO_DESACTUALIZADO',
                    409,
                    ['campo' => 'id_socio', 'id_socio_sugerido' => self::proximoIdSocio($db)]
                );
            }
            api_error('Ya existe un socio con ese DNI.', 'DNI_DUPLICADO', 409, ['campo' => 'dni']);
        }
        if ($driverCode === 1451 || $driverCode === 1452) {
            api_error('La operación no pudo completarse por una relación de datos inválida.', 'RELACION_INVALIDA', 409);
        }
        throw $error;
    }
}
