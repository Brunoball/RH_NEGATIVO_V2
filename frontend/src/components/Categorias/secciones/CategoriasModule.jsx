import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { useSmartScrollRefresh } from "../../Global/useSmartScrollRefresh";
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
  EntityTabPane,
  EntityTabs,
  FloatingField,
} from "../../Global/Formularios/TabbedForm";
import { canWrite } from "../../_shared/auth/session";
import {
  decimalInput,
  onlyDigits,
  preventInvalidDecimalKey,
  upperLimitedText,
  upperWithoutDigits,
} from "../../Global/Formularios/inputSanitizers";
import { categoriasApi } from "../api/categoriasApi";
import { useCategorias } from "../hooks/useCategorias";
import { useDescuentosFamiliares } from "../hooks/useDescuentosFamiliares";
import "../Categorias.css";
import "../modales/CategoriasModal.css";

const CATEGORY_TAB_GENERAL = "general";
const CATEGORY_TAB_PRICE = "price";

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
    // El navegador mantiene el selector nativo.
  }
};

const upper = (value) => String(value ?? "").toLocaleUpperCase("es-AR");


const money = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));

const percentage = (value) =>
  `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(
    Number(value || 0),
  )}%`;

const formatDate = (value, empty = "—") => {
  if (!value) return empty;
  const source = String(value).slice(0, 10);
  const [year, month, day] = source.split("-");
  return year && month && day ? `${day}/${month}/${year}` : source;
};

const emptyCategoryForm = () => ({
  id_categoria: "",
  nombre: "",
  monto_mensual: "",
  monto_anual: "",
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
          { value: CATEGORY_TAB_PRICE, label: "Valores", icon: faWallet },
        ]}
        value={activeTab}
        onChange={onTabChange}
        idPrefix="categoria-form-tab"
        ariaLabel="Secciones de la categoría"
      />

      <EntityTabPane active={activeTab === CATEGORY_TAB_GENERAL} disableWhenInactive>
        <EntityFormPanel
          tabValue={CATEGORY_TAB_GENERAL}
          idPrefix="categoria-form-tab"
          eyebrow="Identificación"
          title="Datos de la categoría"
          icon={faTags}
          tag="Paso 1 de 2"
          bodyClassName="entity-form__grid entity-form__grid--single"
          hint="El nombre identifica la categoría que se asigna a los socios."
        >
          <FloatingField label="Nombre *" active={Boolean(form.nombre)}>
            <input
              value={form.nombre}
              placeholder=" "
              onChange={(event) =>
                update("nombre", upperWithoutDigits(event.target.value).slice(0, 100))
              }
              required
              maxLength={100}
              autoFocus
            />
          </FloatingField>
        </EntityFormPanel>
      </EntityTabPane>

      <EntityTabPane active={activeTab === CATEGORY_TAB_PRICE} disableWhenInactive>
        <EntityFormPanel
          tabValue={CATEGORY_TAB_PRICE}
          idPrefix="categoria-form-tab"
          eyebrow="Configuración económica"
          title="Valores mensual y anual"
          icon={faWallet}
          tag={form.id_categoria ? "Actualización" : "Valores iniciales"}
          bodyClassName="entity-form__grid categorias-price-panel__body"
          hint="Si cambia cualquiera de los dos valores, el sistema conserva el valor anterior en el historial con su fecha de vigencia."
        >
          <FloatingField
            label="Monto mensual *"
            active={form.monto_mensual !== ""}
          >
            <input
              type="text"
              inputMode="decimal"
              placeholder=" "
              value={form.monto_mensual}
              maxLength={13}
              onKeyDown={preventInvalidDecimalKey}
              onChange={(event) =>
                update("monto_mensual", decimalInput(event.target.value, 10, 2))
              }
              required
            />
          </FloatingField>
          <FloatingField
            label="Monto anual *"
            active={form.monto_anual !== ""}
          >
            <input
              type="text"
              inputMode="decimal"
              placeholder=" "
              value={form.monto_anual}
              maxLength={13}
              onKeyDown={preventInvalidDecimalKey}
              onChange={(event) =>
                update("monto_anual", decimalInput(event.target.value, 10, 2))
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
      </EntityTabPane>
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
        title="Integrantes, porcentaje y vigencia"
        icon={faUsers}
        tag="Descuento familiar"
        standalone
        bodyClassName="entity-form__grid categorias-discount-panel__body"
        hint="El descuento se calcula sobre el total familiar después de sumar los importes que corresponden a sus integrantes. No modifica el precio base de ninguna categoría."
      >
        <FloatingField label="Cantidad mínima de integrantes *" active>
          <input
            type="text"
            inputMode="numeric"
            value={form.cantidad_integrantes_desde}
            maxLength={2}
            pattern="[0-9]{1,2}"
            title="Ingresá una cantidad entre 2 y 50."
            onChange={(event) =>
              update(
                "cantidad_integrantes_desde",
                onlyDigits(event.target.value, 2),
              )
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
            maxLength={2}
            pattern="[0-9]{1,2}"
            title="Ingresá una cantidad de hasta 50."
            onChange={(event) =>
              update(
                "cantidad_integrantes_hasta",
                onlyDigits(event.target.value, 2),
              )
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
            maxLength={6}
            onKeyDown={preventInvalidDecimalKey}
            onChange={(event) =>
              update(
                "porcentaje_descuento",
                decimalInput(event.target.value, 3, 2),
              )
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
        <FloatingField
          label="Descripción"
          active={Boolean(form.descripcion)}
          wide
        >
          <input
            value={form.descripcion}
            placeholder=" "
            maxLength={255}
            onChange={(event) => update("descripcion", upperLimitedText(event.target.value, 255))}
          />
        </FloatingField>
      </EntityFormPanel>
    </div>
  );
}

export default function CategoriasModule({ section = "categorias" }) {
  const writable = canWrite();
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

  const {
    items,
    loading,
    error,
    cargar,
  } = useCategorias(categoryFilters, section === "categorias");
  const {
    items: discounts,
    loading: discountsLoading,
    error: discountsError,
    cargar: cargarDescuentos,
  } = useDescuentosFamiliares(discountFilters, section === "descuentos");

  const activeLoading = section === "categorias" ? loading : discountsLoading;
  const activeItemsLength =
    section === "categorias" ? items.length : discounts.length;
  const { bodyRef: tableBodyRef, captureScroll } = useSmartScrollRefresh({
    loading: activeLoading,
    contentKey: `${section}:${activeItemsLength}`,
  });

  const refreshCategoriesKeepingScroll = useCallback(async () => {
    captureScroll();
    return cargar();
  }, [captureScroll, cargar]);

  const refreshDiscountsKeepingScroll = useCallback(async () => {
    captureScroll();
    return cargarDescuentos();
  }, [captureScroll, cargarDescuentos]);

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
      monto_mensual: item.monto_mensual,
      monto_anual: item.monto_anual,
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
    const sanitized = {
      ...categoryForm,
      nombre: upperWithoutDigits(categoryForm.nombre).trim(),
      monto_mensual: decimalInput(categoryForm.monto_mensual, 10, 2),
      monto_anual: decimalInput(categoryForm.monto_anual, 10, 2),
    };

    if (!sanitized.nombre) {
      setCategoryFormTab(CATEGORY_TAB_GENERAL);
      setFeedback({ type: "error", message: "Completá el nombre de la categoría." });
      return;
    }
    if (sanitized.monto_mensual === "" || Number(sanitized.monto_mensual) < 0) {
      setCategoryFormTab(CATEGORY_TAB_PRICE);
      setFeedback({ type: "error", message: "Ingresá un monto mensual válido." });
      return;
    }
    if (sanitized.monto_anual === "" || Number(sanitized.monto_anual) < 0) {
      setCategoryFormTab(CATEGORY_TAB_PRICE);
      setFeedback({ type: "error", message: "Ingresá un monto anual válido." });
      return;
    }
    if (!sanitized.vigente_desde) {
      setCategoryFormTab(CATEGORY_TAB_PRICE);
      setFeedback({
        type: "error",
        message: "Seleccioná desde cuándo estarán vigentes los valores.",
      });
      return;
    }

    setSaving(true);
    try {
      const response = await categoriasApi.guardar(sanitized);
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
  const primaryLabel =
    section === "categorias" ? "Nueva categoría" : "Nuevo descuento";

  const pageFilters =
    section === "categorias"
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
        className="categorias-page"
        title={section === "categorias" ? "Categorías" : "Descuentos familiares"}
        description={
          section === "categorias"
            ? "Administrá las categorías de socios, sus valores mensual y anual y el historial de cada cambio."
            : "Configurá reglas globales por cantidad de integrantes. El descuento se aplica al total calculado para el grupo familiar."
        }
        filters={pageFilters}
        tabsInTitle
        primaryActionLabel={primaryLabel}
        onPrimaryAction={primaryAction}
        primaryActionClassName="categorias-primaryAction"
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
          <>
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
                { label: "Mensual", align: "right" },
                { label: "Anual", align: "right" },
                "Socios vigentes",
                "Último cambio",
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
                  <div className="mov-gridCell is-right is-strong categorias-money-cell">
                    {money(item.monto_mensual)}
                  </div>
                  <div className="mov-gridCell is-right is-strong categorias-money-cell">
                    {money(item.monto_anual)}
                  </div>
                  <div className="mov-gridCell is-center">
                    <span className="mov-chip">{item.cantidad_socios}</span>
                  </div>
                  <div className="mov-gridCell">
                    {formatDate(item.updated_at)}
                  </div>
                  <div className="mov-gridCell mov-gridCell--actions">
                    <div className="mov-actionsInline">
                      <button
                        className="mov-iconBtn"
                        type="button"
                        title="Ver historial de valores"
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
                            className={`mov-iconBtn ${
                              item.activo ? "mov-iconBtn--danger" : ""
                            }`}
                            type="button"
                            title={item.activo ? "Dar de baja" : "Reactivar"}
                            onClick={() => setStateModal(item)}
                          >
                            <FontAwesomeIcon
                              icon={item.activo ? faToggleOff : faRotateLeft}
                            />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </GlobalDivTable>
          </>
        ) : (
          <>
            <GlobalDivTable
              bodyRef={tableBodyRef}
              className="categorias-discountsTable"
              bodyClassName="entity-table-wrap"
              gridClassName={`categorias-discountsGrid ${
                discountHistoryView ? "categorias-discountsGrid--history" : ""
              }`.trim()}
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
                      ? "No hay reglas activas o programadas configuradas."
                      : "Todavía no hay reglas históricas."}
                  </span>
                </div>
              ) : null}

              {discounts.map((item) => {
                const range =
                  item.cantidad_integrantes_hasta === null
                    ? `DESDE ${item.cantidad_integrantes_desde} INTEGRANTES`
                    : item.cantidad_integrantes_desde ===
                        item.cantidad_integrantes_hasta
                      ? `${item.cantidad_integrantes_desde} INTEGRANTES`
                      : `DE ${item.cantidad_integrantes_desde} A ${item.cantidad_integrantes_hasta} INTEGRANTES`;

                const stateTone =
                  item.estado_vigencia === "VIGENTE"
                    ? "mov-chip--ok"
                    : item.estado_vigencia === "PROGRAMADO"
                      ? ""
                      : "mov-chip--danger";

                return (
                  <div
                    className={`mov-gridTable mov-gridTable--row global-divTable__row entity-table-row categorias-discountsGrid ${
                      discountHistoryView
                        ? "categorias-discountsGrid--history"
                        : ""
                    }`.trim()}
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
                      <span>
                        → {formatDate(item.vigencia_hasta, "SIN LÍMITE")}
                      </span>
                    </div>
                    <div className="mov-gridCell">
                      <span className="entity-wrap-text">
                        {item.descripcion || "—"}
                      </span>
                    </div>
                    <div className="mov-gridCell">
                      <span className={`mov-chip ${stateTone}`.trim()}>
                        {item.estado_vigencia === "HISTORICO"
                          ? "HISTÓRICO"
                          : item.estado_vigencia}
                      </span>
                    </div>
                    {!discountHistoryView ? (
                      <div className="mov-gridCell mov-gridCell--actions">
                        {writable ? (
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
                              title="Enviar al historial"
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
          </>
        )}
      </ModulePage>

      <CrudModal
        open={categoryModalOpen}
        title={categoryForm.id_categoria ? "Editar categoría" : "Nueva categoría"}
        subtitle="Administrá el valor mensual y anual sin perder el historial de cambios."
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
        subtitle="Definí el porcentaje global según la cantidad de integrantes y su período de vigencia."
        onClose={() => setDiscountModalOpen(false)}
        onSubmit={saveDiscount}
        saving={saving}
        submitLabel={
          discountForm.id_descuento_familiar
            ? "Guardar cambios"
            : "Crear descuento"
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
        title={
          stateModal?.activo ? "Dar de baja la categoría" : "Reactivar categoría"
        }
        message={
          stateModal?.activo
            ? "La categoría dejará de estar disponible para nuevas asignaciones."
            : "La categoría volverá a estar disponible para nuevas asignaciones."
        }
        warning={
          stateModal?.activo
            ? "No se eliminan socios ni historial de precios. Los socios que ya tienen esta categoría conservarán la relación."
            : ""
        }
        details={
          stateModal
            ? [
                { label: "Categoría", value: stateModal.nombre },
                { label: "Monto mensual", value: money(stateModal.monto_mensual) },
                { label: "Monto anual", value: money(stateModal.monto_anual) },
                { label: "Socios vigentes", value: stateModal.cantidad_socios },
              ]
            : []
        }
        onClose={() => setStateModal(null)}
        onConfirm={changeCategoryState}
        onToast={(type, message, duration) =>
          setFeedback({ type, message, duration })
        }
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
        title="Enviar descuento al historial"
        message="La regla dejará de aplicarse y quedará disponible en el historial de descuentos familiares."
        warning="No se borra físicamente: se conserva la vigencia, configuración y auditoría."
        details={
          deleteDiscountModal
            ? [
                { label: "Aplicación", value: "TOTAL FAMILIAR" },
                {
                  label: "Integrantes",
                  value:
                    deleteDiscountModal.cantidad_integrantes_hasta === null
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
        onToast={(type, message, duration) =>
          setFeedback({ type, message, duration })
        }
        confirmLabel="Enviar al historial"
        loadingMessage="Actualizando la regla…"
        successMessage="Descuento familiar enviado al historial correctamente."
        errorMessage="No se pudo actualizar el descuento familiar."
      />

      <InfoModal
        open={Boolean(historyModal)}
        title="Historial de valores"
        subtitle={historyModal?.nombre || ""}
        onClose={() => setHistoryModal(null)}
        loading={historyLoading}
        loadingTitle="Cargando historial..."
        loadingText="Consultando los cambios mensuales y anuales de esta categoría."
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
              {
                label: "Mensual actual",
                value: money(historyModal?.monto_mensual),
                icon: faWallet,
              },
              {
                label: "Anual actual",
                value: money(historyModal?.monto_anual),
                icon: faWallet,
              },
              {
                label: "Cambios registrados",
                value: history.length,
                icon: faClockRotateLeft,
              },
            ]}
          />
          <InfoSection
            title="Cambios de valores"
            icon={faCalendarDays}
            badge={history.length}
          >
            {history.map((entry) => (
              <InfoRow
                key={entry.id_historial}
                title={`${entry.tipo === "anual" ? "ANUAL" : "MENSUAL"}: ${money(
                  entry.monto_anterior,
                )} → ${money(entry.monto_nuevo)}`}
                detail={`Vigente desde: ${formatDate(entry.fecha_cambio)}`}
                meta={`Diferencia: ${money(
                  Number(entry.monto_nuevo) - Number(entry.monto_anterior),
                )}`}
              />
            ))}
            {!history.length ? (
              <InfoEmpty>La categoría todavía no tiene cambios registrados.</InfoEmpty>
            ) : null}
          </InfoSection>
        </div>
      </InfoModal>
    </>
  );
}
