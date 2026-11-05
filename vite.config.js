import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// index.html carries a Content-Security-Policy meta tag that production must
// keep (script-src 'self', connect-src without websockets). The dev server breaks
// both rules by design: the React refresh preamble is an inline <script>, and hot
// reload talks over a websocket. So `npm start` serves a relaxed copy of the
// policy; `npm run build` and `npm run preview` serve the real one.
const relaxCspInDev = {
  name: "relax-csp-in-dev",
  apply: "serve",
  transformIndexHtml: (html) =>
    html
      .replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
      .replace("connect-src 'self'", "connect-src 'self' ws:"),
};

export default defineConfig({
  plugins: [react(), relaxCspInDev],
  build: {
    // Create React App wrote to build/, which is gitignored; keep that so a
    // deploy that publishes build/ keeps working. (Vite's default is dist/.)
    outDir: "build",
  },
  test: {
    environment: "jsdom",
    // describe/it/expect/vi as globals, as Jest had them
    globals: true,
  },
});
