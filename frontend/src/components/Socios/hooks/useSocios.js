import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sociosApi } from "../api/sociosApi";

const EMPTY_PAGINATION = {
  pagina: 1,
  por_pagina: 100,
  total: 0,
  total_paginas: 0,
  desde: 0,
  hasta: 0,
  tiene_anterior: false,
  tiene_siguiente: false,
};

function isExactNumericSearch(value) {
  return /^\d+$/.test(String(value || "").trim());
}

function normalizeDate(value) {
  return String(value || "").slice(0, 10);
}

function matchesFilters(item, filters) {
  if (!item) return false;

  const vigente = String(filters.vigente || "").toUpperCase();
  if (vigente === "VIGENTE" && !item.vigente) return false;
  if (vigente === "BAJA" && item.vigente) return false;

  if (filters.categoria && String(item.id_categoria || "") !== String(filters.categoria)) return false;
  if (filters.grupo_sanguineo && String(item.id_grupo_sanguineo || "") !== String(filters.grupo_sanguineo)) return false;
  if (filters.estado && String(item.id_estado || "") !== String(filters.estado)) return false;

  if (filters.letra) {
    const firstLetter = String(item.nombre || "").trim().charAt(0).toLocaleUpperCase("es-AR");
    if (firstLetter !== String(filters.letra).toLocaleUpperCase("es-AR")) return false;
  }

  if (filters.deuda) {
    const debt = Number(item.meses_adeudados || 0);
    if (filters.deuda === "AL_DIA" && debt > 0) return false;
    if (filters.deuda === "DEBE_1_2" && (debt < 1 || debt > 2)) return false;
    if (filters.deuda === "DEBE_3_MAS" && debt < 3) return false;
  }

  if (filters.ultimo_contacto) {
    const contactStatus = String(item.ultimo_contacto_estado || "").toUpperCase();
    const expected = String(filters.ultimo_contacto).toUpperCase();
    if (expected === "SIN_GESTION") {
      if (contactStatus) return false;
    } else if (contactStatus !== expected) {
      return false;
    }
  }

  const joined = normalizeDate(item.fecha_ingreso);
  if (filters.ingreso_desde && (!joined || joined < filters.ingreso_desde)) return false;
  if (filters.ingreso_hasta && (!joined || joined > filters.ingreso_hasta)) return false;

  return true;
}

function mergeExactIdResult(result, exactItem, filters) {
  if (!exactItem || !matchesFilters(exactItem, filters)) return result;

  const items = result.items || [];
  if (items.some((item) => Number(item.id_socio) === Number(exactItem.id_socio))) return result;

  // El resultado exacto por ID se agrega en la primera página para mantener
  // intacta la búsqueda existente (por ejemplo, por DNI) y evitar duplicados.
  if (Number(filters.pagina || 1) !== 1) return result;

  const paginacion = result.paginacion || EMPTY_PAGINATION;
  const total = Number(paginacion.total || 0) + 1;
  const porPagina = Math.max(1, Number(paginacion.por_pagina || EMPTY_PAGINATION.por_pagina));
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const mergedItems = [exactItem, ...items];

  return {
    ...result,
    items: mergedItems,
    paginacion: {
      ...paginacion,
      pagina: 1,
      total,
      total_paginas: Math.max(Number(paginacion.total_paginas || 0), totalPaginas),
      desde: total ? 1 : 0,
      hasta: Math.min(total, mergedItems.length),
      tiene_anterior: false,
      tiene_siguiente: totalPaginas > 1,
    },
  };
}

export function useSocios(filtros = {}) {
  const query = useMemo(() => JSON.stringify(filtros), [filtros]);
  const [response, setResponse] = useState({
    items: [],
    resumen: {},
    catalogos: {},
    avisos_cumpleanios: [],
    paginacion: EMPTY_PAGINATION,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const cargar = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const filters = JSON.parse(query);
      const exactId = isExactNumericSearch(filters.buscar)
        ? Number(String(filters.buscar).trim())
        : null;

      const [listResult, exactResult] = await Promise.all([
        sociosApi.listar(filters),
        exactId
          ? sociosApi.obtener(exactId).catch(() => null)
          : Promise.resolve(null),
      ]);

      const result = mergeExactIdResult(
        listResult,
        exactResult?.item || null,
        filters,
      );

      if (currentRequest !== requestId.current) return null;
      setResponse({
        items: result.items || [],
        resumen: result.resumen || {},
        catalogos: result.catalogos || {},
        avisos_cumpleanios: result.avisos_cumpleanios || [],
        paginacion: result.paginacion || EMPTY_PAGINATION,
      });
      return result;
    } catch (err) {
      if (currentRequest !== requestId.current) return null;
      setError(err.message || "No se pudieron cargar los socios.");
      return null;
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    cargar();
    return () => {
      requestId.current += 1;
    };
  }, [cargar]);

  return { ...response, loading, error, cargar };
}
