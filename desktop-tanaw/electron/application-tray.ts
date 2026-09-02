import { Menu, Tray } from "electron";
import { getTrayIcon } from "./application-icons";
import { getMlServiceSnapshot, restartMlService, stopCameraProcessingFromTray } from "./services/ml-service-supervisor";

type ApplicationTrayOptions = {
  onOpen: () => void;
  onQuit: () => void | Promise<void>;
  publicDirectory: string;
};

export function createApplicationTray({ onOpen, onQuit, publicDirectory }: ApplicationTrayOptions) {
  let tray: Tray | null = null;

  const update = () => {
    if (!tray) return;
    const mlService = getMlServiceSnapshot();
    const monitoringLabel = mlService.running ? "ML Service: Running" : mlService.error ? "ML Service: Error" : "ML Service: Stopped";
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open TANAW", click: onOpen },
        { label: monitoringLabel, enabled: false },
        { type: "separator" },
        { label: "Stop Monitoring", enabled: mlService.running, click: () => void stopCameraProcessingFromTray() },
        { label: "Restart ML Service", click: () => void restartMlService() },
        { type: "separator" },
        { label: "Quit TANAW", click: () => void onQuit() },
      ]),
    );
  };

  const create = () => {
    if (tray) return;
    try {
      const icon = getTrayIcon(publicDirectory);
      if (icon.isEmpty()) {
        console.warn("[tanaw] Tray icon could not be loaded; continuing without a tray.");
        return;
      }
      tray = new Tray(icon);
      tray.setToolTip("TANAW Enterprise Desktop");
      tray.on("double-click", onOpen);
      update();
    } catch (error) {
      console.error("[tanaw] Tray could not be created.", error);
      tray = null;
    }
  };

  return { create, update };
}
