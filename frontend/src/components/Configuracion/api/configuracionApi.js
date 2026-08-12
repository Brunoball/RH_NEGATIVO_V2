import { apiGet, apiPost } from "../../_shared/api/apiClient";

export const configuracionApi = {
  obtener: () => apiGet("configuracion_obtener"),
  guardarItem: (payload) => apiPost("configuracion_lista_guardar", payload),
  eliminarItem: (lista, id) => apiPost("configuracion_lista_eliminar", { lista, id }),
  darBajaItem: (lista, id) => apiPost("configuracion_lista_baja", { lista, id }),
  reactivarItem: (lista, id) => apiPost("configuracion_lista_reactivar", { lista, id }),
  eliminarDefinitivoItem: (lista, id) =>
    apiPost("configuracion_lista_eliminar_definitivo", { lista, id }),
  listarUsuarios: () => apiGet("usuarios_listar"),
  guardarUsuario: (payload) => apiPost("usuarios_guardar", payload),
  cambiarEstadoUsuario: (id, activo) => apiPost("usuarios_cambiar_estado", { id, activo }),
  eliminarUsuario: (id) => apiPost("usuarios_eliminar", { id }),
};
