import { Menu, type MenuItemConstructorOptions } from "electron";

/**
 * Install the application menu. We keep the standard roles (app / file /
 * edit / view / window / help) and insert a custom "Assets" submenu for
 * asset-library actions. This is the long-lived surface — performance
 * windows should not grow their own buttons for these.
 */
export function installAppMenu(handlers: {
  openManager: () => void;
  toggleOutputFullscreen: () => void;
}): void {
  const isMac = process.platform === "darwin";

  const macAppMenu: MenuItemConstructorOptions = {
    label: "VideoJockeyJS",
    submenu: [
      { role: "about" },
      { type: "separator" },
      {
        label: "Toggle Output Fullscreen",
        accelerator: "Shift+CmdOrCtrl+F",
        click: () => handlers.toggleOutputFullscreen(),
      },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [macAppMenu] : []),
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
