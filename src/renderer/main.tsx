import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ManagerApp } from "./manager/ManagerApp";
import { GamepadApp } from "./gamepad/GamepadApp";

const params = new URLSearchParams(window.location.search);
const isManager = params.get("window") === "manager";

function Root() {
  const [gpConnected, setGpConnected] = useState(false);

  useEffect(() => {
    // Detect initial connection and changes
    const check = () => {
      const connected = Array.from(navigator.getGamepads()).some(gp => gp?.connected);
      setGpConnected(connected);
    };
    window.addEventListener("gamepadconnected",    check);
    window.addEventListener("gamepaddisconnected", check);
    // Also poll in case the events fire before React mounts
    const id = setInterval(check, 2000);
    check();
    return () => {
      window.removeEventListener("gamepadconnected",    check);
      window.removeEventListener("gamepaddisconnected", check);
      clearInterval(id);
    };
  }, []);

  return gpConnected ? <GamepadApp /> : <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isManager ? <ManagerApp /> : <Root />}
  </React.StrictMode>,
);
