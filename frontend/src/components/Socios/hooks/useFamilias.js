import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { familiasApi } from "../api/sociosApi";

export function useFamilias(filtros = {}) {
  const query = useMemo(() => JSON.stringify(filtros), [filtros]);
  const [response, setResponse] = useState({ items: [], resumen: {}, catalogos: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const cargar = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const result = await familiasApi.listar(JSON.parse(query));
      if (currentRequest !== requestId.current) return null;
      setResponse({ items: result.items || [], resumen: result.resumen || {}, catalogos: result.catalogos || {} });
      return result;
    } catch (err) {
      if (currentRequest !== requestId.current) return null;
      setError(err.message || "No se pudieron cargar las familias.");
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
