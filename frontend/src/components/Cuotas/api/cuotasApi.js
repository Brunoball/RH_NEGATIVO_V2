import { apiGet, apiPost } from "../../_shared/api/apiClient";

export const cuotasApi = {
  listar: (params) => apiGet("cuotas_listar", params),
  totalesEstado: (params) => apiGet("cuotas_totales_estado", params),
  catalogos: (params) => apiGet("cuotas_catalogos", params),
  contextoPago: (params) => apiGet("cuotas_contexto_pago", params),
  contextosPago: (params) => apiGet("cuotas_contextos_pago", params),
  registrarPago: (payload) => apiPost("cuotas_registrar_pago", payload),
  registrarInscripcion: (payload) => apiPost("cuotas_registrar_inscripcion", payload),
  eliminarInscripcion: (idInscripcion) =>
    apiPost("cuotas_eliminar_inscripcion", { id_inscripcion: idInscripcion }),
  registrarPagos: (payload) => apiPost("cuotas_registrar_pagos", payload),
  condonarPago: (payload) => apiPost("cuotas_condonar_pago", payload),
  eliminarPago: (idPago) =>
    apiPost("cuotas_eliminar_pago", { id_pago: idPago }),
};
