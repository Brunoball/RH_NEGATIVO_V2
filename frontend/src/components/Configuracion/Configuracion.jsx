import React from "react";
import { Navigate } from "react-router-dom";
import { canWrite } from "../_shared/auth/session";
import ConfiguracionModule from "./secciones/ConfiguracionModule";

export default function Configuracion() {
  if (!canWrite()) return <Navigate to="/panel" replace />;
  return <ConfiguracionModule />;
}
