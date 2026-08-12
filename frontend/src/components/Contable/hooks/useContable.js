import { useCallback, useEffect, useRef, useState } from "react";

export function useContableRequest(loader, dependencies = []) {
  const requestId = useRef(0);
  const [state, setState] = useState({
    loading: true,
    error: "",
    data: null,
  });

  const cargar = useCallback(async () => {
    const current = ++requestId.current;
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const data = await loader();
      if (requestId.current === current) {
        setState({ loading: false, error: "", data });
      }
      return data;
    } catch (error) {
      if (requestId.current === current) {
        setState({
          loading: false,
          error: error?.message || "No se pudo cargar el módulo contable.",
          data: null,
        });
      }
      return null;
    }
  }, dependencies); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    cargar();
    return () => {
      requestId.current += 1;
    };
  }, [cargar]);

  return { ...state, cargar };
}
