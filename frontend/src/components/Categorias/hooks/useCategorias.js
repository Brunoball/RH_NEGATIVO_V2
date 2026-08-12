import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { categoriasApi } from "../api/categoriasApi";

const initialResponse = {
  items: [],
  resumen: {
    total: 0,
    activas: 0,
    inactivas: 0,
    promedio: "0.00",
  },
};

export function useCategorias(filtros = {}, enabled = true) {
  const query = useMemo(() => JSON.stringify(filtros), [filtros]);
  const requestId = useRef(0);
  const [response, setResponse] = useState(initialResponse);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      setError("");
      return null;
    }

    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");

    try {
      const result = await categoriasApi.listar(JSON.parse(query));
      if (currentRequest !== requestId.current) return null;

      setResponse({
        items: result.items || [],
        resumen: {
          ...initialResponse.resumen,
          ...(result.resumen || {}),
        },
      });
      return result;
    } catch (requestError) {
      if (currentRequest !== requestId.current) return null;
      setError(
        requestError.message || "No se pudieron cargar las categorías.",
      );
      return null;
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [enabled, query]);

  useEffect(() => {
    cargar();
    return () => {
      requestId.current += 1;
    };
  }, [cargar]);

  return { ...response, loading, error, cargar };
}
