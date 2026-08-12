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
      <section
        className="payment-receipt-info-summary"
        aria-label="Información del comprobante"
      >
        <article>
          <span>{receipt.tipoEntidad === "EMPRESA" ? "Empresa" : "Socio"}</span>
          <strong>{receipt.socios}</strong>
        </article>
        <article>
          <span>Fecha de pago</span>
          <strong>{date(receipt.fecha)}</strong>
        </article>
      </section>

      <section className="payment-receipt-success" role="status">
        <h2>
          ¡{isWaiver ? "Condonación realizada" : "Pago realizado"} con éxito!
        </h2>
        <p>
          {loading
            ? "Estamos completando los datos del comprobante."
            : "Podés generar el comprobante ahora mismo."}
        </p>
      </section>

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
            Comprobante
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
