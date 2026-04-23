import { Menu, type MenuItemConstructorOptions } from "electron";

/**
 * Install the application menu. We keep the standard roles (app / file /
 * edit / view / window / help) and insert a custom "Assets" submenu for
 * asset-library actions. This is the long-lived surface — performance
 * windows should not grow their own buttons for these.
 */
export function installAppMenu(handlers: {
  openManager: () => void;
}): void {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      label: "Assets",
      submenu: [
        {
          label: "Open Asset Manager…",
          click: () => handlers.openManager(),
        },
      ],
    },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
