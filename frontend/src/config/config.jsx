const withoutTrailingSlash = (value) =>
  String(value || "").trim().replace(/\/+$/, "");

const BASE_URL = withoutTrailingSlash(
  process.env.REACT_APP_API_URL || "http://localhost:3001/routes",
);

export default BASE_URL;

// Desarrollo local:
// php -c "C:\\php\\php.ini" -S localhost:3001
// REACT_APP_API_URL=http://localhost:3001/routes

//npx playwright test --project=chromium --workers=1 --reporter=list



