import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { categoriasApi } from "../api/categoriasApi";

export function useDescuentosFamiliares(filtros = {}, enabled = true) {
  const query = useMemo(() => JSON.stringify(filtros), [filtros]);
  const requestId = useRef(0);
  const [items, setItems] = useState([]);
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
      const result = await categoriasApi.listarDescuentosFamiliares(
        JSON.parse(query),
      );
      if (currentRequest === requestId.current) setItems(result.items || []);
      return result;
    } catch (err) {
      if (currentRequest === requestId.current) {
        setError(err.message || "No se pudieron cargar los descuentos familiares.");
      }
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

  return { items, loading, error, cargar };
}
