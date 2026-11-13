import "./polyfill";
import "@fontsource/cinzel/600.css";
import "@fontsource/cinzel/700.css";
import "@fontsource-variable/manrope";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@near-wallet-selector/modal-ui/styles.css";
import "./styles.css";
import { App } from "./App";
import { ChainProvider } from "./store";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ChainProvider>
      <App />
    </ChainProvider>
  </StrictMode>,
);
