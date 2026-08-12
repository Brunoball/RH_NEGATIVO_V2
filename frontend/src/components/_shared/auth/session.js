const SESSION_STORAGE_KEY = "rh_negativo_session";
export const AUTH_SESSION_CHANGED_EVENT = "rh_negativo_auth_changed";

let authChangeScheduled = false;

function notifyAuthSessionChanged() {
  if (typeof window === "undefined" || authChangeScheduled) return;

  authChangeScheduled = true;
  const notify = () => {
    authChangeScheduled = false;
    window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
  };

  if (typeof queueMicrotask === "function") {
    queueMicrotask(notify);
  } else {
    setTimeout(notify, 0);
  }
}

function removeLegacyPersistentSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem("gestion_socios_session");
  } catch {
    // El navegador puede bloquear el almacenamiento; no debe romper la app.
  }
}

function readSessionStorage() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

export function getSession() {
  removeLegacyPersistentSession();

  const session = readSessionStorage();
  if (!session?.token) return null;

  if (session.expira_en) {
    const expiresAt = Date.parse(session.expira_en);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      clearSession();
      return null;
    }
  }

  return session;
}

export function isAuthenticated() {
  return Boolean(getSession()?.token);
}

export function canWrite() {
  return getSession()?.usuario?.rol === "admin";
}

export function saveSession(session) {
  removeLegacyPersistentSession();
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  notifyAuthSessionChanged();
}

export function clearSession() {
  let hadSession = false;
  try {
    hadSession = sessionStorage.getItem(SESSION_STORAGE_KEY) !== null;
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // No impide completar el cierre de sesión en la interfaz.
  }

  removeLegacyPersistentSession();
  if (hadSession) notifyAuthSessionChanged();
}
