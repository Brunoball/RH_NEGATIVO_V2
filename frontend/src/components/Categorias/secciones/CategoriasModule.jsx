import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDays,
  faCheckCircle,
  faClockRotateLeft,
  faPen,
  faRotateLeft,
  faTags,
  faToggleOff,
  faTrashCan,
  faUsers,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";
import { ModulePage } from "../../Global/ModulePage";
import GlobalDivTable from "../../Global/GlobalDivTable";
import CrudModal from "../../Global/Modales/CrudModal";
import InfoModal, {
  InfoEmpty,
  InfoRow,
  InfoSection,
  InfoSummary,
} from "../../Global/Modales/InfoModal";
import ModalEliminarGlobal from "../../Global/Modales/ModalEliminarGlobal";
import ModuleFeedback from "../../Global/ModuleFeedback";
import {
  EntityFormPanel,
  EntityTabs,
  FloatingField,
} from "../../Global/Formularios/TabbedForm";
import { canWrite } from "../../_shared/auth/session";
import { onlyDigits, upperWithoutDigits } from "../../Global/Formularios/inputSanitizers";
import { categoriasApi } from "../api/categoriasApi";
import { useCategorias } from "../hooks/useCategorias";
import { useDescuentosFamiliares } from "../hooks/useDescuentosFamiliares";
import "../Categorias.css";
import "../modales/CategoriasModal.css";

const dateToday = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
};

const openDatePicker = (event) => {
  const input = event.currentTarget;
  if (typeof input.showPicker !== "function") return;
  try {
    input.showPicker();
  } catch {
    // El navegador mantiene el comportamiento nativo.
  }
};

const upper = (value) => String(value ?? "").toLocaleUpperCase("es-AR");
const decimalInput = (value, maxIntegerDigits = 10, maxDecimals = 2) => {
  const normalized = String(value ?? "")
    .replace(",", ".")
    .replace(/[^0-9.]/g, "");
  const [rawInteger = "", ...decimalParts] = normalized.split(".");
  const integer = rawInteger.slice(0, maxIntegerDigits);

  if (decimalParts.length === 0) return integer;

  const decimals = decimalParts.join("").slice(0, maxDecimals);
  return `${integer || "0"}.${decimals}`;
};
const CATEGORY_TAB_GENERAL = "general";
const CATEGORY_TAB_PRICE = "price";
const money = (value) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(
    Number(value || 0),
  );
const percentage = (value) =>
  `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(Number(value || 0))}%`;
const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" }).format(
        new Date(`${value}T00:00:00Z`),
      )
    : "SIN LÍMITE";
const formatDateTime = (value) =>
  value
    ? new Intl.DateTimeFormat("es-AR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(String(value).replace(" ", "T")))
    : "—";

const emptyCategoryForm = () => ({
  nombre: "",
  descripcion: "",
  monto_actual: "",
  vigente_desde: dateToday(),
});

const emptyDiscountForm = () => ({
  id_descuento_familiar: "",
  cantidad_integrantes_desde: "2",
  cantidad_integrantes_hasta: "",
  porcentaje_descuento: "",
  vigencia_desde: dateToday(),
  vigencia_hasta: "",
  descripcion: "",
});

function CategoryForm({ form, setForm, activeTab, onTabChange }) {
  const update = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="entity-form categorias-modal__form">
      <EntityTabs
        tabs={[
          { value: CATEGORY_TAB_GENERAL, label: "Datos generales", icon: faTags },
          { value: CATEGORY_TAB_PRICE, label: "Precio y vigencia", icon: faWallet },
        ]}
        value={activeTab}
        onChange={onTabChange}
        idPrefix="categoria-form-tab"
        ariaLabel="Secciones de la categoría"
      />

      {activeTab === CATEGORY_TAB_GENERAL ? (
        <EntityFormPanel
          tabValue={CATEGORY_TAB_GENERAL}
          idPrefix="categoria-form-tab"
          eyebrow="Identificación"
          title="Datos generales de la categoría"
          icon={faTags}
          tag="Paso 1 de 2"
          bodyClassName="entity-form__grid entity-form__grid--single"
          hint="Definí un nombre claro y una descripción breve para identificar la categoría."
        >
          <FloatingField label="Nombre *" active={Boolean(form.nombre)}>
            <input
              value={form.nombre}
              placeholder=" "
              onChange={(event) => update("nombre", upperWithoutDigits(event.target.value))}
              required
              maxLength={120}
              autoFocus
            />
          </FloatingField>
          <FloatingField label="Descripción" active={Boolean(form.descripcion)} textarea>
            <textarea
              value={form.descripcion}
              placeholder=" "
              onChange={(event) => update("descripcion", upper(event.target.value))}
              rows={3}
              maxLength={500}
            />
          </FloatingField>
        </EntityFormPanel>
      ) : (
        <EntityFormPanel
          tabValue={CATEGORY_TAB_PRICE}
          idPrefix="categoria-form-tab"
          eyebrow="Configuración económica"
          title="Precio mensual y fecha del cambio"
          icon={faWallet}
          tag={form.id_categoria ? "Actualización" : "Precio inicial"}
          bodyClassName="entity-form__grid categorias-price-panel__body"
          hint="Cada modificación del monto queda registrada en el historial de precios de la categoría."
        >
          <FloatingField label="Monto mensual *" active={form.monto_actual !== ""}>
            <input
              type="text"
              inputMode="decimal"
              placeholder=" "
              value={form.monto_actual}
              onChange={(event) =>
                update("monto_actual", decimalInput(event.target.value, 10, 2))
              }
              required
            />
          </FloatingField>
          <FloatingField label="Vigente desde *" active>
            <input
              type="date"
              value={form.vigente_desde}
              max={dateToday()}
              onClick={openDatePicker}
              onChange={(event) => update("vigente_desde", event.target.value)}
              required
            />
          </FloatingField>
        </EntityFormPanel>
      )}
    </div>
  );
}

function DiscountForm({ form, setForm }) {
  const update = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="entity-form categorias-discount-form">
      <EntityFormPanel
        tabValue="discount-rule"
        eyebrow="Regla global por familia"
        title="Cantidad de integrantes y porcentaje"
        icon={faUsers}
        tag="Descuento familiar"
        standalone
        bodyClassName="entity-form__grid categorias-discount-panel__body"
        hint="La categoría define la cuota individual. Esta regla se aplica después sobre la suma total de las cuotas de todos los integrantes activos de la familia."
      >
        <FloatingField label="Cantidad mínima de integrantes *" active>
          <input
            type="text"
            inputMode="numeric"
            value={form.cantidad_integrantes_desde}
            onChange={(event) =>
              update("cantidad_integrantes_desde", onlyDigits(event.target.value, 2))
            }
            required
            autoFocus
          />
        </FloatingField>
        <FloatingField
          label="Cantidad máxima de integrantes"
          active={form.cantidad_integrantes_hasta !== ""}
        >
          <input
            type="text"
            inputMode="numeric"
            placeholder=" "
            value={form.cantidad_integrantes_hasta}
            onChange={(event) =>
              update("cantidad_integrantes_hasta", onlyDigits(event.target.value, 2))
            }
          />
        </FloatingField>
        <FloatingField
          label="Porcentaje de descuento *"
          active={form.porcentaje_descuento !== ""}
        >
          <input
            type="text"
            inputMode="decimal"
            placeholder=" "
            value={form.porcentaje_descuento}
            onChange={(event) =>
              update("porcentaje_descuento", decimalInput(event.target.value, 3, 2))
            }
            required
          />
        </FloatingField>
        <FloatingField label="Vigencia desde *" active>
          <input
            type="date"
            value={form.vigencia_desde}
            onClick={openDatePicker}
            onChange={(event) => update("vigencia_desde", event.target.value)}
            required
          />
        </FloatingField>
        <FloatingField label="Vigencia hasta" active>
          <input
            type="date"
            value={form.vigencia_hasta}
            min={form.vigencia_desde || undefined}
            onClick={openDatePicker}
            onChange={(event) => update("vigencia_hasta", event.target.value)}
          />
        </FloatingField>
        <FloatingField label="Descripción" active={Boolean(form.descripcion)} wide>
          <input
            value={form.descripcion}
            placeholder=" "
            maxLength={255}
            onChange={(event) =>
              update("descripcion", upper(event.target.value))
            }
          />
        </FloatingField>
      </EntityFormPanel>
    </div>
  );
}

export default function CategoriasModule({ section = "categorias" }) {
  const writable = canWrite();
  const tableBodyRef = useRef(null);
  const pendingTableScrollRef = useRef(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("activo");
  const [discountStatus, setDiscountStatus] = useState("vigente");

  const categoryFilters = useMemo(
    () =>
      section === "categorias"
        ? { buscar: search, estado: status }
        : { estado: "activo" },
    [search, section, status],
  );
  const discountFilters = useMemo(
    () => ({ estado: discountStatus }),
    [discountStatus],
  );

  const { items, loading, error, cargar } = useCategorias(
    categoryFilters,
    section === "categorias",
  );
  const {
    items: discounts,
    loading: discountsLoading,
    error: discountsError,
    cargar: cargarDescuentos,
  } = useDescuentosFamiliares(discountFilters, section === "descuentos");

  const refreshCategoriesKeepingScroll = useCallback(async () => {
    pendingTableScrollRef.current = tableBodyRef.current?.scrollTop || 0;
    return cargar();
  }, [cargar]);

  const refreshDiscountsKeepingScroll = useCallback(async () => {
    pendingTableScrollRef.current = tableBodyRef.current?.scrollTop || 0;
    return cargarDescuentos();
  }, [cargarDescuentos]);

  const activeLoading = section === "categorias" ? loading : discountsLoading;
  const activeItemsLength = section === "categorias" ? items.length : discounts.length;

  useEffect(() => {
    if (activeLoading || pendingTableScrollRef.current == null) return undefined;

    const scrollTop = pendingTableScrollRef.current;
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        const body = tableBodyRef.current;
        if (body) {
          const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
          body.scrollTop = Math.min(scrollTop, maxScrollTop);
        }
        pendingTableScrollRef.current = null;
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeLoading, activeItemsLength]);

  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm());
  const [categoryFormTab, setCategoryFormTab] = useState(CATEGORY_TAB_GENERAL);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [discountForm, setDiscountForm] = useState(emptyDiscountForm());
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [stateModal, setStateModal] = useState(null);
  const [deleteDiscountModal, setDeleteDiscountModal] = useState(null);
  const [historyModal, setHistoryModal] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const openNewCategory = () => {
    setFeedback(null);
    setCategoryForm(emptyCategoryForm());
    setCategoryFormTab(CATEGORY_TAB_GENERAL);
    setCategoryModalOpen(true);
  };

  const openEditCategory = (item) => {
    setFeedback(null);
    setCategoryForm({
      id_categoria: item.id_categoria,
      nombre: item.nombre,
      descripcion: item.descripcion || "",
      monto_actual: item.monto_actual,
      vigente_desde: dateToday(),
    });
    setCategoryFormTab(CATEGORY_TAB_GENERAL);
    setCategoryModalOpen(true);
  };

  const openNewDiscount = () => {
    setFeedback(null);
    setDiscountForm(emptyDiscountForm());
    setDiscountModalOpen(true);
  };

  const openEditDiscount = (item) => {
    setFeedback(null);
    setDiscountForm({
      id_descuento_familiar: item.id_descuento_familiar,
      cantidad_integrantes_desde: String(item.cantidad_integrantes_desde),
      cantidad_integrantes_hasta:
        item.cantidad_integrantes_hasta === null
          ? ""
          : String(item.cantidad_integrantes_hasta),
      porcentaje_descuento: String(item.porcentaje_descuento),
      vigencia_desde:
        item.vigencia_desde < dateToday() ? dateToday() : item.vigencia_desde,
      vigencia_hasta: item.vigencia_hasta || "",
      descripcion: item.descripcion || "",
    });
    setDiscountModalOpen(true);
  };

  const saveCategory = async (event) => {
    event.preventDefault();
    const sanitizedCategory = {
      ...categoryForm,
      nombre: upperWithoutDigits(categoryForm.nombre).trim(),
      monto_actual: decimalInput(categoryForm.monto_actual, 10, 2),
    };

    if (!sanitizedCategory.nombre) {
      setCategoryFormTab(CATEGORY_TAB_GENERAL);
      setFeedback({ type: "error", message: "Completá el nombre de la categoría." });
      return;
    }
    if (sanitizedCategory.monto_actual === "" || Number(sanitizedCategory.monto_actual) < 0) {
      setCategoryFormTab(CATEGORY_TAB_PRICE);
      setFeedback({ type: "error", message: "Ingresá un monto mensual válido." });
      return;
    }
    if (!sanitizedCategory.vigente_desde) {
      setCategoryFormTab(CATEGORY_TAB_PRICE);
      setFeedback({
        type: "error",
        message: "Seleccioná desde cuándo estará vigente el precio.",
      });
      return;
    }

    setSaving(true);
    try {
      const response = await categoriasApi.guardar(sanitizedCategory);
      setCategoryModalOpen(false);
      setCategoryForm(emptyCategoryForm());
      setFeedback({
        type: "success",
        message: response.mensaje || "Categoría guardada correctamente.",
      });
      await refreshCategoriesKeepingScroll();
    } catch (err) {
      setFeedback({ type: "error", message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const saveDiscount = async (event) => {
    event.preventDefault();
    const fromText = onlyDigits(discountForm.cantidad_integrantes_desde, 2);
    const toText = onlyDigits(discountForm.cantidad_integrantes_hasta, 2);
    const discountText = decimalInput(discountForm.porcentaje_descuento, 3, 2);
    const from = Number(fromText);
    const to = toText === "" ? null : Number(toText);
    const discount = Number(discountText);

    if (!Number.isInteger(from) || from < 2 || from > 50) {
      setFeedback({
        type: "error",
        message: "Ingresá una cantidad mínima entre 2 y 50.",
      });
      return;
    }
    if (to !== null && (!Number.isInteger(to) || to < from || to > 50)) {
      setFeedback({
        type: "error",
        message: "La cantidad máxima debe ser igual o mayor que la mínima y de hasta 50.",
      });
      return;
    }
    if (!Number.isFinite(discount) || discount <= 0 || discount > 100) {
      setFeedback({
        type: "error",
        message: "Ingresá un porcentaje mayor a 0 y de hasta 100.",
      });
      return;
    }
    if (!discountForm.vigencia_desde) {
      setFeedback({ type: "error", message: "Seleccioná el inicio de vigencia." });
      return;
    }
    if (
      discountForm.vigencia_hasta &&
      discountForm.vigencia_hasta < discountForm.vigencia_desde
    ) {
      setFeedback({
        type: "error",
        message: "El fin de vigencia no puede ser anterior al inicio.",
      });
      return;
    }

    const payload = {
      ...(discountForm.id_descuento_familiar
        ? { id_descuento_familiar: Number(discountForm.id_descuento_familiar) }
        : {}),
      cantidad_integrantes_desde: from,
      cantidad_integrantes_hasta: to,
      porcentaje_descuento: discount.toFixed(2),
      vigencia_desde: discountForm.vigencia_desde,
      vigencia_hasta: discountForm.vigencia_hasta || null,
      descripcion: discountForm.descripcion.trim() || null,
    };

    setSaving(true);
    try {
      const response = await categoriasApi.guardarDescuentoFamiliar(payload);
      setDiscountModalOpen(false);
      setDiscountForm(emptyDiscountForm());
      setFeedback({
        type: "success",
        message: response.mensaje || "Descuento familiar guardado correctamente.",
      });
      setDiscountStatus("vigente");
      await refreshDiscountsKeepingScroll();
    } catch (err) {
      setFeedback({ type: "error", message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const changeCategoryState = async () => {
    if (!stateModal) return;
    const response = stateModal.activo
      ? await categoriasApi.darBaja(stateModal.id_categoria)
      : await categoriasApi.reactivar(stateModal.id_categoria);
    await refreshCategoriesKeepingScroll();
    return response;
  };

  const deleteDiscount = async () => {
    if (!deleteDiscountModal) return;
    const response = await categoriasApi.eliminarDescuentoFamiliar(
      deleteDiscountModal.id_descuento_familiar,
    );
    await refreshDiscountsKeepingScroll();
    return response;
  };

  const openHistory = async (item) => {
    setHistoryModal(item);
    setHistory([]);
    setHistoryLoading(true);
    try {
      const response = await categoriasApi.historial(item.id_categoria);
      setHistory(response.items || []);
    } catch (err) {
      setFeedback({ type: "error", message: err.message });
      setHistoryModal(null);
    } finally {
      setHistoryLoading(false);
    }
  };

  const activeError = section === "categorias" ? error : discountsError;
  const historyIsActive =
    historyModal?.activo === true || Number(historyModal?.activo) === 1;
  const discountHistoryView = discountStatus === "historial";
  const primaryAction = section === "categorias" ? openNewCategory : openNewDiscount;
  const primaryLabel = section === "categorias" ? "Nueva categoría" : "Nuevo descuento";
  const pageFilters = section === "categorias"
    ? [
        {
          key: "estado",
          label: "Estado",
          type: "tabs",
          ariaLabel: "Estado de las categorías",
          value: status,
          onChange: (value) => {
            setStatus(value);
            setFeedback(null);
          },
          options: [
            { value: "activo", label: "Activas" },
            { value: "inactivo", label: "Dadas de baja" },
          ],
        },
        {
          key: "buscar",
          label: "Búsqueda",
          type: "search",
          placeholder: " ",
          value: search,
          onChange: setSearch,
        },
      ]
    : [
        {
          key: "estado-descuento",
          label: "Estado",
          type: "tabs",
          ariaLabel: "Estado de los descuentos familiares",
          value: discountStatus,
          onChange: (value) => {
            setDiscountStatus(value);
            setFeedback(null);
          },
          options: [
            { value: "vigente", label: "Activas" },
            { value: "historial", label: "Historial" },
          ],
        },
      ];

  return (
    <>
      <ModulePage
        title={section === "categorias" ? "Categorías" : "Descuentos familiares"}
        description={
          section === "descuentos"
            ? "Configurá porcentajes globales por cantidad de integrantes. Se aplicarán sobre la suma total de las cuotas individuales de la familia."
            : undefined
        }
        filters={pageFilters}
        tabsInTitle
        primaryActionLabel={primaryLabel}
        onPrimaryAction={primaryAction}
        canCreate={writable}
        notice={
          !writable
            ? "Tu usuario tiene permiso de consulta. Las modificaciones están deshabilitadas."
            : null
        }
      >
        <ModuleFeedback
          type={feedback?.type || "error"}
          message={feedback?.message || activeError}
          duration={feedback?.duration}
          onClose={() => setFeedback(null)}
        />

        {section === "categorias" ? (
          <GlobalDivTable
            bodyRef={tableBodyRef}
            className="categorias-table"
            bodyClassName="entity-table-wrap"
            gridClassName="categorias-grid"
            ariaLabel="Listado de categorías"
            loading={loading}
            loadingLabel="Cargando categorías..."
            skeletonRows={7}
            columns={[
              "Categoría",
              "Descripción",
              { label: "Monto mensual", align: "right" },
              "Socios",
              "Actualización",
              "Acciones",
            ]}
          >
            {!loading && !error && !items.length ? (
              <div className="module-empty">
                <FontAwesomeIcon icon={faTags} />
                <strong>Sin categorías para mostrar</strong>
                <span>Creá la primera categoría o cambiá los filtros.</span>
              </div>
            ) : null}
            {items.map((item) => (
              <div
                className="mov-gridTable mov-gridTable--row global-divTable__row entity-table-row categorias-grid"
                role="row"
                key={item.id_categoria}
              >
                <div className="mov-gridCell is-strong">
                  <span className="mov-categoryChip">{item.nombre}</span>
                </div>
                <div className="mov-gridCell">
                  <span className="entity-wrap-text">{item.descripcion || "—"}</span>
                </div>
                <div className="mov-gridCell is-right is-strong categorias-money-cell">
                  {money(item.monto_actual)}
                </div>
                <div className="mov-gridCell is-center">
                  <span className="mov-chip">{item.cantidad_socios}</span>
                </div>
                <div className="mov-gridCell">{formatDate(item.updated_at?.slice(0, 10))}</div>
                <div className="mov-gridCell mov-gridCell--actions">
                  <div className="mov-actionsInline">
                    <button
                      className="mov-iconBtn"
                      type="button"
                      title="Ver historial de precios"
                      onClick={() => openHistory(item)}
                    >
                      <FontAwesomeIcon icon={faClockRotateLeft} />
                    </button>
                    {writable ? (
                      <>
                        <button
                          className="mov-iconBtn"
                          type="button"
                          title="Editar"
                          onClick={() => openEditCategory(item)}
                        >
                          <FontAwesomeIcon icon={faPen} />
                        </button>
                        <button
                          className={`mov-iconBtn ${item.activo ? "mov-iconBtn--danger" : ""}`}
                          type="button"
                          title={item.activo ? "Dar de baja" : "Reactivar"}
                          onClick={() => setStateModal(item)}
                        >
                          <FontAwesomeIcon icon={item.activo ? faToggleOff : faRotateLeft} />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </GlobalDivTable>
        ) : (
          <GlobalDivTable
            bodyRef={tableBodyRef}
            className="categorias-discountsTable"
            bodyClassName="entity-table-wrap"
            gridClassName={`categorias-discountsGrid ${discountHistoryView ? "categorias-discountsGrid--history" : ""}`.trim()}
            ariaLabel="Descuentos familiares"
            loading={discountsLoading}
            loadingLabel="Cargando descuentos familiares..."
            skeletonRows={7}
            skeletonActionColumn={!discountHistoryView}
            columns={[
              "Aplicación",
              "Integrantes",
              "Descuento",
              "Vigencia",
              "Descripción",
              "Estado",
              ...(!discountHistoryView ? ["Acciones"] : []),
            ]}
          >
            {!discountsLoading && !discountsError && !discounts.length ? (
              <div className="module-empty">
                <FontAwesomeIcon icon={faUsers} />
                <strong>Sin descuentos para mostrar</strong>
                <span>
                  {discountStatus === "vigente"
                    ? "No hay reglas activas configuradas."
                    : "Todavía no hay reglas históricas."}
                </span>
              </div>
            ) : null}
            {discounts.map((item) => {
              const range = item.cantidad_integrantes_hasta === null
                ? `DESDE ${item.cantidad_integrantes_desde} INTEGRANTES`
                : item.cantidad_integrantes_desde === item.cantidad_integrantes_hasta
                  ? `${item.cantidad_integrantes_desde} INTEGRANTES`
                  : `DE ${item.cantidad_integrantes_desde} A ${item.cantidad_integrantes_hasta} INTEGRANTES`;
              return (
                <div
                  className={`mov-gridTable mov-gridTable--row global-divTable__row entity-table-row categorias-discountsGrid ${discountHistoryView ? "categorias-discountsGrid--history" : ""}`.trim()}
                  role="row"
                  key={item.id_descuento_familiar}
                >
                  <div className="mov-gridCell is-strong">TOTAL FAMILIAR</div>
                  <div className="mov-gridCell">{range}</div>
                  <div className="mov-gridCell">
                    <span className="mov-chip mov-chip--ok">
                      {percentage(item.porcentaje_descuento)}
                    </span>
                  </div>
                  <div className="mov-gridCell categorias-discount-vigencia">
                    <span>{formatDate(item.vigencia_desde)}</span>
                    <span>→ {formatDate(item.vigencia_hasta)}</span>
                  </div>
                  <div className="mov-gridCell">
                    <span className="entity-wrap-text">{item.descripcion || "—"}</span>
                  </div>
                  <div className="mov-gridCell">
                    <span className={`mov-chip ${item.activo ? "mov-chip--ok" : "mov-chip--danger"}`}>
                      {item.estado_vigencia === "HISTORICO"
                        ? "HISTÓRICO"
                        : item.estado_vigencia}
                    </span>
                  </div>
                  {!discountHistoryView ? (
                    <div className="mov-gridCell mov-gridCell--actions">
                      {writable && item.activo ? (
                        <div className="mov-actionsInline">
                          <button
                            className="mov-iconBtn"
                            type="button"
                            title="Editar descuento"
                            onClick={() => openEditDiscount(item)}
                          >
                            <FontAwesomeIcon icon={faPen} />
                          </button>
                          <button
                            className="mov-iconBtn mov-iconBtn--danger"
                            type="button"
                            title="Eliminar descuento"
                            onClick={() => setDeleteDiscountModal(item)}
                          >
                            <FontAwesomeIcon icon={faTrashCan} />
                          </button>
                        </div>
                      ) : (
                        <span className="entity-readonly">CONSULTA</span>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </GlobalDivTable>
        )}
      </ModulePage>

      <CrudModal
        open={categoryModalOpen}
        title={categoryForm.id_categoria ? "Editar categoría" : "Nueva categoría"}
        subtitle="Un precio mensual por categoría, con historial de cada modificación."
        onClose={() => setCategoryModalOpen(false)}
        onSubmit={saveCategory}
        saving={saving}
        submitLabel={categoryForm.id_categoria ? "Guardar cambios" : "Crear categoría"}
        modalClassName="categorias-modal categorias-modal--form"
        closeOnBackdrop={false}
        wide
      >
        <CategoryForm
          form={categoryForm}
          setForm={setCategoryForm}
          activeTab={categoryFormTab}
          onTabChange={setCategoryFormTab}
        />
      </CrudModal>

      <CrudModal
        open={discountModalOpen}
        title={
          discountForm.id_descuento_familiar
            ? "Editar descuento familiar"
            : "Nuevo descuento familiar"
        }
        subtitle="Definí el porcentaje global según la cantidad de integrantes de la familia."
        onClose={() => setDiscountModalOpen(false)}
        onSubmit={saveDiscount}
        saving={saving}
        submitLabel={
          discountForm.id_descuento_familiar ? "Guardar cambios" : "Crear descuento"
        }
        modalClassName="categorias-modal categorias-modal--discount"
        closeOnBackdrop={false}
        wide
      >
        <DiscountForm form={discountForm} setForm={setDiscountForm} />
      </CrudModal>

      <ModalEliminarGlobal
        open={Boolean(stateModal)}
        operacion={stateModal?.activo ? "baja" : "alta"}
        row={stateModal}
        title={stateModal?.activo ? "Dar de baja la categoría" : "Reactivar categoría"}
        message={
          stateModal?.activo
            ? "La categoría no podrá asignarse en nuevas operaciones."
            : "La categoría volverá a estar disponible para nuevas asignaciones."
        }
        warning={
          stateModal?.activo
            ? "Se conservarán los socios, precios y pagos históricos. Los descuentos familiares son globales y no dependen de esta categoría."
            : ""
        }
        details={
          stateModal
            ? [
                { label: "Categoría", value: stateModal.nombre },
                { label: "Monto mensual", value: money(stateModal.monto_actual) },
                { label: "Socios", value: stateModal.cantidad_socios },
                { label: "Estado actual", value: stateModal.activo ? "ACTIVA" : "BAJA" },
              ]
            : []
        }
        onClose={() => setStateModal(null)}
        onConfirm={changeCategoryState}
        onToast={(type, message, duration) => setFeedback({ type, message, duration })}
        confirmLabel={stateModal?.activo ? "Dar de baja" : "Reactivar"}
        loadingMessage={
          stateModal?.activo
            ? "Dando de baja la categoría…"
            : "Reactivando la categoría…"
        }
        successMessage={
          stateModal?.activo
            ? "Categoría dada de baja correctamente."
            : "Categoría reactivada correctamente."
        }
        errorMessage={
          stateModal?.activo
            ? "No se pudo dar de baja la categoría."
            : "No se pudo reactivar la categoría."
        }
      />

      <ModalEliminarGlobal
        open={Boolean(deleteDiscountModal)}
        operacion="eliminar"
        row={deleteDiscountModal}
        title="Eliminar descuento familiar"
        message="La regla global dejará de aplicarse al total de las cuotas familiares y pasará al historial."
        warning="No se borrará físicamente: se conservarán su configuración, vigencia y auditoría."
        details={
          deleteDiscountModal
            ? [
                { label: "Aplicación", value: "TOTAL FAMILIAR" },
                {
                  label: "Integrantes",
                  value: deleteDiscountModal.cantidad_integrantes_hasta === null
                    ? `DESDE ${deleteDiscountModal.cantidad_integrantes_desde}`
                    : `${deleteDiscountModal.cantidad_integrantes_desde} A ${deleteDiscountModal.cantidad_integrantes_hasta}`,
                },
                {
                  label: "Descuento",
                  value: percentage(deleteDiscountModal.porcentaje_descuento),
                },
              ]
            : []
        }
        onClose={() => setDeleteDiscountModal(null)}
        onConfirm={deleteDiscount}
        onToast={(type, message, duration) => setFeedback({ type, message, duration })}
        confirmLabel="Eliminar regla"
        loadingMessage="Moviendo la regla al historial…"
        successMessage="Descuento familiar eliminado correctamente."
        errorMessage="No se pudo eliminar el descuento familiar."
      />

      <InfoModal
        open={Boolean(historyModal)}
        title="Historial de precios"
        subtitle={historyModal?.nombre || ""}
        onClose={() => setHistoryModal(null)}
        loading={historyLoading}
        loadingTitle="Cargando historial de precios..."
        loadingText="Consultando los cambios registrados para esta categoría."
        modalClassName="categorias-info-modal"
        closeOnBackdrop={false}
      >
        <div className="categorias-info-content">
          <InfoSummary
            items={[
              {
                label: "Estado",
                value: historyIsActive ? "ACTIVA" : "BAJA",
                icon: historyIsActive ? faCheckCircle : faToggleOff,
                tone: historyIsActive ? "success" : "danger",
              },
              { label: "Precio actual", value: money(historyModal?.monto_actual), icon: faWallet },
              { label: "Socios", value: historyModal?.cantidad_socios || 0, icon: faUsers },
              { label: "Cambios registrados", value: history.length, icon: faClockRotateLeft },
            ]}
          />
          <InfoSection
            title="Cambios del precio mensual"
            icon={faCalendarDays}
            badge={history.length}
          >
            {history.map((entry) => (
              <InfoRow
                key={entry.id_historial}
                title={`${money(entry.monto_anterior)} → ${money(entry.monto_nuevo)}`}
                detail={`Cambio registrado: ${formatDateTime(entry.fecha_cambio)}`}
                meta={`Diferencia: ${money(Number(entry.monto_nuevo) - Number(entry.monto_anterior))}`}
              />
            ))}
            {!history.length ? (
              <InfoEmpty>La categoría todavía no tuvo cambios de precio.</InfoEmpty>
            ) : null}
          </InfoSection>
        </div>
      </InfoModal>
    </>
  );
}
