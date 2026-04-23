import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ManagerApp } from "./manager/ManagerApp";

const params = new URLSearchParams(window.location.search);
const isManager = params.get("window") === "manager";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isManager ? <ManagerApp /> : <App />}
  </React.StrictMode>,
);
