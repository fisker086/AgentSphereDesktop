import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeModeProvider } from "./contexts/ThemeModeContext";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeModeProvider>
      <App />
    </ThemeModeProvider>
  </React.StrictMode>,
);
