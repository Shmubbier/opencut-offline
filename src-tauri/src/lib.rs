use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Holds the spawned Next.js server child process so it can be killed on exit.
struct ServerChild(Mutex<Option<CommandChild>>);

/// Resolve the path to the bundled Next.js standalone `server.js`.
/// In a packaged app it lives under the resource dir; in `tauri dev` the
/// resources aren't copied there, so fall back to the project's own
/// `.next/standalone/server.js` (assembled by `bun run build` + Task 7's copy step).
fn resolve_server_js(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let packaged = resource_dir.join("resources/server/server.js");
        if packaged.exists() {
            return Some(packaged);
        }
    }

    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/server/server.js");
    if dev_path.exists() {
        return Some(dev_path);
    }

    let project_standalone =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.next/standalone/server.js");
    if project_standalone.exists() {
        return Some(project_standalone);
    }

    None
}

/// Strip a Windows extended-length path prefix (`\\?\`), which Node chokes on
/// when it's the main module argument. Leaves UNC verbatim paths (`\\?\UNC\...`)
/// and non-Windows paths untouched.
fn strip_verbatim_prefix(path: &str) -> String {
    path.strip_prefix(r"\\?\")
        .filter(|rest| !rest.starts_with("UNC\\"))
        .unwrap_or(path)
        .to_string()
}

fn pick_free_port() -> std::io::Result<u16> {
    // ponytail: bind-then-drop has a tiny race (another process could grab the
    // port between drop and our spawn) — acceptable for a single-user desktop
    // app; a real fix would hand the bound socket to the child.
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn wait_for_health(port: u16, timeout: Duration) -> bool {
    let url = format!("http://127.0.0.1:{port}/api/health");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .expect("failed to build health-check http client");
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if let Ok(resp) = client.get(&url).send() {
            if resp.status().is_success() {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServerChild(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let app_handle = app.handle().clone();
            let server_js = resolve_server_js(&app_handle)
                .expect("could not locate server.js (checked resource dir and .next/standalone)");
            log::info!("resolved server.js at {server_js:?}");

            let port = pick_free_port().expect("failed to pick a free localhost port");
            log::info!("starting Next.js sidecar on port {port}");

            // Windows' `resource_dir()` can return an extended-length (`\\?\`) verbatim
            // path. Node's CommonJS loader (resolveMainPath -> realpathSync) mishandles
            // that prefix as the entry-script argument and crashes with
            // `EISDIR: lstat 'D:'`, so strip it before passing the path to the sidecar.
            let server_js_arg = strip_verbatim_prefix(&server_js.to_string_lossy());

            let sidecar = app_handle
                .shell()
                .sidecar("node")
                .expect("failed to create node sidecar command")
                .args([server_js_arg])
                .env("PORT", port.to_string())
                .env("HOSTNAME", "127.0.0.1");

            let (mut rx, child) = sidecar.spawn().expect("failed to spawn node sidecar");
            app_handle.state::<ServerChild>().0.lock().unwrap().replace(child);

            // Drain the sidecar's stdout/stderr so it doesn't block, and log it.
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            log::info!("[next] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            log::warn!("[next] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Error(err) => {
                            log::error!("[next] sidecar error: {err}");
                        }
                        CommandEvent::Terminated(payload) => {
                            log::info!("[next] sidecar exited: {payload:?}");
                        }
                        _ => {}
                    }
                }
            });

            // Health-check on a background thread, then navigate the main window.
            std::thread::spawn(move || {
                let healthy = wait_for_health(port, Duration::from_secs(30));
                if let Some(window) = app_handle.get_webview_window("main") {
                    if healthy {
                        let url = format!("http://127.0.0.1:{port}/");
                        log::info!("server healthy, navigating window to {url}");
                        match url.parse() {
                            Ok(parsed) => {
                                if let Err(e) = window.navigate(parsed) {
                                    log::error!("window.navigate failed: {e}; falling back to eval");
                                    let _ = window.eval(&format!(
                                        "window.location.replace('{url}')"
                                    ));
                                }
                            }
                            Err(e) => log::error!("failed to parse server url: {e}"),
                        }
                    } else {
                        log::error!("server did not become healthy within timeout");
                        let _ = window.eval(
                            "document.body.innerHTML = '<p style=\"font-family:sans-serif;padding:2rem;\">Failed to start the local server. Please restart the app.</p>'",
                        );
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                if let Some(child) = app_handle.state::<ServerChild>().0.lock().unwrap().take() {
                    log::info!("killing node sidecar");
                    let _ = child.kill();
                }
            }
        });
}
