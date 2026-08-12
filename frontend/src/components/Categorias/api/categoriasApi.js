import { apiGet, apiPost } from "../../_shared/api/apiClient";

export const categoriasApi = {
  listar: (params) => apiGet("categorias_listar", params),
  obtener: (id) => apiGet("categorias_obtener", { id }),
  guardar: (payload) => apiPost("categorias_guardar", payload),
  darBaja: (id) => apiPost("categorias_eliminar", { id }),
  reactivar: (id) => apiPost("categorias_reactivar", { id }),
  historial: (id) => apiGet("categorias_historial", { id }),
  listarDescuentosFamiliares: (params) =>
    apiGet("descuentos_familiares_listar", params),
  guardarDescuentoFamiliar: (payload) =>
    apiPost("descuentos_familiares_guardar", payload),
  eliminarDescuentoFamiliar: (id) =>
    apiPost("descuentos_familiares_eliminar", { id }),
};
