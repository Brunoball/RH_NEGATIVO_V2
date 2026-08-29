const HOSTINGER_URL = "https://rhnegativo.3devsnet.com/api/routes";

const configuredUrl = String(
  process.env.REACT_APP_API_URL || ""
)
  .trim()
  .replace(/\/+$/, "");

const isE2E = process.env.REACT_APP_E2E === "1";

// Uso normal (npm start / build): siempre usa Hostinger.
// Playwright: REACT_APP_E2E=1 habilita la URL seleccionada por el testing
// mediante REACT_APP_API_URL, ya sea LOCAL o HOSTINGER.
const BASE_URL =
  isE2E && configuredUrl
    ? configuredUrl
    : HOSTINGER_URL;

export default BASE_URL;

// Desarrollo local:
// php -c "C:\\php\\php.ini" -S localhost:3001
// URL LOCAL= http://localhost:3001/routes
// URL HOSTINGER= https://rhnegativo.3devsnet.com/api/routes

//npx playwright test --project=chromium --workers=1 --reporter=list






