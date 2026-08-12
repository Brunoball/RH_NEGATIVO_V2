# Estructura oficial del sistema Mesas de Examen — 3Devs

Este sistema debe crecer como una plataforma grande, modular y profesional.
Cada módulo nuevo debe respetar una arquitectura fija, tanto en backend como frontend.

---

## Principios generales

- Modularidad real.
- Un único router API central con middleware de autenticación previo.
- Acciones con prefijo por módulo.
- Conexión DB centralizada mediante función singleton `db()`.
- Respuestas JSON unificadas con HTTP status codes correctos.
- Frontend dividido por módulo.
- Lógica HTTP centralizada en `apiClient.js` con manejo de token.
- Hooks para carga de datos con paginación.
- Modales separados.
- Código simple de mantener.
- Configuración por entorno mediante `.env`.
- Logging de errores en servidor, nunca exponer detalles al cliente.

---

## Árbol general del proyecto

```
proyecto/
  backend/
    .env                        ← Variables de entorno (NO versionar)
    .env.example                ← Plantilla pública
    config/
      db.php                    ← Singleton PDO
      env.php                   ← Cargador de .env
      cors.php                  ← Headers CORS centralizados
    core/
      helpers.php               ← json_response(), http_response(), log_error()
      auth.php                  ← Validación de sesión / JWT
      csrf.php                  ← Generación y validación de token CSRF
    routes/
      api.php                   ← Router central (aplica auth antes de routear)
    modules/
      NOMBRE_MODULO/
        route.php
        NOMBRE_MODULO_controller.php
    logs/
      app.log                   ← Errores del sistema (NO versionar)
  frontend/
    src/
      components/
        _shared/
          api/
            apiClient.js        ← HTTP centralizado con token y status codes
          hooks/
            usePaginacion.js    ← Hook reutilizable de paginación
          utils/
            csrfHelper.js       ← Obtener y renovar token CSRF
        NombreModulo/
          api/
            nombreModuloApi.js
          hooks/
            useNombreModulo.js
          modales/
            ModalNombreModulo.jsx
          NombreModulo.jsx
          NombreModulo.css
```

---

## Módulos esperados

- Login y usuarios.
- Materias.
- Correlatividades.
- Talleres / materias especiales.
- Docentes.
- Cursos y divisiones.
- Alumnos.
- Previas.
- Disponibilidad docente.
- Bloques especiales.
- Armado automático de mesas.
- Reoptimización.
- Impresión / exportación PDF.
- Configuración general.
- Auditoría / historial.

Cada módulo debe seguir **exactamente** la estructura oficial.

---

## Convenciones de versionado de API

Todos los endpoints se sirven bajo `/api/v1/`.
Cuando se introduzcan breaking changes, se crea `/api/v2/` manteniendo v1 activa
durante el período de transición.

---

## Reglas de seguridad globales (no negociables)

1. Nunca exponer `$e->getMessage()` al cliente en producción.
2. Nunca concatenar input del usuario en SQL.
3. Siempre validar y sanitizar toda entrada antes de procesarla.
4. Todo endpoint privado debe pasar por el middleware de autenticación.
5. Requests POST/PUT/DELETE deben validar token CSRF o header `X-Requested-With`.
6. Los headers CORS deben estar configurados explícitamente, nunca con `*` en producción.
7. Las credenciales de DB y claves secretas van solo en `.env`.

---

## Reglas de performance globales (no negociables)

1. Todo endpoint `listar` debe soportar paginación (`pagina`, `por_pagina`).
2. Los catálogos de selects deben cachearse (al menos en memoria de sesión PHP o APCu).
3. Las columnas usadas en WHERE, JOIN y ORDER BY deben tener índice en MySQL.
4. El frontend debe evitar re-fetchs innecesarios usando caché de hooks o React Query.
