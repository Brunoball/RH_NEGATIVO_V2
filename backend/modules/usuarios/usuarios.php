<?php
declare(strict_types=1);

// El archivo puede ser analizado o cargado de manera independiente sin depender
// del orden de includes de routes/api.php.
require_once __DIR__ . '/../../core/auth.php';
require_once __DIR__ . '/../../core/domain.php';
require_once __DIR__ . '/../../core/request.php';

final class Usuarios
{
    private const ROLES = ['admin', 'vista'];

    public static function listar(): never
    {
        $auth = require_admin();
        api_success(self::listarDatos($auth));
    }

    public static function guardar(): never
    {
        $auth = require_admin();
        $result = self::guardarDatos($auth, request_body());
        api_success(
            $result,
            $result['creado']
                ? 'Usuario creado correctamente.'
                : 'Usuario actualizado correctamente.'
        );
    }

    public static function cambiarEstado(): never
    {
        $auth = require_admin();
        $result = self::cambiarEstadoDatos($auth, request_body());
        api_success(
            $result,
            $result['activo']
                ? 'Usuario reactivado correctamente.'
                : 'Usuario dado de baja correctamente.'
        );
    }

    public static function eliminar(): never
    {
        $auth = require_admin();
        $result = self::eliminarDatos($auth, request_body());
        api_success($result, 'Usuario eliminado correctamente.');
    }

    private static function listarDatos(array $auth): array
    {
        $db = app_db();
        $statement = $db->query(
            "SELECT
                u.idUsuario,
                u.usuario,
                u.email,
                u.rol,
                u.activo,
                u.creado_en,
                (SELECT COUNT(*) FROM sis_sesiones s WHERE s.idUsuario = u.idUsuario) AS sesiones,
                (SELECT COUNT(*) FROM sis_login_auditoria la WHERE la.idUsuario = u.idUsuario) AS accesos
             FROM sis_usuarios u
             ORDER BY u.activo DESC, u.usuario ASC, u.idUsuario ASC"
        );

        $users = [];
        $summary = ['total' => 0, 'activos' => 0, 'bajas' => 0, 'admins' => 0];
        foreach ($statement->fetchAll() as $row) {
            $active = (bool)$row['activo'];
            $current = (int)$row['idUsuario'] === (int)$auth['id_usuario'];
            $sessions = (int)$row['sesiones'];
            $accesses = (int)$row['accesos'];

            $summary['total']++;
            $summary[$active ? 'activos' : 'bajas']++;
            if ((string)$row['rol'] === 'admin') $summary['admins']++;

            $users[] = [
                'id' => (int)$row['idUsuario'],
                'usuario' => (string)$row['usuario'],
                'email' => $row['email'] === null ? null : (string)$row['email'],
                'rol' => (string)$row['rol'],
                'activo' => $active,
                'creado_en' => $row['creado_en'] === null ? null : (string)$row['creado_en'],
                'sesion_actual' => $current,
                'cantidad_sesiones' => $sessions,
                'cantidad_accesos' => $accesses,
                'puede_cambiar_estado' => !$current,
                'puede_eliminar' => !$current,
            ];
        }

        return [
            'usuarios' => $users,
            'resumen' => $summary,
            'capacidades' => [
                'email' => true,
                'fecha_creacion' => true,
            ],
        ];
    }

    private static function guardarDatos(array $auth, array $body): array
    {
        $db = app_db();
        $id = self::optionalId($body['id'] ?? null);
        $username = self::username($body['usuario'] ?? '');
        $email = self::email($body['email'] ?? null);
        $role = self::role($body['rol'] ?? 'vista');
        $password = (string)($body['contrasena'] ?? '');
        $passwordConfirmation = (string)($body['confirmar_contrasena'] ?? '');

        if ($password !== '' || $id === null) {
            self::validatePassword($password, $passwordConfirmation);
        }

        return transaction($db, static function () use (
            $db,
            $auth,
            $id,
            $username,
            $email,
            $role,
            $password
        ): array {
            self::assertUniqueUsername($db, $username, $id);
            self::assertUniqueEmail($db, $email, $id);

            if ($id === null) {
                $insert = $db->prepare(
                    'INSERT INTO sis_usuarios
                     (usuario, hash_contrasena, email, rol, activo, creado_en, actualizado_en)
                     VALUES (?, ?, ?, ?, 1, NOW(), NOW())'
                );
                $insert->execute([
                    $username,
                    password_hash($password, PASSWORD_DEFAULT),
                    $email,
                    $role,
                ]);
                $savedId = (int)$db->lastInsertId();

                self::audit($auth, 'CREAR_USUARIO', $savedId, null, [
                    'usuario' => $username,
                    'email' => $email,
                    'rol' => $role,
                    'activo' => true,
                ]);

                return [
                    'creado' => true,
                    'usuario' => self::publicUser($savedId, $username, $email, $role, true, false),
                ];
            }

            $lock = $db->prepare(
                'SELECT idUsuario, usuario, email, rol, activo
                 FROM sis_usuarios
                 WHERE idUsuario = ?
                 FOR UPDATE'
            );
            $lock->execute([$id]);
            $existing = $lock->fetch();
            if (!$existing) api_error('El usuario solicitado no existe.', 'USUARIO_NO_ENCONTRADO', 404);

            $isCurrent = $id === (int)$auth['id_usuario'];
            if ($isCurrent && $role !== (string)$existing['rol']) {
                api_error('No podés cambiar el rol de tu propia sesión.', 'USUARIO_ACTUAL_ROL', 409);
            }
            if (
                (string)$existing['rol'] === 'admin'
                && $role !== 'admin'
                && (bool)$existing['activo']
            ) {
                self::assertAnotherActiveAdmin($db, $id);
            }

            $sets = ['usuario = ?', 'email = ?', 'rol = ?', 'actualizado_en = NOW()'];
            $values = [$username, $email, $role];
            if ($password !== '') {
                $sets[] = 'hash_contrasena = ?';
                $values[] = password_hash($password, PASSWORD_DEFAULT);
            }
            $values[] = $id;

            $db->prepare(
                'UPDATE sis_usuarios SET ' . implode(', ', $sets) . ' WHERE idUsuario = ?'
            )->execute($values);

            if ($password !== '') {
                if ($isCurrent) {
                    $db->prepare(
                        'UPDATE sis_sesiones SET activo = 0
                         WHERE idUsuario = ? AND idSesion <> ?'
                    )->execute([$id, $auth['id_sesion']]);
                } else {
                    $db->prepare('UPDATE sis_sesiones SET activo = 0 WHERE idUsuario = ?')
                        ->execute([$id]);
                }
            }

            self::audit($auth, 'EDITAR_USUARIO', $id, [
                'usuario' => (string)$existing['usuario'],
                'email' => $existing['email'],
                'rol' => (string)$existing['rol'],
                'activo' => (bool)$existing['activo'],
            ], [
                'usuario' => $username,
                'email' => $email,
                'rol' => $role,
                'contrasena_modificada' => $password !== '',
            ]);

            return [
                'creado' => false,
                'usuario' => self::publicUser(
                    $id,
                    $username,
                    $email,
                    $role,
                    (bool)$existing['activo'],
                    $isCurrent
                ),
            ];
        });
    }

    private static function cambiarEstadoDatos(array $auth, array $body): array
    {
        $db = app_db();
        $id = positive_id($body['id'] ?? null, 'usuario');
        $active = filter_var($body['activo'] ?? null, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);
        if ($active === null) api_error('El estado indicado no es válido.', 'VALIDATION_ERROR');
        if ($id === (int)$auth['id_usuario'] && !$active) {
            api_error('No podés dar de baja tu propia sesión.', 'USUARIO_ACTUAL_BAJA', 409);
        }

        return transaction($db, static function () use ($db, $auth, $id, $active): array {
            $lock = $db->prepare(
                'SELECT idUsuario, usuario, rol, activo
                 FROM sis_usuarios
                 WHERE idUsuario = ?
                 FOR UPDATE'
            );
            $lock->execute([$id]);
            $user = $lock->fetch();
            if (!$user) api_error('El usuario solicitado no existe.', 'USUARIO_NO_ENCONTRADO', 404);

            if (!$active && (string)$user['rol'] === 'admin' && (bool)$user['activo']) {
                self::assertAnotherActiveAdmin($db, $id);
            }

            $db->prepare(
                'UPDATE sis_usuarios SET activo = ?, actualizado_en = NOW() WHERE idUsuario = ?'
            )->execute([$active ? 1 : 0, $id]);

            if (!$active) {
                $db->prepare('UPDATE sis_sesiones SET activo = 0 WHERE idUsuario = ?')->execute([$id]);
            }

            self::audit(
                $auth,
                $active ? 'REACTIVAR_USUARIO' : 'DAR_BAJA_USUARIO',
                $id,
                ['activo' => (bool)$user['activo']],
                ['activo' => $active]
            );

            return ['id' => $id, 'activo' => $active];
        });
    }

    private static function eliminarDatos(array $auth, array $body): array
    {
        $db = app_db();
        $id = positive_id($body['id'] ?? null, 'usuario');
        if ($id === (int)$auth['id_usuario']) {
            api_error('No podés eliminar tu propia sesión.', 'USUARIO_ACTUAL_ELIMINAR', 409);
        }

        return transaction($db, static function () use ($db, $auth, $id): array {
            $lock = $db->prepare(
                'SELECT idUsuario, usuario, email, rol, activo
                 FROM sis_usuarios
                 WHERE idUsuario = ?
                 FOR UPDATE'
            );
            $lock->execute([$id]);
            $user = $lock->fetch();
            if (!$user) api_error('El usuario solicitado no existe.', 'USUARIO_NO_ENCONTRADO', 404);

            if ((string)$user['rol'] === 'admin' && (bool)$user['activo']) {
                self::assertAnotherActiveAdmin($db, $id);
            }

            // Eliminar un usuario debe ser una baja definitiva real, incluso si ya
            // inició sesión alguna vez. Conservamos los historiales funcionales,
            // pero desligados del usuario eliminado; las sesiones sí se eliminan
            // porque su FK impide borrar sis_usuarios mientras existan.
            $db->prepare('DELETE FROM sis_sesiones WHERE idUsuario = ?')->execute([$id]);
            $db->prepare('UPDATE sis_login_auditoria SET idUsuario = NULL WHERE idUsuario = ?')->execute([$id]);
            $db->prepare('UPDATE socios_historial_estados SET id_usuario = NULL WHERE id_usuario = ?')->execute([$id]);
            $db->prepare('UPDATE auditoria SET id_usuario = NULL WHERE id_usuario = ?')->execute([$id]);

            $delete = $db->prepare('DELETE FROM sis_usuarios WHERE idUsuario = ?');
            $delete->execute([$id]);
            if ($delete->rowCount() !== 1) {
                api_error('El usuario ya no existe.', 'USUARIO_NO_ENCONTRADO', 404);
            }

            self::audit($auth, 'ELIMINAR_USUARIO', $id, [
                'usuario' => (string)$user['usuario'],
                'email' => $user['email'],
                'rol' => (string)$user['rol'],
                'activo' => (bool)$user['activo'],
            ], null);

            return ['id' => $id];
        });
    }

    private static function optionalId(mixed $value): ?int
    {
        if ($value === null || $value === '') return null;
        return positive_id($value, 'usuario');
    }

    private static function username(mixed $value): string
    {
        $username = clean_text($value, 100, false);
        if ($username === '') api_error('El usuario es obligatorio.', 'VALIDATION_ERROR');
        $length = function_exists('mb_strlen') ? mb_strlen($username, 'UTF-8') : strlen($username);
        if ($length < 3) api_error('El usuario debe tener al menos 3 caracteres.', 'VALIDATION_ERROR');
        if (!preg_match('/^[\p{L}\p{N}._@-]+$/u', $username)) {
            api_error('El usuario solo puede contener letras, números, punto, guion, guion bajo o arroba.', 'VALIDATION_ERROR');
        }
        return $username;
    }

    private static function email(mixed $value): ?string
    {
        $email = optional_text($value, 190, false);
        if ($email !== null && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            api_error('El email ingresado no es válido.', 'VALIDATION_ERROR');
        }
        return $email;
    }

    private static function role(mixed $value): string
    {
        $role = clean_text($value, 20, false);
        if (!in_array($role, self::ROLES, true)) {
            api_error('El rol indicado no es válido.', 'VALIDATION_ERROR');
        }
        return $role;
    }

    private static function validatePassword(string $password, string $confirmation): void
    {
        $length = strlen($password);
        if ($length < 8 || $length > 128) {
            api_error('La contraseña debe tener entre 8 y 128 caracteres.', 'VALIDATION_ERROR');
        }
        if ($password !== $confirmation) {
            api_error('Las contraseñas no coinciden.', 'VALIDATION_ERROR');
        }
    }

    private static function assertUniqueUsername(PDO $db, string $username, ?int $excludeId): void
    {
        $sql = 'SELECT idUsuario FROM sis_usuarios WHERE usuario = ?';
        $params = [$username];
        if ($excludeId !== null) {
            $sql .= ' AND idUsuario <> ?';
            $params[] = $excludeId;
        }
        $sql .= ' LIMIT 1';
        $statement = $db->prepare($sql);
        $statement->execute($params);
        if ($statement->fetchColumn()) {
            api_error('Ya existe un usuario con ese nombre en el sistema.', 'USUARIO_DUPLICADO', 409);
        }
    }

    private static function assertUniqueEmail(PDO $db, ?string $email, ?int $excludeId): void
    {
        if ($email === null) return;
        $sql = 'SELECT idUsuario FROM sis_usuarios WHERE email = ?';
        $params = [$email];
        if ($excludeId !== null) {
            $sql .= ' AND idUsuario <> ?';
            $params[] = $excludeId;
        }
        $sql .= ' LIMIT 1';
        $statement = $db->prepare($sql);
        $statement->execute($params);
        if ($statement->fetchColumn()) {
            api_error('Ya existe un usuario con ese email.', 'EMAIL_DUPLICADO', 409);
        }
    }

    private static function assertAnotherActiveAdmin(PDO $db, int $excludeId): void
    {
        // Bloquea el conjunto de administradores activos dentro de la transacción.
        // Así dos solicitudes concurrentes no pueden verse mutuamente como "el otro"
        // y dejar al sistema sin ningún administrador activo.
        $statement = $db->query(
            "SELECT idUsuario FROM sis_usuarios
             WHERE rol = 'admin' AND activo = 1
             ORDER BY idUsuario
             FOR UPDATE"
        );
        $hasAnother = false;
        foreach ($statement->fetchAll(PDO::FETCH_COLUMN) as $adminId) {
            if ((int)$adminId !== $excludeId) {
                $hasAnother = true;
                break;
            }
        }
        if (!$hasAnother) {
            api_error(
                'El sistema debe conservar al menos un administrador activo.',
                'ULTIMO_ADMIN_ACTIVO',
                409
            );
        }
    }

    private static function publicUser(
        int $id,
        string $username,
        ?string $email,
        string $role,
        bool $active,
        bool $current
    ): array {
        return [
            'id' => $id,
            'usuario' => $username,
            'email' => $email,
            'rol' => $role,
            'activo' => $active,
            'sesion_actual' => $current,
        ];
    }

    private static function audit(array $auth, string $action, int $id, mixed $before, mixed $after): void
    {
        try {
            audit_change(
                $auth['db'],
                $auth,
                'CONFIGURACION',
                $action,
                'sis_usuarios',
                $id,
                'Se actualizó la configuración de usuarios.',
                $before,
                $after
            );
        } catch (Throwable $error) {
            error_log('No se pudo auditar la gestión de usuarios: ' . $error->getMessage());
        }
    }
}
