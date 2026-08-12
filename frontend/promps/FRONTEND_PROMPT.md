# PROMPT OFICIAL FRONTEND — Mesas de Examen 3Devs

Necesito que desarrolles un módulo frontend React para mi sistema Mesas de Examen 3Devs
respetando EXACTAMENTE esta arquitectura.

---

## Stack

- React (hooks funcionales, sin clases).
- CSS por módulo (sin CSS-in-JS).
- FontAwesome para iconos.
- API central en `components/_shared/api/apiClient.js`.
- Hooks por módulo con soporte de paginación.
- React Query (TanStack Query) para caché y revalidación, si el proyecto ya lo usa.
  Si no, usar el patrón de hook manual descrito más abajo.

---

## Estructura obligatoria

Para un módulo llamado `NombreModulo`, crear:

```txt
components/NombreModulo/
  api/
    nombreModuloApi.js        ← Funciones HTTP del módulo
  hooks/
    useNombreModulo.js        ← Lógica de estado, carga y mutaciones
  modales/
    ModalNombreModulo.jsx     ← Modal de alta/edición
  NombreModulo.jsx            ← Vista principal
  NombreModulo.css            ← Estilos del módulo
```

---

## Archivos base del sistema (ya existen, no recrear)

### `components/_shared/api/apiClient.js`

```js
const API_URL = import.meta.env.VITE_API_URL ?? '/api/v1/api.php';

// Lee el token CSRF desde una cookie o meta tag
function getCsrfToken() {
  return document.querySelector('meta[name="csrf-token"]')?.content ?? '';
}

// Obtiene el token de autenticación guardado
function getAuthToken() {
  return sessionStorage.getItem('auth_token') ?? '';
}

async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // Sesión expirada: redirigir al login
    window.location.href = '/login';
    return;
  }
  if (!res.ok) {
    const msg = data?.mensaje ?? `Error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function apiGet(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`${API_URL}?${qs}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'X-Auth-Token': getAuthToken(),
    },
  });
  return handleResponse(res);
}

export async function apiPost(action, payload = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken(),
      'X-Auth-Token': getAuthToken(),
    },
    body: JSON.stringify({ action, ...payload }),
  });
  return handleResponse(res);
}
```

### `components/_shared/hooks/usePaginacion.js`

```js
import { useState } from 'react';

export function usePaginacion(porPaginaInicial = 20) {
  const [pagina, setPagina]       = useState(1);
  const [porPagina]               = useState(porPaginaInicial);
  const [totalPaginas, setTotalPaginas] = useState(1);

  function actualizarPaginacion(paginacionBackend) {
    setTotalPaginas(paginacionBackend?.paginas ?? 1);
  }

  return { pagina, setPagina, porPagina, totalPaginas, actualizarPaginacion };
}
```

---

## Reglas obligatorias

1. El componente principal (`NombreModulo.jsx`) solo maneja la vista general.
   No contiene lógica de fetch ni mutaciones directas.
2. Las llamadas HTTP van en `api/nombreModuloApi.js`.
3. La lógica de carga, estado y mutaciones va en `hooks/useNombreModulo.js`.
4. Los modales van en `modales/`. Un modal por entidad.
5. Usar `apiGet` y `apiPost` desde `_shared/api/apiClient.js`. Nunca usar `fetch` directo.
6. Mostrar errores claros al usuario (no solo console.error).
7. Mostrar estado de `loading` mientras se cargan datos (skeleton o spinner).
8. Filtros rápidos sobre datos ya cargados usando `useMemo`.
9. Paginación usando `usePaginacion` del shared.
10. Funciones de guardar/eliminar con `async/await` y manejo de error.
11. Mantener diseño consistente con los módulos existentes.

---

## API del módulo (`api/nombreModuloApi.js`)

```js
import { apiGet, apiPost } from '../../_shared/api/apiClient';

export const nombreModuloApi = {
  catalogos: () =>
    apiGet('nombre_modulo_catalogos'),

  listar: (pagina = 1, porPagina = 20, filtros = {}) =>
    apiGet('nombre_modulo_listar', { pagina, por_pagina: porPagina, ...filtros }),

  obtener: (id) =>
    apiGet('nombre_modulo_obtener', { id }),

  guardar: (payload) =>
    apiPost('nombre_modulo_guardar', payload),

  eliminar: (id) =>
    apiPost('nombre_modulo_eliminar', { id }),

  cambiarEstado: (id, activo) =>
    apiPost('nombre_modulo_cambiar_estado', { id, activo }),
};
```

---

## Hook del módulo (`hooks/useNombreModulo.js`)

El hook debe centralizar y exponer:

```js
import { useState, useEffect, useMemo, useCallback } from 'react';
import { nombreModuloApi } from '../api/nombreModuloApi';
import { usePaginacion }   from '../../_shared/hooks/usePaginacion';

export function useNombreModulo() {
  const [datos,      setDatos]      = useState([]);
  const [catalogos,  setCatalogos]  = useState({});
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [busqueda,   setBusqueda]   = useState('');

  const paginacion = usePaginacion(20);

  // ── Carga de datos ──────────────────────────────────────────────
  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await nombreModuloApi.listar(paginacion.pagina, paginacion.porPagina);
      setDatos(res.data ?? []);
      paginacion.actualizarPaginacion(res.paginacion);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [paginacion.pagina]);

  // ── Catálogos (una sola vez) ────────────────────────────────────
  useEffect(() => {
    nombreModuloApi.catalogos()
      .then(res => setCatalogos(res.data ?? {}))
      .catch(() => {}); // catálogos no son críticos
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // ── Filtro local rápido ─────────────────────────────────────────
  const datosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return datos;
    const q = busqueda.toLowerCase();
    return datos.filter(item =>
      Object.values(item).some(v =>
        String(v).toLowerCase().includes(q)
      )
    );
  }, [datos, busqueda]);

  // ── Mutaciones ──────────────────────────────────────────────────
  async function guardar(payload) {
    try {
      await nombreModuloApi.guardar(payload);
      await cargar();
      return { ok: true };
    } catch (e) {
      return { ok: false, mensaje: e.message };
    }
  }

  async function eliminar(id) {
    try {
      await nombreModuloApi.eliminar(id);
      await cargar();
      return { ok: true };
    } catch (e) {
      return { ok: false, mensaje: e.message };
    }
  }

  async function cambiarEstado(id, activo) {
    try {
      await nombreModuloApi.cambiarEstado(id, activo);
      await cargar();
      return { ok: true };
    } catch (e) {
      return { ok: false, mensaje: e.message };
    }
  }

  return {
    datos: datosFiltrados,
    catalogos,
    loading,
    error,
    busqueda,
    setBusqueda,
    paginacion,
    reload: cargar,
    guardar,
    eliminar,
    cambiarEstado,
  };
}
```

---

## Componente principal (`NombreModulo.jsx`)

```jsx
import React, { useState } from 'react';
import { useNombreModulo } from './hooks/useNombreModulo';
import ModalNombreModulo   from './modales/ModalNombreModulo';
import './NombreModulo.css';

export default function NombreModulo() {
  const {
    datos, loading, error, busqueda, setBusqueda,
    paginacion, guardar, eliminar, cambiarEstado,
  } = useNombreModulo();

  const [modalAbierto, setModalAbierto] = useState(false);
  const [itemEditar,   setItemEditar]   = useState(null);
  const [msgError,     setMsgError]     = useState('');

  function abrirModal(item = null) {
    setItemEditar(item);
    setModalAbierto(true);
  }

  async function handleGuardar(payload) {
    const res = await guardar(payload);
    if (!res.ok) { setMsgError(res.mensaje); return; }
    setModalAbierto(false);
    setMsgError('');
  }

  async function handleEliminar(id) {
    if (!confirm('¿Eliminar este registro?')) return;
    const res = await eliminar(id);
    if (!res.ok) setMsgError(res.mensaje);
  }

  return (
    <div className="modulo-container">
      <div className="modulo-header">
        <h2>Nombre Módulo</h2>
        <button className="btn-primary" onClick={() => abrirModal()}>
          <i className="fas fa-plus" /> Nuevo
        </button>
      </div>

      <input
        className="buscador"
        type="text"
        placeholder="Buscar..."
        value={busqueda}
        onChange={e => setBusqueda(e.target.value)}
      />

      {msgError && <div className="alerta-error">{msgError}</div>}
      {error    && <div className="alerta-error">Error al cargar: {error}</div>}
      {loading  && <div className="loading">Cargando...</div>}

      {!loading && (
        <table className="tabla">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nombre</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {datos.map(item => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td>{item.nombre}</td>
                <td>
                  <span className={`badge ${item.activo ? 'activo' : 'inactivo'}`}>
                    {item.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td>
                  <button onClick={() => abrirModal(item)} title="Editar">
                    <i className="fas fa-edit" />
                  </button>
                  <button onClick={() => cambiarEstado(item.id, !item.activo)} title="Cambiar estado">
                    <i className="fas fa-toggle-on" />
                  </button>
                  <button onClick={() => handleEliminar(item.id)} title="Eliminar">
                    <i className="fas fa-trash" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Paginación */}
      <div className="paginacion">
        <button
          disabled={paginacion.pagina <= 1}
          onClick={() => paginacion.setPagina(p => p - 1)}
        >Anterior</button>
        <span>Página {paginacion.pagina} / {paginacion.totalPaginas}</span>
        <button
          disabled={paginacion.pagina >= paginacion.totalPaginas}
          onClick={() => paginacion.setPagina(p => p + 1)}
        >Siguiente</button>
      </div>

      {modalAbierto && (
        <ModalNombreModulo
          item={itemEditar}
          onGuardar={handleGuardar}
          onCerrar={() => setModalAbierto(false)}
        />
      )}
    </div>
  );
}
```

---

## Variables de entorno del frontend

Crear archivo `.env` en la raíz del proyecto React:

```ini
VITE_API_URL=http://localhost/mesas-examen/backend/routes/api.php
```

---

## Seguridad — checklist por módulo

- [ ] Nunca construir URLs con datos del usuario sin encodeURIComponent.
- [ ] Mostrar mensajes de error del servidor al usuario, no datos técnicos.
- [ ] Enviar token CSRF en cada POST (automático via `apiClient.js`).
- [ ] Enviar token de auth en cada request (automático via `apiClient.js`).
- [ ] No guardar datos sensibles en `localStorage` (usar `sessionStorage` o cookies HttpOnly).
- [ ] Manejar el 401 globalmente (automático via `handleResponse` en `apiClient.js`).

---

## Performance — checklist por módulo

- [ ] Usar `useMemo` para filtros sobre datos locales.
- [ ] Usar paginación: nunca pedir "todos" los registros en `listar`.
- [ ] No hacer fetch en cada render: usar `useCallback` con deps correctas.
- [ ] Evitar re-renders innecesarios: no pasar objetos/funciones nuevas como props sin `useCallback`/`useMemo`.
- [ ] Los catálogos se cargan una sola vez al montar el hook.

---

## Entrega esperada

Dame el código completo de todos los archivos del módulo, listo para pegar,
manteniendo el mismo estilo del sistema.
