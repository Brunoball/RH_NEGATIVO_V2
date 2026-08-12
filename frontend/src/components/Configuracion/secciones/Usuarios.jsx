import React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { canWrite } from "../../_shared/auth/session";
import UsuariosConfiguracion from "./UsuariosConfiguracion";

export default function Usuarios() {
  const navigate = useNavigate();

  if (!canWrite()) {
    return <Navigate to="/configuracion" replace />;
  }

  return <UsuariosConfiguracion onBack={() => navigate("/configuracion")} />;
}
