// Keep desktop privileges in local-only native commands; reader/phone pages never load this bridge.
mod config;
mod runtime;

use config::Settings;
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
struct Control {
    runtime: Option<runtime::Runtime>,
    last_error: Option<String>,
    environment: config::EnvironmentImport,
}
#[derive(Clone, Default)]
struct DesktopState(Arc<Mutex<Control>>);

async fn blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| "桌面操作未完成，请重试。".to_string())?
}
fn resource_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../desktop/resources/runtime"));
    }
    Ok(app
        .path()
        .resource_dir()
        .map_err(|_| "无法确定应用资源目录。")?
        .join("runtime"))
}
fn settings_view(app: &tauri::AppHandle, control: &mut Control) -> Result<Value, String> {
    let store = open_store(app, control)?;
    let settings = store.settings()?;
    Ok(
        json!({"settings":settings,"keyPresent":store.key_present()?,"credentialError":control.environment.error,"platform":std::env::consts::OS,"edition":runtime::edition()}),
    )
}
fn open_store(app: &tauri::AppHandle, control: &mut Control) -> Result<config::Store, String> {
    let (file, data) = config::directories(app)?;
    let mut store = config::Store::open(&file, &data)?;
    control
        .environment
        .initialize(&mut store, || match std::env::var("GEMINI_API_KEY") {
            Ok(value) => Ok(Some(value)),
            Err(std::env::VarError::NotPresent) => Ok(None),
            Err(_) => Err(()),
        })?;
    Ok(store)
}

fn provider_configuration(store: &config::Store) -> Result<(Settings, String), String> {
    let settings = store.settings()?;
    let key = if settings.provider == "gemini" {
        store.key()?
    } else {
        String::new()
    };
    Ok((settings, key))
}

#[tauri::command]
async fn get_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, DesktopState>,
) -> Result<Value, String> {
    let shared = state.0.clone();
    blocking(move || {
        let mut control = shared.lock().map_err(|_| "服务控制器不可用。")?;
        settings_view(&app, &mut control)
    })
    .await
}

#[tauri::command]
async fn save_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, DesktopState>,
    settings: Settings,
    key_action: String,
    key: String,
) -> Result<Value, String> {
    let shared = state.0.clone();
    blocking(move || {
        let mut guard = shared.lock().map_err(|_| "服务控制器不可用。")?;
        if guard.runtime.is_some() {
            return Err("请先停止服务，再修改设置或密钥。".into());
        }
        let replacement;
        let change = match key_action.as_str() {
            "keep" => config::KeyChange::Keep,
            "replace" => {
                replacement = config::validate_key(&key)?;
                config::KeyChange::Set(&replacement)
            }
            "delete" => config::KeyChange::Delete,
            _ => return Err("密钥操作无效。".into()),
        };
        let mut store = open_store(&app, &mut guard)?;
        store.save(&settings, change)?;
        if key_action != "keep" {
            guard.environment.error = None;
        }
        drop(store);
        settings_view(&app, &mut guard)
    })
    .await
}

#[tauri::command]
async fn detect_node(
    app: tauri::AppHandle,
    node_path: String,
) -> Result<runtime::NodeInfo, String> {
    blocking(move || runtime::node_info(&node_path, &resource_root(&app)?)).await
}

#[tauri::command]
async fn choose_path(app: tauri::AppHandle, kind: String) -> Result<Option<String>, String> {
    blocking(move || {
        let dialog = app.dialog().file();
        let chosen = match kind.as_str() {
            "node" | "codex" => dialog.blocking_pick_file(),
            "data" | "codexHome" => dialog.blocking_pick_folder(),
            _ => return Err("文件选择类型无效。".into()),
        };
        chosen
            .map(|file| {
                file.into_path()
                    .map(|path| path.to_string_lossy().into())
                    .map_err(|_| "请选择本机路径。".into())
            })
            .transpose()
    })
    .await
}

#[tauri::command]
async fn start_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, DesktopState>,
) -> Result<Value, String> {
    let shared = state.0.clone();
    blocking(move || {
        let mut control = shared.lock().map_err(|_| "服务控制器不可用。")?;
        if let Some(runtime) = &control.runtime {
            return Ok(runtime.status.clone());
        }
        let store = open_store(&app, &mut control)?;
        let (settings, key) = provider_configuration(&store)?;
        match runtime::start(&settings, &key, &resource_root(&app)?) {
            Ok(runtime) => {
                let result = runtime.status.clone();
                control.runtime = Some(runtime);
                control.last_error = None;
                Ok(result)
            }
            Err(error) => {
                control.last_error = Some(error.clone());
                Err(error)
            }
        }
    })
    .await
}

fn stop_control(state: &DesktopState) {
    if let Ok(mut control) = state.0.lock() {
        drop(control.runtime.take());
        control.last_error = None;
    }
}
#[tauri::command]
async fn stop_server(state: tauri::State<'_, DesktopState>) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || {
        stop_control(&state);
        Ok(json!({"running":false,"phoneUrls":[]}))
    })
    .await
}
#[tauri::command]
async fn server_status(state: tauri::State<'_, DesktopState>) -> Result<Value, String> {
    let shared = state.0.clone();
    blocking(move || {
        let mut control = shared.lock().map_err(|_| "服务控制器不可用。")?;
        if let Some(runtime) = &mut control.runtime {
            match runtime.child.try_wait() {
                Ok(None) => return Ok(runtime.status.clone()),
                _ => {
                    drop(control.runtime.take());
                    control.last_error = Some("服务已退出，请检查设置后重新启动。".into());
                }
            }
        }
        Ok(json!({"running":false,"phoneUrls":[],"error":control.last_error}))
    })
    .await
}

#[tauri::command]
async fn test_provider(
    app: tauri::AppHandle,
    state: tauri::State<'_, DesktopState>,
) -> Result<Value, String> {
    let shared = state.0.clone();
    blocking(move || {
        let mut guard = shared.lock().map_err(|_| "服务控制器不可用。")?;
        if guard.runtime.is_some() {
            return Err("请先停止服务，再测试配置。".into());
        }
        let store = open_store(&app, &mut guard)?;
        let (settings, credential) = provider_configuration(&store)?;
        let (mut child, result) =
            runtime::launch(&settings, &credential, &resource_root(&app)?, "test")?;
        drop(child.stdin.take());
        let _ = child.wait();
        Ok(result)
    })
    .await
}

#[tauri::command]
fn open_reader(app: tauri::AppHandle, state: tauri::State<'_, DesktopState>) -> Result<(), String> {
    let control = state.0.lock().map_err(|_| "服务控制器不可用。")?;
    let url = control
        .runtime
        .as_ref()
        .and_then(|runtime| runtime.status["url"].as_str())
        .ok_or("请先启动服务。")?;
    let parsed = tauri::Url::parse(url).map_err(|_| "服务地址无效。")?;
    if parsed.scheme() != "http"
        || parsed.host_str() != Some("127.0.0.1")
        || parsed.path() != "/desktop/pair"
    {
        return Err("服务地址无效。".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "无法打开默认浏览器，请复制本机链接。".into())
}
#[tauri::command]
async fn quit_app(
    app: tauri::AppHandle,
    state: tauri::State<'_, DesktopState>,
) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || {
        stop_control(&state);
        app.exit(0);
        Ok(())
    })
    .await
}
fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(DesktopState::default())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            detect_node,
            choose_path,
            start_server,
            stop_server,
            server_status,
            test_provider,
            open_reader,
            quit_app
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "打开拾趣设置", true, None::<&str>)?;
            let stop_item = MenuItem::with_id(app, "stop", "停止服务", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出拾趣", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &stop_item, &quit_item])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip(if runtime::edition() == "lite" {
                    "拾趣 Lite"
                } else {
                    "拾趣"
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show(app),
                    "stop" | "quit" => {
                        let app = app.clone();
                        let quit = event.id.as_ref() == "quit";
                        thread_stop(app, quit);
                    }
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("Desktop startup failed");
    app.run(|app, event| match event {
        tauri::RunEvent::Exit => stop_control(app.state::<DesktopState>().inner()),
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => show(app),
        _ => {}
    });
}
fn thread_stop(app: tauri::AppHandle, quit: bool) {
    std::thread::spawn(move || {
        stop_control(app.state::<DesktopState>().inner());
        if quit {
            app.exit(0);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn provider_commands_only_use_committed_database_configuration() {
        let folder =
            std::env::temp_dir().join(format!("shiqu-command-config-{}", std::process::id()));
        let file = folder.join("desktop.sqlite");
        let mut store = config::Store::open(&file, &folder).unwrap();
        let mut settings = store.settings().unwrap();
        settings.text_model = "saved-model".into();
        store
            .save(&settings, config::KeyChange::Set("disposable-command-key"))
            .unwrap();
        drop(store);
        let mut store = config::Store::open(&file, &folder).unwrap();
        let (loaded, key) = provider_configuration(&store).unwrap();
        assert_eq!(loaded.text_model, "saved-model");
        assert_eq!(key, "disposable-command-key");
        store.save(&settings, config::KeyChange::Delete).unwrap();
        assert!(provider_configuration(&store).unwrap().1.is_empty());
        #[cfg(not(windows))]
        {
            settings.provider = "codex".into();
            store
                .save(
                    &settings,
                    config::KeyChange::Set("ignored-in-subscription-mode"),
                )
                .unwrap();
            assert!(provider_configuration(&store).unwrap().1.is_empty());
        }
        drop(store);
        std::fs::remove_dir_all(folder).unwrap();
    }
}
