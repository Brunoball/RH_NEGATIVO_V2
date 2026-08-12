import {
  apiDownload,
  apiFormPost,
  apiGet,
  apiPost,
} from "../../_shared/api/apiClient";

export const contableApi = {
  resumen: (params) => apiGet("contable_resumen", params),
  catalogos: () => apiGet("contable_catalogos"),
  opcionesConfiguracion: () => apiGet("contable_opciones_configuracion"),
  ingresosSocios: (params) => apiGet("contable_ingresos_socios", params),
  ingresos: (params) => apiGet("contable_ingresos_listar", params),
  egresos: (params) => apiGet("contable_egresos_listar", params),
  guardarOpcion: (payload) => apiPost("contable_opcion_guardar", payload),
  cambiarEstadoOpcion: (idOpcion, activo) =>
    apiPost("contable_opcion_cambiar_estado", {
      id_opcion: idOpcion,
      activo,
    }),
  eliminarOpcion: (idOpcion) =>
    apiPost("contable_opcion_eliminar", { id_opcion: idOpcion }),
  guardarIngreso: (payload) => apiPost("contable_ingreso_guardar", payload),
  eliminarIngreso: (idIngreso) =>
    apiPost("contable_ingreso_eliminar", { id_ingreso: idIngreso }),
  guardarEgreso: (formData) =>
    apiFormPost("contable_egreso_guardar", formData),
  eliminarEgreso: (idEgreso) =>
    apiPost("contable_egreso_eliminar", { id_egreso: idEgreso }),
  archivoEgreso: (idEgreso) =>
    apiDownload("contable_egreso_archivo", { id: idEgreso }),
};
