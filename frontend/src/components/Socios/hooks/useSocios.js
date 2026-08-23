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
      // `buscar` y `id_socio` son filtros distintos a propósito:
      // - buscar: nombre/DNI del socio.
      // - id_socio: coincidencia numérica exacta.
      // No inferimos nunca un ID a partir del texto libre.
      const result = await sociosApi.listar(JSON.parse(query));

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
