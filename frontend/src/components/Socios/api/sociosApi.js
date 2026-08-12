import { apiGet, apiPost } from "../../_shared/api/apiClient";

export const sociosApi = {
  listar: (params) => apiGet("socios_listar", params),
  obtener: (id) => apiGet("socios_obtener", { id }),
  historial: (id) => apiGet("socios_historial", { id }),
  guardar: (payload) => apiPost("socios_guardar", payload),
  darBaja: (payload) => apiPost("socios_eliminar", payload),
  eliminarDefinitivo: (payload) =>
    apiPost("socios_eliminar_definitivo", payload),
  reactivar: (payload) =>
    apiPost(
      "socios_reactivar",
      typeof payload === "object" ? payload : { id: payload },
    ),
};

export const familiasApi = {
  listar: (params) => apiGet("familias_listar", params),
  obtener: (id) => apiGet("familias_obtener", { id }),
  guardar: (payload) => apiPost("familias_guardar", payload),
  darBaja: (payload) =>
    apiPost(
      "familias_eliminar",
      typeof payload === "object" ? payload : { id: payload },
    ),
  eliminarDefinitivo: (payload) =>
    apiPost("familias_eliminar_definitivo", payload),
  reactivar: (id) => apiPost("familias_reactivar", { id }),
};
