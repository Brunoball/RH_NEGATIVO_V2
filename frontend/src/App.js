import React, { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Inicio from "./components/Login/Inicio";
import Principal from "./components/Principal/Principal";
import Dashboard from "./components/Dashboard/Dashboard";
import Socios from "./components/Socios/Socios";
import Familias from "./components/Socios/secciones/Familias";
import Cuotas from "./components/Cuotas/Cuotas";
import Categorias from "./components/Categorias/Categorias";
import DescuentosFamiliares from "./components/Categorias/secciones/DescuentosFamiliares";
import Ingresos from "./components/Contable/secciones/Ingresos";
import Egresos from "./components/Contable/secciones/Egresos";
import Resumen from "./components/Contable/secciones/Resumen";
import Configuracion from "./components/Configuracion/Configuracion";
import Usuarios from "./components/Configuracion/secciones/Usuarios";
import CatalogosConfiguracion from "./components/Configuracion/secciones/CatalogosConfiguracion";
import ContableConfiguracion from "./components/Configuracion/secciones/ContableConfiguracion";
import {
  AUTH_SESSION_CHANGED_EVENT,
  isAuthenticated,
} from "./components/_shared/auth/session";

function ProtectedLayout() {
  return isAuthenticated() ? <Principal /> : <Navigate to="/" replace />;
}

export default function App() {
  const [, setAuthRevision] = useState(0);

  useEffect(() => {
    const refreshAuthState = () => setAuthRevision((revision) => revision + 1);
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, refreshAuthState);
    return () =>
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, refreshAuthState);
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            isAuthenticated() ? <Navigate to="/panel" replace /> : <Inicio />
          }
        />

        <Route element={<ProtectedLayout />}>
          <Route path="/panel" element={<Dashboard />} />

          <Route
            path="/socios"
            element={<Navigate to="/socios/personas" replace />}
          />
          <Route path="/socios/personas" element={<Socios tipo="PERSONA" />} />
          <Route path="/socios/familias" element={<Familias />} />

          <Route path="/cuotas" element={<Cuotas />} />
          <Route path="/categorias" element={<Categorias />} />
          <Route
            path="/categorias/descuentos"
            element={<DescuentosFamiliares />}
          />

          <Route
            path="/contable"
            element={<Navigate to="/contable/ingresos" replace />}
          />
          <Route path="/contable/ingresos" element={<Ingresos />} />
          <Route path="/contable/egresos" element={<Egresos />} />
          <Route path="/contable/resumen" element={<Resumen />} />

          <Route path="/configuracion" element={<Configuracion />} />
          <Route path="/configuracion/usuarios" element={<Usuarios />} />
          <Route
            path="/configuracion/catalogos"
            element={<CatalogosConfiguracion />}
          />
          <Route
            path="/configuracion/contable"
            element={<ContableConfiguracion />}
          />
        </Route>

        <Route path="*" element={<Navigate to="/panel" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
