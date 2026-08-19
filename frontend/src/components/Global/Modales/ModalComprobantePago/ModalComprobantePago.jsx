import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFilePdf, faPrint } from "@fortawesome/free-solid-svg-icons";
import CrudModal from "../CrudModal";
import { normalizePaymentReceipt } from "../../../_shared/utils/comprobantePago";
import "./ModalComprobantePago.css";

const money = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(Number(value || 0));

const date = (value) =>
  value
    ? new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" }).format(
        new Date(`${String(value).slice(0, 10)}T00:00:00Z`),
      )
    : "—";

const textValue = (...values) => {
  const value = values.find(
    (item) => item !== null && item !== undefined && String(item).trim() !== "",
  );
  return value === undefined ? "" : String(value).trim();
};

const paymentSummary = (comprobante, receipt) => {
  const operation =
    comprobante?.operacion && typeof comprobante.operacion === "object"
      ? comprobante.operacion
      : comprobante || {};
  const lines = Array.isArray(comprobante?.lineas)
    ? comprobante.lineas
    : Array.isArray(operation?.lineas)
      ? operation.lineas
      : Array.isArray(receipt?.lineas)
        ? receipt.lineas
        : [];

  const people = new Map();
  lines.forEach((line, index) => {
    const id = textValue(line?.id_socio, line?.socio_id, line?.id_persona);
    const name = textValue(
      line?.socio,
      line?.denominacion,
      line?.nombre_socio,
      line?.persona,
    );
    const key = id ? `id:${id}` : name ? `name:${name.toLowerCase()}` : `line:${index}`;
    if (!people.has(key)) people.set(key, name);
  });

  // Si el backend no devolvió líneas, usamos la etiqueta preparada por la operación
  // únicamente para los casos simples. En pagos masivos nunca mostramos una lista larga.
  if (!people.size) {
    const label = textValue(
      operation?.socios_label,
      receipt?.socios,
      comprobante?.socios,
    );
    const names = label
      .split("·")
      .map((item) => item.trim())
      .filter(Boolean);
    names.forEach((name, index) => people.set(`label:${index}:${name}`, name));
  }

  const names = [...people.values()].filter(Boolean);
  const explicitPeopleCount = Number(operation?.cantidad_socios || 0);
  const peopleCount = explicitPeopleCount || people.size || names.length || 1;
  const showNames = peopleCount <= 2 && names.length > 0;
  const recordCount =
    Number(operation?.cantidad_registros || 0) || lines.length || 1;

  return {
    peopleCount,
    showNames,
    peopleLabel: showNames ? names.join(" · ") : `${peopleCount} socios`,
    recordCount,
    medium: textValue(
      receipt?.medio,
      receipt?.medio_pago,
      operation?.medio_pago,
      lines[0]?.medio_pago,
    ) || "—",
  };
};

export default function ModalComprobantePago({
  open,
  comprobante,
  loading = false,
  onClose,
  onPrint,
  onExportPdf,
}) {
  if (!open || !comprobante) return null;

  const receipt = normalizePaymentReceipt(comprobante);
  const isWaiver = receipt.estado === "CONDONADO";
  const summary = paymentSummary(comprobante, receipt);
  const isBulkPayment = summary.peopleCount > 2;

  return (
    <CrudModal
      open={open}
      title={isWaiver ? "Registro de condonación" : "Registro de pagos"}
      subtitle={
        receipt.codigo
          ? `Operación ${receipt.codigo}`
          : "La operación fue registrada correctamente."
      }
      onClose={onClose}
      hideCancel
      hideSubmit
      closeOnBackdrop={false}
      modalClassName="payment-receipt-modal"
    >
      <section className="payment-receipt-success" role="status">
        <h2>
          ¡{isWaiver ? "Condonación realizada" : "Pago realizado"} con éxito!
        </h2>
        <p>
          {loading
            ? "Estamos completando los datos de la operación."
            : "Elegí Imprimir o PDF sólo si necesitás generar el comprobante."}
        </p>
      </section>

      <section
        className="payment-receipt-info-summary"
        aria-label="Resumen del registro de pago"
      >
        <article className="payment-receipt-info-summary__wide">
          <span>{summary.showNames ? "Socio" : "Socios incluidos"}</span>
          <strong>{summary.peopleLabel}</strong>
        </article>
        <article>
          <span>Fecha de pago</span>
          <strong>{date(receipt.fecha)}</strong>
        </article>
        <article>
          <span>{isBulkPayment ? "Registros pagados" : "Períodos pagados"}</span>
          <strong>{summary.recordCount}</strong>
        </article>
        <article>
          <span>Medio de pago</span>
          <strong>{summary.medium}</strong>
        </article>
      </section>

      {isBulkPayment && (
        <p className="payment-receipt-bulk-note">
          Para mantener el registro compacto, los nombres no se muestran en pagos de
          más de 2 socios.
        </p>
      )}

      <div className="payment-receipt-footer">
        <div className="payment-receipt-total-pill">
          <span>Total:</span>
          <strong>{money(receipt.monto)}</strong>
        </div>

        <div className="payment-receipt-actions">
          <button
            className="mov-btn mov-btn--ghost payment-receipt-actions__close"
            type="button"
            onClick={onClose}
          >
            Cerrar
          </button>
          <button
            className="mov-btn payment-receipt-actions__print"
            type="button"
            onClick={onPrint}
          >
            <FontAwesomeIcon icon={faPrint} />
            Imprimir
          </button>
          <button
            className="mov-btn payment-receipt-actions__pdf"
            type="button"
            onClick={onExportPdf}
          >
            <FontAwesomeIcon icon={faFilePdf} />
            PDF
          </button>
        </div>
      </div>
    </CrudModal>
  );
}
