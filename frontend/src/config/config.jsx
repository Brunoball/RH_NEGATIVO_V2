const HOSTINGER_URL = "https://rhnegativo.3devsnet.com/api/routes";

const configuredUrl = String(
  process.env.REACT_APP_API_URL || ""
)
  .trim()
  .replace(/\/+$/, "");

const isRunningOnLocalhost =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);

const BASE_URL =
  isRunningOnLocalhost && configuredUrl
    ? configuredUrl
    : HOSTINGER_URL;

export default BASE_URL;


// Desarrollo local:
// php -c "C:\\php\\php.ini" -S localhost:3001
// URL LOCAL= http://localhost:3001/routes
// URL HOSTINGER= https://rhnegativo.3devsnet.com/api/routes

//npx playwright test --project=chromium --workers=1 --reporter=list






