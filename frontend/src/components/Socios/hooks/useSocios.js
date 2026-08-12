import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sociosApi } from "../api/sociosApi";

export function useSocios(filtros = {}) {
  const query = useMemo(() => JSON.stringify(filtros), [filtros]);
  const [response, setResponse] = useState({
    items: [],
    resumen: {},
    catalogos: {},
    paginacion: {
      pagina: 1,
      por_pagina: 100,
      total: 0,
      total_paginas: 0,
      desde: 0,
      hasta: 0,
      tiene_anterior: false,
      tiene_siguiente: false,
    },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const cargar = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const result = await sociosApi.listar(JSON.parse(query));
      if (currentRequest !== requestId.current) return null;
      setResponse({
        items: result.items || [],
        resumen: result.resumen || {},
        catalogos: result.catalogos || {},
        paginacion: result.paginacion || {
          pagina: 1,
          por_pagina: 100,
          total: 0,
          total_paginas: 0,
          desde: 0,
          hasta: 0,
          tiene_anterior: false,
          tiene_siguiente: false,
        },
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
    return () => { requestId.current += 1; };
  }, [cargar]);
  return { ...response, loading, error, cargar };
}
