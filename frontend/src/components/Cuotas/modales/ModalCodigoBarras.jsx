import React, { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBan,
  faBarcode,
  faCheck,
  faHome,
  faIdCard,
  faRotateRight,
  faUser,
} from "@fortawesome/free-solid-svg-icons";
import CrudModal from "../../Global/Modales/CrudModal";
import ModalEliminarGlobal from "../../Global/Modales/ModalEliminarGlobal";
import { cuotasApi } from "../api/cuotasApi";
import "./ModalCodigoBarras.css";

const localToday = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
};

const money = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));

const decimalInput = (value) => {
  const normalized = String(value ?? "")
    .replace(/,/g, ".")
    .replace(/[^0-9.]/g, "");
  const [integer = "", ...decimalParts] = normalized.split(".");
  const decimals = decimalParts.join("").slice(0, 2);
  return decimalParts.length
    ? `${integer.slice(0, 12) || "0"}.${decimals}`
    : integer.slice(0, 12);
};

export const parsePaymentBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 4) {
    return { valid: false, message: "El código debe tener período, año e ID del socio." };
  }

  const periodId = Number(digits.slice(0, 1));
  const year = 2000 + Number(digits.slice(1, 3));
  const partnerId = Number(digits.slice(3));
  if (periodId < 1 || periodId > 7) {
    return { valid: false, message: "El período del código debe estar entre 1 y 7." };
  }
  if (!Number.isInteger(partnerId) || partnerId <= 0) {
    return { valid: false, message: "El ID de socio del código no es válido." };
  }

  return { valid: true, digits, periodId, year, partnerId };
};

const periodLabel = (periodId) =>
  ({
    1: "PERÍODO 1 Y 2",
    2: "PERÍODO 3 Y 4",
    3: "PERÍODO 5 Y 6",
    4: "PERÍODO 7 Y 8",
    5: "PERÍODO 9 Y 10",
    6: "PERÍODO 11 Y 12",
    7: "CONTADO ANUAL",
  })[Number(periodId)] || `PERÍODO ${periodId}`;

const currentAmountOption = (principal) => {
  const options = Array.isArray(principal?.opciones_monto)
    ? principal.opciones_monto
    : [];
  return options.find((option) => option?.actual) || options[0] || null;
};

const mediumIdentifier = (medium) =>
  String(medium?.id_medio_pago ?? medium?.id ?? "");

const normalizedMediumName = (medium) =>
  String(medium?.nombre ?? medium?.descripcion ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

export default function ModalCodigoBarras({
  open,
  onClose,
  mediosPago = [],
  onSaved,
}) {
  const inputRef = useRef(null);
  const requestIdRef = useRef(0);
  const [code, setCode] = useState("");
  const [parsed, setParsed] = useState(null);
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [mediumId, setMediumId] = useState("");
  const [amountOptionId, setAmountOptionId] = useState("");
  const [amount, setAmount] = useState("");
  const [customAmount, setCustomAmount] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);

  const defaultMediumId = useMemo(() => {
    const exactCash = mediosPago.find(
      (medium) => normalizedMediumName(medium) === "EFECTIVO",
    );
    const compatibleCash = mediosPago.find((medium) =>
      normalizedMediumName(medium).includes("EFECTIVO"),
    );
    return mediumIdentifier(exactCash || compatibleCash);
  }, [mediosPago]);

  const principal = context?.principal || null;
  const amountOptions = Array.isArray(principal?.opciones_monto)
    ? principal.opciones_monto
    : [];
  const canRegister = Boolean(principal?.puede_pagar);
  const state = String(principal?.estado || "").toUpperCase();
  const statusLabel = canRegister
    ? "Pendiente"
    : state === "CONDONADO"
      ? "Condonado"
      : principal?.origen_anual
        ? "Cubierto por Contado Anual"
        : principal?.id_pago
          ? "Pagado"
          : "No disponible";

  const reset = () => {
    requestIdRef.current += 1;
    setCode("");
    setParsed(null);
    setContext(null);
    setLoading(false);
    setSaving(false);
    setError("");
    setMediumId(defaultMediumId);
    setAmountOptionId("");
    setAmount("");
    setCustomAmount(false);
    setConfirmAction(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!open) return;
    reset();
  }, [open]);

  useEffect(() => {
    if (!open || !defaultMediumId) return;
    setMediumId((current) => current || defaultMediumId);
  }, [defaultMediumId, open]);

  useEffect(() => {
    // Invalida inmediatamente cualquier respuesta anterior. Así un escaneo
    // lento nunca puede reemplazar en pantalla al último código ingresado.
    const requestId = ++requestIdRef.current;
    if (!open) return undefined;
    const normalized = code.replace(/\D/g, "");
    if (!normalized) {
      setParsed(null);
      setContext(null);
      setError("");
      return undefined;
    }

    const decoded = parsePaymentBarcode(normalized);
    if (!decoded.valid) {
      setParsed(null);
      setContext(null);
      setError(decoded.message);
      return undefined;
    }

    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      setContext(null);
      try {
        const result = await cuotasApi.contextoPago({
          id_socio: decoded.partnerId,
          anio: decoded.year,
          mes: decoded.periodId,
          fecha_pago: localToday(),
        });
        if (requestId !== requestIdRef.current) return;
        const defaultOption = currentAmountOption(result?.principal);
        setParsed(decoded);
        setContext(result);
        setAmountOptionId(String(defaultOption?.id || "actual"));
        setAmount(
          String(
            defaultOption?.monto ??
              result?.principal?.monto_sugerido ??
              result?.principal?.monto_base ??
              "",
          ),
        );
        setCustomAmount(false);
      } catch (requestError) {
        if (requestId !== requestIdRef.current) return;
        setParsed(decoded);
        setError(requestError.message || "No se pudo consultar el código.");
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, 280);

    return () => window.clearTimeout(timeout);
  }, [code, open]);

  const selectedOption = useMemo(
    () =>
      amountOptions.find(
        (option) => String(option.id) === String(amountOptionId),
      ) || currentAmountOption(principal),
    [amountOptionId, amountOptions, principal],
  );

  const updateAmountOption = (value) => {
    const option = amountOptions.find(
      (candidate) => String(candidate.id) === String(value),
    );
    if (!option) return;
    setAmountOptionId(String(option.id));
    setAmount(String(option.monto ?? ""));
  };

  const revalidate = async () => {
    if (!parsed) throw new Error("El código no está listo.");
    const latest = await cuotasApi.contextoPago({
      id_socio: parsed.partnerId,
      anio: parsed.year,
      mes: parsed.periodId,
      fecha_pago: localToday(),
    });
    if (!latest?.principal?.puede_pagar) {
      throw new Error(
        latest?.principal?.motivo_no_disponible ||
          "La cuota ya no está disponible.",
      );
    }
    return latest;
  };

  const save = async ({ condoned }) => {
    if (!parsed || !principal) throw new Error("El código no está listo.");
    if (saving) throw new Error("La operación ya se está procesando.");
    if (!condoned && !mediumId) {
      throw new Error("Seleccioná el medio de pago.");
    }
    if (!condoned && !(Number(amount) > 0)) {
      throw new Error("El monto debe ser mayor a cero.");
    }

    setSaving(true);
    setError("");
    try {
      await revalidate();
      const response = condoned
        ? await cuotasApi.condonarPago({
            id_socio: parsed.partnerId,
            anio: parsed.year,
            mes: parsed.periodId,
            fecha_condonacion: localToday(),
          })
        : await cuotasApi.registrarPago({
            id_socio: parsed.partnerId,
            anio: parsed.year,
            mes: parsed.periodId,
            fecha_pago: localToday(),
            monto: Number(amount),
            id_medio_pago: Number(mediumId),
            aplicar_familia: false,
          });

      try {
        const refresh = onSaved?.({
          type: condoned ? "condoned" : "paid",
          response,
        });
        Promise.resolve(refresh).catch(() => {});
      } catch {
        // El cobro ya quedó persistido. El próximo escaneo siempre vuelve a
        // validar contra el backend, aunque falle el refresco de la tabla.
      }
      return response;
    } catch (saveError) {
      const message = saveError.message || "No se pudo completar la operación.";
      setError(message);
      throw new Error(message);
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (!saving) onClose?.();
  };

  return (
    <>
      <CrudModal
        open={open}
        title="Registro por código de barras"
        subtitle="Escaneá el comprobante o ingresá P + AA + ID del socio."
        onClose={close}
        hideCancel
        hideSubmit
        closeOnBackdrop={false}
        modalClassName="barcode-payment-modal"
      >
        <section className="barcode-reader" aria-label="Lector de código">
          <div className="barcode-reader__icon" aria-hidden="true">
            <FontAwesomeIcon icon={faBarcode} />
          </div>
          <label>
            <span>Código</span>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={24}
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/[^0-9-]/g, ""))
              }
              placeholder="Ej.: 126-1393"
              aria-label="Código de barras"
              disabled={saving}
            />
            <small>
              1 dígito de período + 2 de año + ID. El guion es opcional.
            </small>
          </label>
        </section>

        {loading ? (
          <div className="barcode-payment-state" role="status">
            Consultando socio y estado del período…
          </div>
        ) : null}

        {error ? (
          <div className="barcode-payment-error" role="alert">
            {error}
          </div>
        ) : null}

        {principal ? (
          <section className="barcode-member-card">
            <header>
              <div>
                <span>Información del socio</span>
                <strong>{principal.denominacion}</strong>
              </div>
              <b>ID {principal.id_socio}</b>
            </header>

            <div className="barcode-member-grid">
              <article>
                <FontAwesomeIcon icon={faIdCard} />
                <span>DNI</span>
                <strong>{principal.documento || "SIN DNI"}</strong>
              </article>
              <article>
                <FontAwesomeIcon icon={faHome} />
                <span>Domicilio</span>
                <strong>{principal.domicilio || "NO INFORMADO"}</strong>
              </article>
              <article>
                <FontAwesomeIcon icon={faUser} />
                <span>Categoría</span>
                <strong>{principal.categoria || "SIN CATEGORÍA"}</strong>
              </article>
              <article>
                <FontAwesomeIcon icon={faBarcode} />
                <span>Período</span>
                <strong>
                  {periodLabel(parsed?.periodId)} / {parsed?.year}
                </strong>
              </article>
            </div>

            <div className="barcode-payment-status-row">
              <span className={`is-${canRegister ? "pending" : state.toLowerCase() || "blocked"}`}>
                {statusLabel}
              </span>
              {!canRegister && principal.motivo_no_disponible ? (
                <small>{principal.motivo_no_disponible}</small>
              ) : null}
            </div>

            {canRegister ? (
              <div className="barcode-payment-fields">
                <label>
                  <span>Monto</span>
                  <select
                    value={amountOptionId}
                    onChange={(event) => updateAmountOption(event.target.value)}
                    disabled={customAmount || saving}
                  >
                    {amountOptions.length ? (
                      amountOptions.map((option) => (
                        <option value={option.id} key={option.id}>
                          {money(option.monto)} · {option.actual ? "actual" : "histórico"}
                        </option>
                      ))
                    ) : (
                      <option value="actual">{money(amount)} · actual</option>
                    )}
                  </select>
                </label>

                <label>
                  <span>Medio de pago</span>
                  <select
                    value={mediumId}
                    onChange={(event) => setMediumId(event.target.value)}
                    disabled={saving}
                  >
                    <option value="">Seleccionar…</option>
                    {mediosPago.map((medium) => (
                      <option
                        value={mediumIdentifier(medium)}
                        key={mediumIdentifier(medium)}
                      >
                        {medium.nombre}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="barcode-custom-amount">
                  <input
                    type="checkbox"
                    checked={customAmount}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setCustomAmount(checked);
                      if (!checked) setAmount(String(selectedOption?.monto || ""));
                    }}
                  />
                  <span>Monto personalizado</span>
                </label>

                {customAmount ? (
                  <label>
                    <span>Monto personalizado</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(event) => setAmount(decimalInput(event.target.value))}
                      placeholder="0,00"
                      disabled={saving}
                    />
                  </label>
                ) : null}

                <div className="barcode-payment-total">
                  <span>Total a registrar</span>
                  <strong>{money(amount)}</strong>
                </div>
              </div>
            ) : null}

            <div className="barcode-payment-actions">
              {canRegister ? (
                <>
                  <button
                    type="button"
                    className="mov-btn barcode-condone-button"
                    onClick={() => setConfirmAction("condone")}
                    disabled={saving}
                  >
                    <FontAwesomeIcon icon={faBan} />
                    Condonar
                  </button>
                  <button
                    type="button"
                    className="mov-btn barcode-pay-button"
                    onClick={() => setConfirmAction("pay")}
                    disabled={saving || !mediumId || !(Number(amount) > 0)}
                  >
                    <FontAwesomeIcon icon={faCheck} />
                    Registrar pago
                  </button>
                </>
              ) : (
                <button type="button" className="mov-btn mov-btn--ghost" onClick={reset}>
                  <FontAwesomeIcon icon={faRotateRight} />
                  Leer otro código
                </button>
              )}
            </div>
          </section>
        ) : null}
      </CrudModal>

      <ModalEliminarGlobal
        open={Boolean(confirmAction)}
        operacion={confirmAction === "condone" ? "advertencia" : "exito"}
        row={principal}
        onClose={() => setConfirmAction(null)}
        onConfirm={async () => {
          const action = confirmAction;
          const response = await save({ condoned: action === "condone" });
          reset();
          return {
            ...response,
            mensaje:
              action === "condone"
                ? "Cuota condonada correctamente."
                : "Período pagado correctamente.",
          };
        }}
        title={confirmAction === "condone" ? "Condonar cuota" : "Confirmar pago"}
        message={
          confirmAction === "condone"
            ? "¿Seguro que querés condonar esta cuota?"
            : "¿Confirmás el pago de este período?"
        }
        warning={
          confirmAction === "condone"
            ? "La cuota quedará en $0,00 y no generará un ingreso contable."
            : "Se volverá a validar el código antes de registrar el pago."
        }
        confirmLabel={confirmAction === "condone" ? "Condonar cuota" : "Registrar pago"}
        loadingMessage={confirmAction === "condone" ? "Condonando cuota…" : "Registrando pago…"}
        successMessage={confirmAction === "condone" ? "Cuota condonada correctamente." : "Período pagado correctamente."}
        errorMessage="No se pudo completar la operación."
        details={[
          { label: "Socio", value: principal?.denominacion },
          { label: "Período", value: `${periodLabel(parsed?.periodId)} / ${parsed?.year || "—"}` },
          { label: "Importe", value: confirmAction === "condone" ? money(0) : money(amount) },
        ]}
      />
    </>
  );
}
