import React, { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDays,
  faChevronDown,
  faIdCard,
  faMoneyBillWave,
  faTrashCan,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import CrudModal from "../../Global/Modales/CrudModal";
import {
  EntityTabs,
  FloatingField,
} from "../../Global/Formularios/TabbedForm";
import "./CuotasModal.css";

const formatOptionDate = (value) => {
  if (!value) return "";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  if (!year || !month || !day) return String(value);
  return `${day}/${month}/${year.slice(-2)}`;
};

const amountOptionPeriodLabel = (option) => {
  if (option?.actual) return "actual";
  if (option?.vigente_hasta) return `hasta ${formatOptionDate(option.vigente_hasta)}`;
  return "histórico";
};

const CURRENT_YEAR = new Date().getFullYear();

function PaymentYearChip({
  value,
  options,
  onChange,
  disabled = false,
  nextYear = null,
  onAddNextYear,
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  return (
    <div className="cuotas-year-chip" ref={containerRef}>
      <button
        type="button"
        className={open ? "is-open" : ""}
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Año ${value}`}
      >
        <FontAwesomeIcon icon={faCalendarDays} />
        <span>{value}</span>
        <i aria-hidden="true" />
      </button>

      {open ? (
        <div className="cuotas-year-chip__menu" role="listbox">
          {options.map((year) => {
            const selected = String(year) === String(value);
            return (
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={selected ? "is-selected" : ""}
                key={year}
                onClick={() => {
                  onChange(String(year));
                  setOpen(false);
                }}
              >
                {year}
              </button>
            );
          })}
          {nextYear && onAddNextYear ? (
            <button
              type="button"
              role="option"
              aria-selected="false"
              className="cuotas-add-year"
              onClick={() => {
                onAddNextYear();
                setOpen(false);
              }}
              title={`Habilitar ${nextYear} para registrar un pago`}
            >
              <FontAwesomeIcon icon={faCalendarDays} />
              <span>Agregar año</span>
              <small>{nextYear}</small>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function ModalPagoCuota({
  paymentOpen,
  paymentMode,
  tipo,
  paymentForm,
  entityLabel,
  closePayment,
  submitPayment,
  submitRegistration,
  requestDeleteRegistration,
  saving,
  selectedMonthIds,
  family,
  familyPaymentCount,
  contextLoading,
  registrationContext,
  paymentTotal,
  money,
  selectedPartner,
  principal,
  setPaymentForm,
  updatePaymentDate,
  paymentYearOptions,
  updatePaymentYear,
  paymentPeriodAmount,
  availableMonthIds,
  annualPaymentAvailable,
  allAvailableMonthsSelected,
  toggleAllPaymentMonths,
  monthOptions,
  paymentPeriods,
  togglePaymentMonth,
  catalogos,
  updateMonthAmountOption,
  toggleMonthCustomAmount,
  updateMonthCustomAmount,
  updateRegistrationAmount,
  updateBatchAmountOption,
}) {
  const [activePaymentTab, setActivePaymentTab] = useState("periods");
  const [familyExpanded, setFamilyExpanded] = useState(false);
  const [extraPaymentYears, setExtraPaymentYears] = useState([]);

  useEffect(() => {
    setActivePaymentTab("periods");
    setFamilyExpanded(false);
  }, [paymentOpen, paymentForm.id_socio, paymentForm.anio]);

  useEffect(() => {
    if (paymentOpen) setExtraPaymentYears([]);
  }, [paymentOpen]);

  const modalPaymentYearOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [...paymentYearOptions, ...extraPaymentYears, paymentForm.anio]
            .filter(Boolean)
            .map(String),
        ),
      ).sort((left, right) => Number(right) - Number(left)),
    [extraPaymentYears, paymentForm.anio, paymentYearOptions],
  );

  const nextPaymentYear = CURRENT_YEAR + 1;
  const canAddNextPaymentYear = !modalPaymentYearOptions.includes(
    String(nextPaymentYear),
  );

  const addNextPaymentYear = () => {
    const nextYear = String(nextPaymentYear);
    setExtraPaymentYears((current) =>
      current.includes(nextYear) ? current : [...current, nextYear],
    );
    updatePaymentYear(nextYear);
  };

  const selectedMonthKey = selectedMonthIds.join(",");
  const familyPaidPeriodsByMember = useMemo(() => {
    const result = new Map();
    if (!family?.id_familia || !selectedMonthKey) return result;

    const monthNameById = new Map(
      monthOptions.map((item) => [String(item.id_mes), String(item.nombre || item.id_mes)]),
    );

    selectedMonthKey.split(",").filter(Boolean).forEach((monthId) => {
      const periodFamily = paymentPeriods[String(monthId)]?.context?.familia;
      if (!periodFamily || String(periodFamily.id_familia) !== String(family.id_familia)) return;

      (periodFamily.integrantes || []).forEach((member) => {
        if (!member?.pagado) return;

        const memberId = String(member.id_socio);
        const monthName = monthNameById.get(String(monthId)) || `Mes ${monthId}`;
        const shortMonth = monthName.slice(0, 3);
        const periodLabel = `${shortMonth.charAt(0).toUpperCase()}${shortMonth.slice(1).toLowerCase()}/${paymentForm.anio}`;
        const current = result.get(memberId) || [];
        if (!current.includes(periodLabel)) current.push(periodLabel);
        result.set(memberId, current);
      });
    });

    return result;
  }, [family?.id_familia, monthOptions, paymentForm.anio, paymentPeriods, selectedMonthKey]);

  const hasFamilyPaidSelectedPeriods = Array.from(
    familyPaidPeriodsByMember.values(),
  ).some((periods) => periods.length > 0);
  const annualSelected = selectedMonthIds.includes("7");
  const bimonthlySelected = selectedMonthIds.some(
    (monthId) => String(monthId) !== "7",
  );

  const registrationTabActive =
    paymentMode === "single" && activePaymentTab === "registration";
  const registrationPaid = Boolean(registrationContext?.pagada);
  const registrationPayment = registrationContext?.pago || null;
  const registrationAmount = Number(
    paymentForm.monto_inscripcion || registrationContext?.monto_sugerido || 0,
  );
  const registrationMedia = useMemo(
    () =>
      (catalogos.medios_pago || []).filter((item) => {
        const name = String(item?.nombre || "").toLocaleUpperCase("es-AR");
        return name.includes("EFECTIVO") || name.includes("TRANSFERENCIA");
      }),
    [catalogos.medios_pago],
  );
  const registrationMediumSelected = registrationMedia.some(
    (item) => String(item.id_medio_pago) === String(paymentForm.id_medio_pago),
  );
  const registrationReady = Boolean(registrationContext);
  const registrationFooterAmount = registrationPaid
    ? Number(registrationPayment?.monto || 0)
    : registrationAmount;
  const footerAmount = registrationTabActive
    ? registrationFooterAmount
    : paymentTotal;

  return (
    <CrudModal
      open={paymentOpen}
      title={
        paymentMode === "multiple"
          ? "Registrar pagos seleccionados"
          : selectedPartner?.denominacion || principal?.denominacion || "Pago de socio"
      }
      subtitle={
        paymentMode === "multiple" ? (
          `Se registrarán ${paymentForm.pagos.length} cuotas en una sola operación.`
        ) : (
          <span className="cuotas-payment-header-meta">
            <span>
              {selectedPartner?.documento
                ? `DNI ${selectedPartner.documento}`
                : `DNI no informado`}
            </span>
            <span>
              Categoría {principal?.categoria || selectedPartner?.categoria || "SIN CATEGORÍA"}
            </span>
            <span>
              Cuota {money(
                paymentPeriodAmount ||
                  principal?.monto_sugerido ||
                  selectedPartner?.monto_sugerido ||
                  0,
              )}
            </span>
          </span>
        )
      }
      onClose={closePayment}
      onSubmit={registrationTabActive ? submitRegistration : submitPayment}
      saving={saving}
      loading={paymentMode === "single" && contextLoading}
      loadingLabel="Cargando datos del pago..."
      loadingText="Consultando los meses disponibles y la información del grupo familiar."
      submitLabel={
        paymentMode === "multiple"
          ? `Registrar ${paymentForm.pagos.length} pagos`
          : registrationTabActive
            ? registrationPaid
              ? "Inscripción ya registrada"
              : "Registrar inscripción"
            : paymentForm.aplicar_familia && family
              ? `Registrar pago familiar (${familyPaymentCount} ${familyPaymentCount === 1 ? "cuota" : "cuotas"})`
              : selectedMonthIds.length > 1
                ? `Registrar ${selectedMonthIds.length} cuotas`
                : "Registrar pago"
      }
      submitDisabled={
        contextLoading ||
        (registrationTabActive
          ? !registrationReady ||
            registrationPaid ||
            !(registrationAmount > 0) ||
            !paymentForm.fecha_pago ||
            !registrationMediumSelected
          : paymentMode === "single"
            ? !selectedMonthIds.length || !(paymentTotal > 0)
            : !(paymentTotal > 0))
      }
      wide
      closeOnBackdrop={false}
      footerStart={
        <div className="cuotas-payment-footer-total">
          <span>
            {registrationTabActive && registrationPaid
              ? "Inscripción registrada"
              : "Total a pagar"}
          </span>
          <strong>{money(footerAmount)}</strong>
          <small>
            {paymentMode === "multiple"
              ? `${paymentForm.pagos.length} cuotas seleccionadas`
              : registrationTabActive
                ? registrationPaid
                  ? `Pagada el ${formatOptionDate(registrationPayment?.fecha_pago)}`
                  : "Pago único de inscripción"
                : annualSelected
                  ? "Contado anual seleccionado"
                  : `${selectedMonthIds.length} ${selectedMonthIds.length === 1 ? "período seleccionado" : "períodos seleccionados"}`}
          </small>
        </div>
      }
      modalClassName={`cuotas-payment-modal cuotas-modal--payment ${paymentMode === "multiple" ? "cuotas-modal--batch" : ""}`.trim()}
    >
      {paymentMode === "single" ? (
        <>
          <EntityTabs
            tabs={[
              {
                value: "periods",
                label: "Meses a pagar",
                icon: faCalendarDays,
                badge: selectedMonthIds.length,
              },
              {
                value: "registration",
                label: "Inscripción",
                icon: faIdCard,
                badge: registrationPaid ? "✓" : null,
              },
              {
                value: "family",
                label: "Familia",
                icon: faUsers,
                badge: family?.cantidad_integrantes || 0,
              },
              {
                value: "amounts",
                label: "Importe por período",
                icon: faMoneyBillWave,
                badge: selectedMonthIds.length,
              },
            ]}
            value={activePaymentTab}
            onChange={setActivePaymentTab}
            idPrefix="cuotas-payment-tab"
            ariaLabel="Secciones del pago"
          />

          <div
            id={`cuotas-payment-tab-${activePaymentTab}-panel`}
            className="cuotas-payment-tab-panel"
            role="tabpanel"
            aria-labelledby={`cuotas-payment-tab-${activePaymentTab}`}
          >
            {activePaymentTab === "family" ? (
              <div className="cuotas-payment-top-context">
                {tipo === "PERSONA" && family ? (
                  <section
                    className="cuotas-family-card"
                    data-modal-size-passive="true"
                    aria-label="Grupo familiar del socio"
                  >
                  <div className="cuotas-family-card__head">
                    <div className="cuotas-family-card__identity">
                      <span className="cuotas-family-card__icon" aria-hidden="true">
                        <FontAwesomeIcon icon={faUsers} />
                      </span>
                      <div>
                        <span>Grupo familiar</span>
                        <strong>{family.nombre}</strong>
                        <small>
                          {family.cantidad_integrantes} integrantes · Descuento vigente {Number(
                            family.porcentaje_descuento || 0,
                          ).toFixed(2)}%
                        </small>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`cuotas-family-expand-btn ${familyExpanded ? "is-open" : ""}`.trim()}
                      onClick={() => setFamilyExpanded((current) => !current)}
                      aria-expanded={familyExpanded}
                      aria-controls="cuotas-family-members-list"
                    >
                      <span>
                        {familyExpanded
                          ? "Ocultar integrantes"
                          : "Ver integrantes"}
                      </span>
                      <FontAwesomeIcon icon={faChevronDown} aria-hidden="true" />
                    </button>
                  </div>

                  <label className="cuotas-family-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(paymentForm.aplicar_familia)}
                      disabled={
                        !selectedMonthIds.length || familyPaymentCount < 1
                      }
                      onChange={(event) =>
                        setPaymentForm((current) => ({
                          ...current,
                          aplicar_familia: event.target.checked,
                        }))
                      }
                      aria-label="Aplicar pago a todo el grupo familiar"
                    />
                    <span>
                      <strong>Aplicar pago a todo el grupo familiar</strong>
                      <small>
                        {!selectedMonthIds.length
                          ? "Seleccioná uno o más meses para habilitar el pago del grupo familiar."
                          : hasFamilyPaidSelectedPeriods
                            ? "Se cobrarán todos los meses pendientes del grupo. Los períodos ya pagados se omiten automáticamente; abrí “Ver integrantes” para identificarlos."
                            : selectedMonthIds.length > 1
                              ? `Se registrarán los ${selectedMonthIds.length} meses seleccionados para todos los integrantes que los tengan pendientes.`
                              : `Está seleccionado por defecto. Al desmarcarlo, se registra únicamente la cuota de ${
                                  principal?.denominacion ||
                                  selectedPartner?.denominacion ||
                                  "este socio"
                                }.`}
                      </small>
                    </span>
                  </label>

                  {hasFamilyPaidSelectedPeriods ? (
                    <div className="cuotas-family-paid-note" role="status">
                      <strong>Hay cuotas ya pagadas en la selección.</strong>
                      <span>
                        Los integrantes marcados en verde ya abonaron esos períodos.
                        Esos cruces se omiten y el resto del grupo sí se registra normalmente.
                      </span>
                    </div>
                  ) : null}

                  <div
                    className={`cuotas-family-members-shell ${familyExpanded ? "is-open" : ""}`.trim()}
                    aria-hidden={!familyExpanded}
                  >
                    <div
                      id="cuotas-family-members-list"
                      className="cuotas-family-members"
                    >
                      {family.integrantes.map((member) => {
                          const paidPeriods =
                            familyPaidPeriodsByMember.get(String(member.id_socio)) || [];
                          const memberClassName = [
                            member.puede_pagar ? "" : "is-unavailable",
                            paidPeriods.length ? "has-paid-selected-period" : "",
                          ]
                            .filter(Boolean)
                            .join(" ");

                          return (
                            <article
                              key={member.id_socio}
                              className={memberClassName}
                            >
                              <div>
                                <strong>{member.denominacion}</strong>
                                <span>
                                  {member.documento || "SIN DNI"} · {member.categoria || "SIN CATEGORÍA"}
                                </span>
                                {paidPeriods.length ? (
                                  <small
                                    className="cuotas-family-paid-badge"
                                    title={`Períodos ya pagados: ${paidPeriods.join(", ")}`}
                                  >
                                    Pagó {paidPeriods.join(" · ")}
                                  </small>
                                ) : null}
                              </div>
                              <div>
                                {paidPeriods.length ? (
                                  <>
                                    <strong className="cuotas-family-paid-status">PAGADO</strong>
                                    <small>{paidPeriods.join(" · ")}</small>
                                  </>
                                ) : member.puede_pagar ? (
                                  <>
                                    <strong>{money(member.monto_sugerido)}</strong>
                                    <small>Base {money(member.monto_base)}</small>
                                  </>
                                ) : (
                                  <strong>
                                    {member.pagado ? "YA PAGADO" : "NO DISPONIBLE"}
                                  </strong>
                                )}
                              </div>
                            </article>
                          );
                      })}
                    </div>
                  </div>
                  </section>
                ) : (
                  <div className="cuotas-no-family">
                    <FontAwesomeIcon icon={faUsers} aria-hidden="true" />
                    <span>
                      {tipo === "PERSONA"
                        ? "Este socio no pertenece a un grupo familiar."
                        : "La aplicación familiar está disponible únicamente para socios."}
                    </span>
                  </div>
                )}
              </div>
            ) : null}

          {activePaymentTab === "registration" ? (
            <section
              className={`cuotas-registration-card ${registrationPaid ? "is-paid" : ""}`.trim()}
              aria-label="Pago de inscripción"
            >
              {registrationPaid ? (
                <div className="cuotas-registration-paid">
                  <button
                    type="button"
                    className="cuotas-registration-paid__delete"
                    onClick={requestDeleteRegistration}
                    aria-label="Eliminar pago de inscripción"
                    title="Eliminar pago de inscripción"
                  >
                    <FontAwesomeIcon icon={faTrashCan} aria-hidden="true" />
                  </button>

                  <span className="cuotas-registration-paid__icon" aria-hidden="true">
                    <FontAwesomeIcon icon={faIdCard} />
                  </span>
                  <div className="cuotas-registration-paid__content">
                    <span>Inscripción ya registrada</span>
                    <strong>{money(registrationPayment?.monto || 0)}</strong>
                    <small>
                      Se pagó el {formatOptionDate(registrationPayment?.fecha_pago)}
                      {registrationPayment?.medio_pago
                        ? ` · ${registrationPayment.medio_pago}`
                        : " · medio no informado"}
                    </small>
                  </div>
                </div>
              ) : (
                <>
                  <header className="cuotas-registration-card__header">
                    <div className="cuotas-registration-card__identity">
                      <span className="cuotas-registration-card__icon" aria-hidden="true">
                        <FontAwesomeIcon icon={faIdCard} />
                      </span>
                      <div className="cuotas-registration-card__copy">
                        <div className="cuotas-registration-card__eyebrow">
                          <span>Inscripción</span>
                          <em>Pago único</em>
                        </div>
                        <strong>Registrar pago de ingreso</strong>
                        <small>Este cobro se realiza una sola vez por socio.</small>
                      </div>
                    </div>

                    <div className="cuotas-registration-card__suggested">
                      <span>Importe sugerido</span>
                      <strong>{money(registrationContext?.monto_sugerido || 0)}</strong>
                      <small>Podés modificarlo</small>
                    </div>
                  </header>

                  <div className="cuotas-registration-card__body">
                    <div className="cuotas-registration-fields">
                    <FloatingField
                      label="Monto de inscripción *"
                      active={Boolean(paymentForm.monto_inscripcion)}
                    >
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={10}
                        value={paymentForm.monto_inscripcion ?? ""}
                        onChange={(event) =>
                          updateRegistrationAmount(event.target.value)
                        }
                        aria-label="Monto de inscripción *"
                        placeholder="0"
                      />
                    </FloatingField>

                    <FloatingField
                      label="Fecha de pago *"
                      active={Boolean(paymentForm.fecha_pago)}
                    >
                      <input
                        type="date"
                        value={paymentForm.fecha_pago}
                        onChange={(event) => updatePaymentDate(event.target.value)}
                        aria-label="Fecha de pago de inscripción *"
                      />
                    </FloatingField>

                    <FloatingField label="Medio de pago *" active>
                      <select
                        value={
                          registrationMediumSelected
                            ? paymentForm.id_medio_pago
                            : ""
                        }
                        onChange={(event) =>
                          setPaymentForm((current) => ({
                            ...current,
                            id_medio_pago: event.target.value,
                          }))
                        }
                        aria-label="Medio de pago de inscripción *"
                      >
                        <option value="">Seleccionar...</option>
                        {registrationMedia.map((item) => (
                          <option key={item.id_medio_pago} value={item.id_medio_pago}>
                            {item.nombre}
                          </option>
                        ))}
                      </select>
                    </FloatingField>
                    </div>

                    <div className="cuotas-registration-note" role="note">
                      <FontAwesomeIcon icon={faIdCard} aria-hidden="true" />
                      <span>
                        El valor vigente se completa automáticamente. Si corresponde,
                        podés ingresar otro importe antes de registrar el pago.
                      </span>
                    </div>
                  </div>
                </>
              )}
            </section>
          ) : null}

          {!["family", "registration"].includes(activePaymentTab) ? (
            <div
              className={`cuotas-payment-main-row ${tipo !== "PERSONA" ? "is-date-only" : ""}`.trim()}
            >
            {activePaymentTab === "periods" ? (
              <section
                className="cuotas-period-group cuotas-period-selector"
                aria-label="Períodos a pagar"
              >
              <header>
                <div>
                  <span>Períodos disponibles</span>
                  <small>
                    Contado Anual es exclusivo y representa el pago completo del año.
                  </small>
                </div>
                <div className="cuotas-period-selector__actions">
                  <PaymentYearChip
                    value={paymentForm.anio}
                    options={modalPaymentYearOptions}
                    onChange={updatePaymentYear}
                    disabled={contextLoading || !paymentForm.id_socio}
                    nextYear={canAddNextPaymentYear ? nextPaymentYear : null}
                    onAddNextYear={addNextPaymentYear}
                  />
                  <div
                    className="cuotas-period-amount"
                    aria-label={`Importe ${money(paymentPeriodAmount)}`}
                  >
                    <span>Importe</span>
                    <strong>
                      {contextLoading ? "Consultando…" : money(paymentPeriodAmount)}
                    </strong>
                  </div>
                  <button
                    type="button"
                    className="cuotas-select-all"
                    onClick={toggleAllPaymentMonths}
                    disabled={
                      contextLoading || annualSelected || !availableMonthIds.length
                    }
                  >
                    {allAvailableMonthsSelected
                      ? "Deseleccionar todos"
                      : "Seleccionar todos"}
                  </button>
                </div>
              </header>

              <div
                className={`cuotas-month-grid ${contextLoading ? "is-loading" : ""}`}
                aria-busy={contextLoading}
              >
                {monthOptions.map((item) => {
                  const monthId = String(item.id_mes);
                  const period = paymentPeriods[monthId];
                  const selected = selectedMonthIds.includes(monthId);
                  const paid = Boolean(period?.paid);
                  const unavailable = Boolean(period?.unavailable);
                  const annualBlockedByIncompleteYear =
                    monthId === "7" && !annualPaymentAvailable;
                  const blockedBySelection =
                    (annualSelected && monthId !== "7") ||
                    (bimonthlySelected && monthId === "7");
                  const disabled =
                    contextLoading ||
                    paid ||
                    unavailable ||
                    annualBlockedByIncompleteYear ||
                    blockedBySelection;
                  const unavailableReason =
                    period?.context?.principal?.motivo_no_disponible || "";
                  const status = String(
                    period?.context?.principal?.estado || "",
                  ).toUpperCase();
                  const coveredByAnnual = Boolean(
                    period?.context?.principal?.origen_anual,
                  );
                  const statusLabel =
                    status === "CONDONADO"
                      ? "Condonado"
                      : coveredByAnnual
                        ? "Cubierto por anual"
                        : paid
                          ? "Pagado"
                          : unavailable || annualBlockedByIncompleteYear
                            ? "No disponible"
                            : blockedBySelection
                              ? "Modalidad exclusiva"
                              : selected
                                ? "Seleccionado"
                                : "Disponible";

                  return (
                    <button
                      type="button"
                      key={`${paymentForm.anio}-${monthId}`}
                      className={`${selected ? "is-selected" : ""} ${paid ? "is-paid" : ""} ${unavailable ? "is-unavailable" : ""} ${disabled && !contextLoading ? "is-disabled" : ""}`.trim()}
                      onClick={() => togglePaymentMonth(monthId)}
                      disabled={disabled}
                      aria-pressed={selected}
                      title={
                        unavailableReason ||
                        (annualBlockedByIncompleteYear
                          ? "Contado Anual requiere que los seis períodos del año estén disponibles para pagar."
                          : blockedBySelection
                            ? "Desmarcá la modalidad seleccionada para cambiar."
                            : undefined)
                      }
                      aria-label={`${item.nombre} ${paymentForm.anio}: ${statusLabel.toLowerCase()}`}
                    >
                      <strong>{item.nombre}</strong>
                      <small>{paymentForm.anio}</small>
                      <span>
                        {statusLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
              </section>
            ) : null}

            {activePaymentTab === "periods" || activePaymentTab === "amounts" ? (
              <aside
                className={`cuotas-payment-date-card ${activePaymentTab === "amounts" ? "is-amounts-only" : ""}`.trim()}
              >
                {activePaymentTab === "periods" ? (
                  <div className="cuotas-payment-date-card__header">
                    <span>Datos del pago</span>
                    <small>Completá la fecha y el medio de pago.</small>
                  </div>
                ) : null}

                <div className="cuotas-payment-date-card__fields">
                  {activePaymentTab === "periods" ? (
                    <div className="cuotas-payment-date-method-row">
                  <FloatingField
                    label="Fecha de pago *"
                    active={Boolean(paymentForm.fecha_pago)}
                  >
                    <input
                      type="date"
                      value={paymentForm.fecha_pago}
                      onChange={(event) => updatePaymentDate(event.target.value)}
                      aria-label="Fecha de pago *"
                    />
                  </FloatingField>

                  <FloatingField label="Medio de pago *" active>
                    <select
                      value={paymentForm.id_medio_pago}
                      onChange={(event) =>
                        setPaymentForm((current) => ({
                          ...current,
                          id_medio_pago: event.target.value,
                        }))
                      }
                      aria-label="Medio de pago *"
                    >
                      <option value="">Seleccionar...</option>
                      {(catalogos.medios_pago || []).map((item) => (
                        <option key={item.id_medio_pago} value={item.id_medio_pago}>
                          {item.nombre}
                        </option>
                      ))}
                    </select>
                  </FloatingField>
                    </div>
                  ) : null}

                {activePaymentTab === "amounts" ? (
                  selectedMonthIds.length ? (
                    <div className="cuotas-month-amount-editor">
                      <div className="cuotas-month-amount-editor__title">
                        <span>Importe por período</span>
                        <small>
                          {paymentForm.aplicar_familia && family
                            ? "Monto del socio; al cambiarlo se cobra individual."
                            : "Actual o histórico según el período."}
                        </small>
                      </div>

                    <div className="cuotas-month-amount-editor__list">
                      {selectedMonthIds.map((monthId) => {
                        const period = paymentPeriods[monthId];
                        const principalForMonth = period?.context?.principal || null;
                        const options = Array.isArray(principalForMonth?.opciones_monto)
                          ? principalForMonth.opciones_monto
                          : [];
                        const amountState =
                          paymentForm.montos_por_mes?.[monthId] || {};
                        const monthLabel =
                          monthOptions.find(
                            (item) => String(item.id_mes) === String(monthId),
                          )?.nombre || `Mes ${monthId}`;

                        return (
                          <section
                            className="cuotas-month-amount-row"
                            key={`amount-${paymentForm.anio}-${monthId}`}
                          >
                            <div className="cuotas-month-amount-row__head">
                              <strong>{monthLabel}</strong>
                              <span>{money(amountState.monto || 0)}</span>
                            </div>

                            <label className="cuotas-month-amount-field">
                              <span>Monto</span>
                              <select
                                value={
                                  options.length
                                    ? amountState.opcion_id || options[0]?.id || ""
                                    : ""
                                }
                                disabled={Boolean(amountState.personalizado)}
                                onChange={(event) =>
                                  updateMonthAmountOption(monthId, event.target.value)
                                }
                                aria-label={`Monto de categoría para ${monthLabel}`}
                              >
                                {options.length ? (
                                  options.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {money(option.monto)} · {amountOptionPeriodLabel(option)}
                                    </option>
                                  ))
                                ) : (
                                  <option value="">
                                    {money(
                                      principalForMonth?.monto_sugerido ||
                                        principalForMonth?.monto_base ||
                                        0,
                                    )}
                                  </option>
                                )}
                              </select>
                            </label>

                            <label className="cuotas-custom-amount-toggle">
                              <input
                                type="checkbox"
                                checked={Boolean(amountState.personalizado)}
                                onChange={(event) =>
                                  toggleMonthCustomAmount(monthId, event.target.checked)
                                }
                              />
                              <span>Monto personalizado</span>
                            </label>

                            {amountState.personalizado ? (
                              <FloatingField label="Monto personalizado *" active>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  pattern="[0-9]*[.,]?[0-9]{0,2}"
                                  maxLength={15}
                                  value={amountState.monto ?? ""}
                                  onChange={(event) =>
                                    updateMonthCustomAmount(monthId, event.target.value)
                                  }
                                  aria-label={`Monto personalizado para ${monthLabel}`}
                                  placeholder="0,00"
                                  autoFocus={selectedMonthIds.length === 1}
                                />
                              </FloatingField>
                            ) : null}
                          </section>
                        );
                      })}
                      </div>
                    </div>
                  ) : (
                    <div className="cuotas-payment-tab-empty" role="status">
                      <strong>No hay períodos seleccionados</strong>
                      <span>
                        Elegí uno o más meses en la pestaña “Meses a pagar” para
                        configurar sus importes.
                      </span>
                      <button
                        type="button"
                        onClick={() => setActivePaymentTab("periods")}
                      >
                        Ir a Meses a pagar
                      </button>
                    </div>
                  )
                ) : null}

                </div>
              </aside>
            ) : null}
            </div>
          ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="entity-form__grid cuotas-payment-grid cuotas-payment-grid--multiple">
            <FloatingField
              label="Fecha de pago *"
              active={Boolean(paymentForm.fecha_pago)}
            >
              <input
                type="date"
                value={paymentForm.fecha_pago}
                onChange={(event) =>
                  setPaymentForm((current) => ({
                    ...current,
                    fecha_pago: event.target.value,
                  }))
                }
                aria-label="Fecha de pago *"
              />
            </FloatingField>
            <FloatingField
              label="Medio de pago *"
              active
            >
              <select
                value={paymentForm.id_medio_pago}
                onChange={(event) =>
                  setPaymentForm((current) => ({
                    ...current,
                    id_medio_pago: event.target.value,
                  }))
                }
                aria-label="Medio de pago *"
              >
                <option value="">Seleccionar...</option>
                {(catalogos.medios_pago || []).map((item) => (
                  <option key={item.id_medio_pago} value={item.id_medio_pago}>
                    {item.nombre}
                  </option>
                ))}
              </select>
            </FloatingField>
          </div>
    
          <section
            className="cuotas-batch-list"
            aria-label="Pagos seleccionados"
          >
            <header>
              <div>
                <span>Selección múltiple</span>
                <strong>
                  {paymentForm.pagos.length} cuotas listas para registrar
                </strong>
              </div>
              <strong>{money(paymentTotal)}</strong>
            </header>
            <div>
              {paymentForm.pagos.map((payment, index) => {
                const metadata = [
                  payment.documento || null,
                  payment.categoria || "SIN CATEGORÍA",
                  payment.mes && payment.anio
                    ? `${payment.mes}/${payment.anio}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                const amountOptions =
                  Array.isArray(payment.opciones_monto) &&
                  payment.opciones_monto.length
                    ? payment.opciones_monto
                    : [
                        {
                          id: payment.opcion_monto_id || "actual",
                          actual: true,
                          monto: payment.monto,
                        },
                      ];

                return (
                  <article
                    key={`${payment.id_socio}-${payment.anio}-${payment.mes}`}
                  >
                    <span
                      className="cuotas-batch-list__index"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <div>
                      <strong>{payment.denominacion}</strong>
                      {metadata ? <span>{metadata}</span> : null}
                      {payment.familia ? (
                        <small>
                          {payment.familia} ·{" "}
                          {Number(
                            payment.porcentaje_descuento_familiar || 0,
                          ).toFixed(2)}
                          % de descuento
                        </small>
                      ) : null}
                    </div>
                    <label>
                      <span>Monto</span>
                      <select
                        value={payment.opcion_monto_id || amountOptions[0]?.id || ""}
                        onChange={(event) =>
                          updateBatchAmountOption(index, event.target.value)
                        }
                        aria-label={`Monto de ${payment.denominacion}`}
                      >
                        {amountOptions.map((option) => {
                          const periodLabel = amountOptionPeriodLabel(option);
                          const label = option.actual
                            ? "Actual"
                            : periodLabel.charAt(0).toUpperCase() +
                              periodLabel.slice(1);
                          return (
                            <option key={option.id} value={option.id}>
                              {money(option.monto)} · {label}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}
    </CrudModal>
  );
}
