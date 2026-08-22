import React, { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBell,
  faCalendarDays,
  faCircleCheck,
  faClock,
  faRotateRight,
  faTags,

  faUsers,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";
import { dashboardApi } from "./api/dashboardApi";
import "./Dashboard.css";

const money = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const EMPTY = {
  periodo: {},
  socios: {},
  familias: {},
  categorias: { distribucion: [] },
  cuotas: {},
  contable: {},
  estado: {},
  actividad: {},
  serie_cuotas: [],
  pagos_recientes: [],
  fuentes: {},
};

function MetricCard({ icon, title, value, detail, tone = "default", keepValueVisible = false }) {
  return (
    <article
      className={`admin-dashboard__metric is-${tone}${keepValueVisible ? " has-visible-value" : ""}`}
    >
      <div className="admin-dashboard__metricIcon">
        <FontAwesomeIcon icon={icon} />
      </div>
      <div className="admin-dashboard__metricBody">
        <span>{title}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </article>
  );
}

function GeneralIndicator({ icon, label, value, detail, tone = "default" }) {
  return (
    <article className={`admin-dashboard__indicator is-${tone}`}>
      <div className="admin-dashboard__indicatorIcon">
        <FontAwesomeIcon icon={icon} />
      </div>
      <div className="admin-dashboard__indicatorBody">
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </article>
  );
}

function FeaturedGeneralIndicator({ icon, label, value, detail, tone = "default" }) {
  return (
    <article className={`admin-dashboard__indicator admin-dashboard__indicator--featured is-${tone}`}>
      <div className="admin-dashboard__indicatorIcon admin-dashboard__indicatorIcon--featured">
        <FontAwesomeIcon icon={icon} />
      </div>
      <div className="admin-dashboard__indicatorBody admin-dashboard__indicatorBody--featured">
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </article>
  );
}

function PaymentChart({ items }) {
  const maximum = useMemo(
    () => Math.max(1, ...items.map((item) => Number(item.pagadas || 0))),
    [items],
  );

  return (
    <div
      className="admin-dashboard__chart"
      role="img"
      aria-label="Cuotas registradas durante los últimos seis períodos"
    >
      <div className="admin-dashboard__chartGrid" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="admin-dashboard__chartColumns">
        {items.map((item) => {
          const paid = Number(item.pagadas || 0);
          const height = paid > 0 ? Math.max(5, (paid / maximum) * 100) : 0;
          return (
            <div className="admin-dashboard__chartMonth" key={item.periodo}>
              <strong className="admin-dashboard__chartValue">{paid}</strong>
              <div className="admin-dashboard__bars">
                <i
                  className="is-paid"
                  style={{ height: `${height}%` }}
                  title={`${paid} cuota${paid === 1 ? "" : "s"} registrada${paid === 1 ? "" : "s"}`}
                />
              </div>
              <strong>{item.etiqueta}</strong>
              <small>{String(item.anio || "").slice(-2)}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [summary, setSummary] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    dashboardApi
      .resumen({ signal: controller.signal })
      .then((response) => setSummary(response.resumen || EMPTY))
      .catch((requestError) => {
        if (requestError?.name !== "AbortError") {
          setError(
            requestError?.message ||
              "No se pudo cargar el panel de administración.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  const {
    socios,
    familias,
    cuotas,
    contable,
    estado,
    periodo,
  } = summary;
  const balance = Number(contable.saldo_mes || 0);
  const currentCompliance = Number(cuotas.cumplimiento_mes || 0);

  const statusItems = [
    {
      icon: faTags,
      label: "Socios con categoría",
      value: estado.socios_con_categoria,
      detail: `${Number(socios.con_categoria || 0)} de ${Number(socios.activos || 0)} socios activos`,
    },
    {
      icon: faUsers,
      label: "Personas con familia",
      value: estado.socios_con_familia,
      detail: `${Number(socios.con_familia || 0)} de ${Number(socios.personas_activas || 0)} personas activas`,
    },
  ];

  // Algunas instalaciones de RH Negativo no tienen aún el campo de
  // recordatorios. No mostramos un 0% engañoso cuando esa fuente no existe.
  if (summary.fuentes?.recordatorios_disponibles !== false) {
    statusItems.push({
      icon: faBell,
      label: "Recordatorios habilitados",
      value: estado.socios_con_recordatorio,
      detail: `${Number(socios.con_recordatorio || 0)} socios reciben aviso de pago`,
    });
  }

  const qualityAverage = statusItems.length
    ? Math.round(
        statusItems.reduce((total, item) => total + Number(item.value || 0), 0) /
          statusItems.length,
      )
    : 0;

  const qualityDetail = statusItems
    .map((item) => `${item.label}: ${Math.max(0, Math.min(100, Number(item.value || 0)))}%`)
    .join(" · ");

  return (
    <section className="admin-dashboard">
      <header className="admin-dashboard__header">
        <div>
          <h1>Panel de gestión</h1>
          <p>Resumen actualizado con información registrada en la base.</p>
        </div>
        <div className="admin-dashboard__period">
          <FontAwesomeIcon icon={faCalendarDays} />
          <span>{periodo.mes_nombre || "MES ACTUAL"}</span>
          <strong>{periodo.anio || new Date().getFullYear()}</strong>
        </div>
      </header>

      {error ? (
        <div className="admin-dashboard__error" role="alert">
          <div>
            <strong>No se pudo cargar el dashboard</strong>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
          >
            <FontAwesomeIcon icon={faRotateRight} /> Reintentar
          </button>
        </div>
      ) : null}

      <div className={`admin-dashboard__body ${loading ? "is-loading" : ""}`}>
        <section className="admin-dashboard__metrics">
          <MetricCard
            icon={faUsers}
            title="Socios activos"
            value={Number(socios.activos || 0)}
            detail={`${Number(socios.inactivos || 0)} de baja`}
          />
          <MetricCard
            icon={faCircleCheck}
            title="Cuotas cubiertas"
            value={Number(cuotas.pagadas_mes || 0)}
            detail={`${Number(cuotas.condonadas_mes || 0)} condonadas · Período ${periodo.mes_nombre || "actual"}`}
            tone="success"
          />
          <MetricCard
            icon={faClock}
            title="Cuotas pendientes"
            value={Number(cuotas.pendientes_mes || 0)}
            detail={`${currentCompliance}% de cumplimiento`}
            tone={Number(cuotas.pendientes_mes || 0) > 0 ? "warning" : "success"}
          />
          <MetricCard
            icon={faWallet}
            title="Saldo del mes"
            value={money(contable.saldo_mes)}
            detail={`${Number(cuotas.cobros_registrados_mes || 0)} cobros registrados`}
            tone={balance < 0 ? "danger" : "balance"}
            keepValueVisible
          />
        </section>



        <div className="admin-dashboard__mainGrid">
          <article className="admin-dashboard__panel admin-dashboard__panel--chart">
            <header className="admin-dashboard__panelHead">
              <div>
                <h2>Cuotas registradas</h2>
                <p>Cantidad de períodos pagados durante los últimos seis meses.</p>
              </div>
              <span className="admin-dashboard__statusChip is-complete">
                <FontAwesomeIcon icon={faCircleCheck} />
                {Number(cuotas.pagadas_mes || 0)} pagadas del período
              </span>
            </header>
            <PaymentChart items={summary.serie_cuotas || []} />
          </article>

          <aside className="admin-dashboard__panel admin-dashboard__panel--indicators">
            <header className="admin-dashboard__panelHead">
              <div>
                <h2>Indicadores generales</h2>
                <p>Totales principales del padrón y calidad de los datos.</p>
              </div>
            </header>

            <div className="admin-dashboard__indicatorGrid">
              <FeaturedGeneralIndicator
                icon={faCircleCheck}
                label="Calidad general de datos"
                value={`${qualityAverage}%`}
                detail={qualityDetail}
                tone="quality"
              />

              <GeneralIndicator
                icon={faUsers}
                label="Personas activas"
                value={Number(socios.personas_activas || 0)}
                detail="Registradas actualmente"
                tone="people"
              />
              <GeneralIndicator
                icon={faUsers}
                label="Socios de baja"
                value={Number(socios.inactivos || 0)}
                detail="Fuera del padrón activo"
                tone="muted"
              />
              <GeneralIndicator
                icon={faTags}
                label="Con categoría"
                value={Number(socios.con_categoria || 0)}
                detail="Socios categorizados"
                tone="category"
              />
              <GeneralIndicator
                icon={faCircleCheck}
                label="Cobros del mes"
                value={Number(cuotas.cobros_registrados_mes || 0)}
                detail={`Período ${periodo.mes_nombre || "actual"}`}
                tone="success"
              />
            </div>
          </aside>
        </div>

        <footer className="admin-dashboard__footer">
          Desarrollado por{" "}
          <a href="https://3devsnet.com" target="_blank" rel="noopener noreferrer">
            3devs.solutions
          </a>
        </footer>
      </div>
    </section>
  );
}
