// 原生控制台仅管理本机服务、路径及网络；浏览器与手机不会加载此特权桥接。
mod config;
mod library;
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
    starting: bool,
    progress: Arc<Mutex<Value>>,
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
    let (settings, revision, gemini, openai) = store.settings_snapshot()?;
    let present = |provider: &str| match provider {
        "gemini" => gemini,
        "openai" => openai,
        _ => false,
    };
    let key_present = present(&settings.provider);
    let image_key_present = present(settings.effective_image_provider());
    Ok(
        json!({"settings":settings,"revision":revision,"keyPresent":key_present,"imageKeyPresent":image_key_present,"providerKeys":{"gemini":gemini,"openai":openai},"runtimeConfigured":provider_configuration(&store).map(|(settings,key,image_key)| provider_ready(&settings,&key,&image_key)).unwrap_or(false),"credentialError":null,"platform":std::env::consts::OS}),
    )
}
fn open_store(app: &tauri::AppHandle, control: &mut Control) -> Result<config::Store, String> {
    let (file, data) = config::directories(app)?;
    if (control.runtime.is_some() || control.starting) && !file.is_file() {
        return Err("共享设置数据库不可用，请保留现有配置后重试。".into());
    }
    config::Store::open(&file, &data)
}
// Read-only needs nothing; each active API provider needs its own credential.
fn provider_ready(settings: &Settings, key: &str, image_key: &str) -> bool {
    let api = |name: &str| ["gemini", "openai"].contains(&name);
    let image = settings.effective_image_provider();
    settings.provider == "readonly"
        || (!(api(&settings.provider) && key.is_empty())
            && !(image != settings.provider && api(image) && image_key.is_empty()))
}
// Invocation overrides never mutate the saved settings or import environment credentials.
fn provider_configuration(store: &config::Store) -> Result<(Settings, String, String), String> {
    provider_configuration_with(store, |name| std::env::var(name).ok())
}
fn provider_configuration_with(
    store: &config::Store,
    read: impl Fn(&str) -> Option<String>,
) -> Result<(Settings, String, String), String> {
    let mut settings = store.settings()?;
    if let Some(value) = read("SHIQU_AI_PROVIDER") {
        settings.provider = value;
    }
    // Blank keeps the saved image choice; read-only ignores the image side, matching the CLI.
    if let Some(value) = read("SHIQU_IMAGE_PROVIDER").filter(|value| !value.trim().is_empty()) {
        if settings.provider != "readonly" {
            settings.image_provider = value.trim().into();
        }
    }
    for (name, target) in [
        ("GEMINI_TEXT_MODEL", &mut settings.text_model),
        ("GEMINI_IMAGE_MODEL", &mut settings.image_model),
        ("OPENAI_TEXT_MODEL", &mut settings.openai_text_model),
        ("OPENAI_IMAGE_MODEL", &mut settings.openai_image_model),
        ("CODEX_MODEL", &mut settings.codex_model),
        ("CODEX_BIN", &mut settings.codex_path),
        ("SHIQU_CODEX_HOME", &mut settings.codex_home),
        (
            "CODEX_REASONING_EFFORT",
            &mut settings.codex_reasoning_effort,
        ),
    ] {
        if let Some(value) = read(name) {
            *target = value;
        }
    }
    let mut efforts =
        serde_json::to_value(&settings.task_reasoning_efforts).map_err(|_| "任务推理设置无效。")?;
    for task in [
        "suggest", "art", "frames", "outline", "plan", "review", "repair",
    ] {
        if let Some(value) = read(&format!("SHIQU_REASONING_{}", task.to_uppercase())) {
            efforts[task] = value.into();
        }
    }
    settings.task_reasoning_efforts =
        serde_json::from_value(efforts).map_err(|_| "任务推理设置无效。")?;
    settings.validate()?;
    let credential = |provider: &str| -> Result<String, String> {
        let name = match provider {
            "openai" => Some("OPENAI_API_KEY"),
            "gemini" => Some("GEMINI_API_KEY"),
            _ => None,
        };
        match name.and_then(&read) {
            Some(value) => config::validate_key(&value),
            None => store.key_for(provider),
        }
    };
    let key = credential(&settings.provider)?;
    let image = settings.effective_image_provider();
    let image_key = if image == settings.provider {
        String::new()
    } else {
        credential(image)?
    };
    Ok((settings, key, image_key))
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
    settings: config::NativeSettings,
    expected_revision: i64,
) -> Result<Value, String> {
    let shared = state.0.clone();
    blocking(move || {
        let mut control = shared.lock().map_err(|_| "服务控制器不可用。")?;
        if control.starting || control.runtime.is_some() {
            return Err("请先停止服务，再修改本机设置。".into());
        }
        let mut store = open_store(&app, &mut control)?;
        let merged = settings.merge(store.settings()?);
        store.save_at(&merged, config::KeyChange::Keep, Some(expected_revision))?;
        drop(store);
        settings_view(&app, &mut control)
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
            "codex" | "cloudflared" => dialog.blocking_pick_file(),
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
        if let Some(runtime) = &mut control.runtime {
            return Ok(runtime.snapshot());
        }
        if control.starting {
            return Err("服务正在启动或升级书库，请等待完成。".into());
        }
        let store = open_store(&app, &mut control)?;
        let settings = store.settings()?;
        let (settings_file, _) = config::directories(&app)?;
        let root = resource_root(&app)?;
        control.starting = true;
        *control.progress.lock().map_err(|_| "服务状态不可用。")? =
            json!({"running":false,"phoneUrls":[],"state":"starting"});
        let progress = control.progress.clone();
        drop(store);
        drop(control);
        let result = runtime::start(&settings, &settings_file, &root, move |value| {
            if let Ok(mut current) = progress.lock() {
                *current = value;
            }
        });
        let mut control = shared.lock().map_err(|_| "服务控制器不可用。")?;
        control.starting = false;
        match result {
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
    // 托盘、窗口退出与原生命令共用此边界；升级期间释放互斥锁等待，不中断子进程。
    loop {
        let Ok(mut control) = state.0.lock() else {
            return;
        };
        if control.starting {
            drop(control);
            std::thread::sleep(std::time::Duration::from_millis(100));
            continue;
        }
        drop(control.runtime.take());
        control.last_error = None;
        return;
    }
}
#[tauri::command]
async fn stop_server(state: tauri::State<'_, DesktopState>) -> Result<Value, String> {
    let state = state.inner().clone();
    blocking(move || {
        if state.0.lock().map_err(|_| "服务控制器不可用。")?.starting {
            return Err("书库升级或启动尚未完成，请等待。".into());
        }
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
        if control.starting { return Ok(control.progress.lock().map_err(|_| "服务状态不可用。")?.clone()); }
        if let Some(runtime) = &mut control.runtime {
            match runtime.child.try_wait() {
                Ok(None) => return Ok(runtime.snapshot()),
                _ => {
                    drop(control.runtime.take());
                    control.last_error = Some("服务已退出，请检查设置后重新启动。".into());
                }
            }
        }
        Ok(json!({"running":false,"state":if control.last_error.is_some(){"failed"}else{"stopped"},"phoneUrls":[],"error":control.last_error}))
    })
    .await
}

// 只允许服务根页及一个固定生成设置深链，不接收任意路径、查询或片段。
fn reader_url(url: &str, generation_settings: bool) -> Result<tauri::Url, String> {
    let mut parsed = tauri::Url::parse(url).map_err(|_| "服务地址无效。")?;
    if parsed.scheme() != "http"
        || parsed.host_str() != Some("127.0.0.1")
        || parsed.as_str() != format!("{}/", parsed.origin().ascii_serialization())
        || (url != parsed.origin().ascii_serialization()
            && url != format!("{}/", parsed.origin().ascii_serialization()))
    {
        return Err("服务地址无效。".into());
    }
    if generation_settings {
        parsed.set_fragment(Some("provider-settings"));
    }
    Ok(parsed)
}
#[tauri::command]
fn open_reader(
    app: tauri::AppHandle,
    state: tauri::State<'_, DesktopState>,
    generation_settings: Option<bool>,
) -> Result<(), String> {
    let mut control = state.0.lock().map_err(|_| "服务控制器不可用。")?;
    let status = control.runtime.as_mut().ok_or("请先启动服务。")?.snapshot();
    if status["running"] != true {
        return Err("请先启动服务。".into());
    }
    let parsed = reader_url(
        status["url"].as_str().ok_or("服务地址无效。")?,
        generation_settings.unwrap_or(false),
    )?;
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|_| "无法打开默认浏览器，请复制本机链接。".into())
}
#[tauri::command]
fn open_release_download(app: tauri::AppHandle) -> Result<(), String> {
    // 仅打开官方发布页，外部发行版元数据不决定跳转地址。
    app.opener()
        .open_url(
            "https://github.com/yysun/shiqu/releases/latest",
            None::<&str>,
        )
        .map_err(|_| "无法打开默认浏览器。".into())
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
            open_reader,
            open_release_download,
            quit_app
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "打开拾趣控制台", true, None::<&str>)?;
            let stop_item = MenuItem::with_id(app, "stop", "停止服务", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出拾趣", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &stop_item, &quit_item])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("拾趣")
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
    fn stop_and_exit_wait_for_startup_without_holding_the_controller_lock() {
        let state = DesktopState::default();
        state.0.lock().unwrap().starting = true;
        let stopping = state.clone();
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            stop_control(&stopping);
            send.send(()).unwrap();
        });
        assert!(receive
            .recv_timeout(std::time::Duration::from_millis(20))
            .is_err());
        state.0.lock().unwrap().starting = false;
        receive
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
    }
    #[test]
    fn browser_opener_accepts_only_root_and_fixed_settings_fragment() {
        assert_eq!(
            reader_url("http://127.0.0.1:3000", false).unwrap().as_str(),
            "http://127.0.0.1:3000/"
        );
        assert_eq!(
            reader_url("http://127.0.0.1:3000/", true).unwrap().as_str(),
            "http://127.0.0.1:3000/#provider-settings"
        );
        for url in [
            "https://127.0.0.1:3000/",
            "http://localhost:3000/",
            "http://user:secret@127.0.0.1:3000/",
            "http://127.0.0.1:3000/read",
            "http://127.0.0.1:3000/?",
            "http://127.0.0.1:3000/#",
            "http://127.0.0.1:3000/#other",
            "http://127.0.0.1:3000/read/..",
            "http://127.0.0.1:3000/%2e",
            "http://127.1:3000/",
        ] {
            assert!(reader_url(url, true).is_err(), "{}", url);
        }
    }
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
        let (loaded, key, _) = provider_configuration_with(&store, |_| None).unwrap();
        assert_eq!(loaded.text_model, "saved-model");
        assert_eq!(key, "disposable-command-key");
        store.save(&settings, config::KeyChange::Delete).unwrap();
        assert!(provider_configuration_with(&store, |_| None)
            .unwrap()
            .1
            .is_empty());
        #[cfg(not(windows))]
        {
            settings.provider = "codex".into();
            store.save(&settings, config::KeyChange::Keep).unwrap();
            assert!(provider_configuration_with(&store, |_| None)
                .unwrap()
                .1
                .is_empty());
        }
        drop(store);
        std::fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn provider_environment_is_invocation_only_and_does_not_import_credentials() {
        let folder =
            std::env::temp_dir().join(format!("shiqu-provider-env-{}", std::process::id()));
        let file = folder.join("desktop.sqlite");
        let mut store = config::Store::open(&file, &folder).unwrap();
        let settings = store.settings().unwrap();
        store
            .save(&settings, config::KeyChange::Set("saved-gemini"))
            .unwrap();
        let revision = store.revision().unwrap();
        let (effective, key, _) = provider_configuration_with(&store, |name| match name {
            "SHIQU_AI_PROVIDER" => Some("openai".into()),
            "OPENAI_API_KEY" => Some("env-only-key".into()),
            "OPENAI_TEXT_MODEL" => Some("env-model".into()),
            _ => None,
        })
        .unwrap();
        assert_eq!(effective.provider, "openai");
        assert_eq!(effective.openai_text_model, "env-model");
        assert_eq!(key, "env-only-key");
        assert_eq!(store.settings().unwrap().provider, "gemini");
        assert!(store.key_for("openai").unwrap().is_empty());
        assert_eq!(store.revision().unwrap(), revision);
        assert!(
            provider_configuration_with(&store, |name| if name == "GEMINI_API_KEY" {
                Some("private-invalid\nkey".into())
            } else {
                None
            })
            .is_err()
        );
        drop(store);
        std::fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn separate_image_provider_uses_its_own_credential_and_readiness() {
        let folder =
            std::env::temp_dir().join(format!("shiqu-image-provider-{}", std::process::id()));
        let file = folder.join("desktop.sqlite");
        let mut store = config::Store::open(&file, &folder).unwrap();
        let mut settings = store.settings().unwrap();
        settings.provider = "openai".into();
        settings.image_provider = "gemini".into();
        store
            .save_keys_at(
                &settings,
                &[
                    ("openai", config::KeyChange::Set("text-only-key")),
                    ("gemini", config::KeyChange::Keep),
                ],
                None,
            )
            .unwrap();
        let (loaded, key, image_key) = provider_configuration_with(&store, |_| None).unwrap();
        assert_eq!(loaded.image_provider, "gemini");
        assert_eq!((key.as_str(), image_key.as_str()), ("text-only-key", ""));
        assert!(!provider_ready(&loaded, &key, &image_key));
        store
            .save_keys_at(
                &settings,
                &[("gemini", config::KeyChange::Set("image-only-key"))],
                None,
            )
            .unwrap();
        let (loaded, key, image_key) = provider_configuration_with(&store, |_| None).unwrap();
        assert_eq!(image_key, "image-only-key");
        assert!(provider_ready(&loaded, &key, &image_key));
        // The image override is invocation-only; an unused provider's key is never read.
        let (effective, _, image_key) = provider_configuration_with(&store, |name| match name {
            "SHIQU_IMAGE_PROVIDER" => Some("openai".into()),
            _ => None,
        })
        .unwrap();
        assert_eq!(effective.effective_image_provider(), "openai");
        assert!(image_key.is_empty());
        assert_eq!(store.settings().unwrap().image_provider, "gemini");
        // Blank keeps the saved choice; read-only ignores an invalid image override.
        let blank = provider_configuration_with(&store, |name| {
            (name == "SHIQU_IMAGE_PROVIDER").then(|| " ".into())
        })
        .unwrap();
        assert_eq!(blank.0.image_provider, "gemini");
        assert!(provider_configuration_with(&store, |name| match name {
            "SHIQU_AI_PROVIDER" => Some("readonly".into()),
            "SHIQU_IMAGE_PROVIDER" => Some("invalid".into()),
            _ => None,
        })
        .is_ok());
        settings.provider = "readonly".into();
        assert!(store
            .save_keys_at(&settings, &[("gemini", config::KeyChange::Delete)], None)
            .is_err());
        assert_eq!(store.key_for("gemini").unwrap(), "image-only-key");
        settings.provider = "openai".into();
        settings.image_provider.clear();
        assert!(store
            .save_keys_at(&settings, &[("gemini", config::KeyChange::Delete)], None)
            .is_err());
        store.save(&settings, config::KeyChange::Keep).unwrap();
        let saved: serde_json::Value = serde_json::to_value(store.settings().unwrap()).unwrap();
        assert!(saved.get("imageProvider").is_none());
        drop(store);
        std::fs::remove_dir_all(folder).unwrap();
    }
}
