import { apiGet } from "../../_shared/api/apiClient";

export const dashboardApi = {
  resumen: (options = {}) => apiGet("dashboard_resumen", {}, options),
};
