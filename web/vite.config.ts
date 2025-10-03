import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";


// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
// Dev proxy avoids CORS and lets the frontend call /api/* as if same-origin
        proxy: {
            "/api": "http://localhost:3000"
        }
    }
});