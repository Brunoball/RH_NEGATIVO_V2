import { useCallback, useEffect, useRef, useState } from "react";
import { configuracionApi } from "../api/configuracionApi";

const initialLists = {
  medios_pago: [],
  condiciones_iva: [],
};

const initialState = {
  listas: initialLists,
  resumen: {
    medios_pago_activos: 0,
    condiciones_iva_activos: 0,
  },
};

export function useConfiguracion() {
  const requestId = useRef(0);
  const [data, setData] = useState(initialState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const response = await configuracionApi.obtener();
      if (currentRequest === requestId.current) {
        setData({
          listas: { ...initialLists, ...(response.listas || {}) },
          resumen: { ...initialState.resumen, ...(response.resumen || {}) },
        });
      }
      return response;
    } catch (requestError) {
      if (currentRequest === requestId.current) {
        setError(requestError.message || "No se pudo cargar la configuración.");
      }
      return null;
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    return () => { requestId.current += 1; };
  }, [cargar]);

  return { ...data, loading, error, cargar };
}
