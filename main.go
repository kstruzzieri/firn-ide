package main

import (
	"embed"
	"log"
	goruntime "runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

func buildAppMenu(app *App) *menu.Menu {
	appMenu := menu.NewMenu()

	// A custom Menu replaces the macOS default entirely. Without the standard
	// App and Edit menus, the OS never wires Cmd+C/V/X/A or Cmd+Q to the
	// webview's responder chain, so copy/paste is dead in every text field.
	// Other platforms handle clipboard natively and need no menu entry.
	if goruntime.GOOS == "darwin" {
		appMenu.Append(menu.AppMenu())
		appMenu.Append(menu.EditMenu())
	}

	navigateMenu := appMenu.AddSubmenu("Navigate")
	navigateMenu.AddText("Go Back", keys.CmdOrCtrl("["), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "navigate:back")
	})
	navigateMenu.AddText("Go Forward", keys.CmdOrCtrl("]"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "navigate:forward")
	})

	workspaceMenu := appMenu.AddSubmenu("Workspace")
	workspaceMenu.AddText("Switch Workspace", keys.Combo(".", keys.CmdOrCtrlKey, keys.ShiftKey), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:switch-workspace")
	})

	return appMenu
}

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "Firn",
		Width:     1440,
		Height:    900,
		MinWidth:  1024,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 2, G: 6, B: 23, A: 255},
		OnStartup:        app.startup,
		OnBeforeClose:    app.beforeClose,
		Menu:             buildAppMenu(app),
		Bind: []interface{}{
			app,
		},
		Mac: &mac.Options{
			TitleBar: &mac.TitleBar{
				TitlebarAppearsTransparent: true,
				HideTitle:                  true,
				HideTitleBar:               false,
				FullSizeContent:            true,
				UseToolbar:                 false,
			},
			Appearance: mac.NSAppearanceNameDarkAqua,
			About: &mac.AboutInfo{
				Title:   "Firn IDE",
				Message: "A lightweight, workspace-focused IDE for macOS, Linux, and Windows",
			},
		},
		Frameless: false,
	})

	if err != nil {
		log.Fatalf("Error starting Firn IDE: %v", err)
	}
}
