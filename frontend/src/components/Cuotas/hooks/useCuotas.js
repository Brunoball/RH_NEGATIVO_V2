import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cuotasApi } from "../api/cuotasApi";

const emptyCatalogs = {
  categorias: [],
  medios_pago: [],
  socios: [],
  empresas: [],
  anios: [],
  meses: [],
};

const initialResponse = {
  items: [],
  resumen: {},
  periodo: {},
  paginacion: null,
};

export function useCuotas(filtros = {}) {
  const listQuery = useMemo(
    () => JSON.stringify({ ...filtros, incluir_catalogos: 0 }),
    [filtros],
  );
  const catalogQuery = useMemo(
    () =>
      JSON.stringify({
        anio: filtros.anio || "",
        mes: filtros.mes || "",
      }),
    [filtros.anio, filtros.mes],
  );
  const requestId = useRef(0);
  const catalogRequestId = useRef(0);
  const [response, setResponse] = useState(initialResponse);
  const [catalogos, setCatalogos] = useState(emptyCatalogs);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const result = await cuotasApi.listar(JSON.parse(listQuery));
      if (currentRequest === requestId.current) {
        setResponse({
          items: result.items || [],
          resumen: result.resumen || {},
          periodo: result.periodo || {},
          paginacion: result.paginacion || null,
        });
      }
      return result;
    } catch (err) {
      if (currentRequest === requestId.current) {
        setError(err.message || "No se pudo cargar el módulo de cuotas.");
      }
      return null;
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [listQuery]);

  const cargarCatalogos = useCallback(async () => {
    const currentRequest = ++catalogRequestId.current;
    try {
      const result = await cuotasApi.catalogos(JSON.parse(catalogQuery));
      if (currentRequest === catalogRequestId.current) {
        setCatalogos(result.catalogos || emptyCatalogs);
      }
      return result;
    } catch (err) {
      if (currentRequest === catalogRequestId.current) {
        setError(err.message || "No se pudieron cargar los catálogos de cuotas.");
      }
      return null;
    }
  }, [catalogQuery]);

  useEffect(() => {
    cargar();
    return () => {
      requestId.current += 1;
    };
  }, [cargar]);

  useEffect(() => {
    cargarCatalogos();
    return () => {
      catalogRequestId.current += 1;
    };
  }, [cargarCatalogos]);

  return { ...response, catalogos, loading, error, cargar, cargarCatalogos };
}
