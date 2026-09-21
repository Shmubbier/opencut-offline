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
/// when it's the main module argument (see the `EISDIR`/realpath crash this
/// works around, above). Converts the UNC verbatim form (`\\?\UNC\server\share\...`)
/// to the standard UNC form (`\\server\share\...`) rather than just passing it
/// through unchanged, since that form breaks Node's loader the same way.
/// Non-verbatim paths are returned unchanged.
//
// ponytail: stripping `\\?\` re-exposes the historical ~260 char MAX_PATH
// limit (the verbatim prefix exists specifically to bypass it). Fine for this
// app's install/dev paths; if a deeply-nested install location ever hits it,
// the fix is either keeping the prefix (and fixing Node's handling some other
// way) or requiring a short install path.
fn strip_verbatim_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        path.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::strip_verbatim_prefix;

    #[test]
    fn strips_local_drive_verbatim_prefix() {
        assert_eq!(strip_verbatim_prefix(r"\\?\D:\a\b"), r"D:\a\b");
    }

    #[test]
    fn rewrites_unc_verbatim_prefix_to_standard_unc() {
        assert_eq!(strip_verbatim_prefix(r"\\?\UNC\srv\share\x"), r"\\srv\share\x");
    }

    #[test]
    fn leaves_plain_paths_unchanged() {
        assert_eq!(strip_verbatim_prefix(r"D:\a\b"), r"D:\a\b");
    }
}

/// Assign `pid` to a new Win32 Job Object configured with
/// `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, and leak the job handle so it stays
/// open for the app's whole lifetime. When our process dies — even via a
/// forced kill that skips the graceful `RunEvent` cleanup below — the OS
/// closes the handle, which kills every process still in the job (the node
/// sidecar), so it's never orphaned.
#[cfg(windows)]
fn guard_child_with_job(pid: u32) {
    use std::mem::size_of;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    unsafe {
        let job = match CreateJobObjectW(None, None) {
            Ok(h) => h,
            Err(e) => {
                log::warn!("CreateJobObject failed: {e}; force-kill orphan guard disabled");
                return;
            }
        };
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if let Err(e) = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const core::ffi::c_void,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) {
            log::warn!("SetInformationJobObject failed: {e}; force-kill orphan guard disabled");
            return;
        }
        let process = match OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) {
            Ok(h) => h,
            Err(e) => {
                log::warn!("OpenProcess({pid}) failed: {e}; force-kill orphan guard disabled");
                return;
            }
        };
        if let Err(e) = AssignProcessToJobObject(job, process) {
            log::warn!("AssignProcessToJobObject failed: {e}; force-kill orphan guard disabled");
            return;
        }
        // IMPORTANT: do NOT call CloseHandle on `job` — leave it open for the app's
        // whole lifetime. `windows::Win32::Foundation::HANDLE` is a plain `Copy`
        // wrapper with no `Drop` impl (letting `job` go out of scope here does
        // nothing), so simply never closing it is what keeps it alive: the OS
        // closes it when our process exits, which triggers KILL_ON_JOB_CLOSE and
        // terminates the sidecar even on a forced kill.
        log::info!("sidecar pid {pid} assigned to kill-on-close job");
    }
}
// ponytail: Windows-only orphan guard via Job Object. Non-Windows targets don't
// build this app today; add a POSIX equivalent (prctl/process group) if ported.

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
    let Ok(client) = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    else {
        return false;
    };
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

/// Show a graceful "failed to start" message in the main window, replacing its
/// body, instead of letting a recoverable startup failure panic the whole app.
fn show_startup_error(app: &tauri::AppHandle, msg: &str) {
    log::error!("startup error: {msg}");
    if let Some(window) = app.get_webview_window("main") {
        let safe = msg.replace('\\', "\\\\").replace('\'', "\\'");
        let _ = window.eval(&format!(
            "document.body.innerHTML = '<div style=\"font-family:system-ui,sans-serif;color:#e5e5e5;background:#0a0a0a;height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem;\"><div><h2>OpenCut failed to start</h2><p style=\"opacity:.8\">{safe}</p></div></div>'"
        ));
    }
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
            let server_js = match resolve_server_js(&app_handle) {
                Some(p) => p,
                None => {
                    show_startup_error(&app_handle, "Could not locate the bundled app server files.");
                    return Ok(());
                }
            };
            log::info!("resolved server.js at {server_js:?}");

            let port = match pick_free_port() {
                Ok(p) => p,
                Err(e) => {
                    show_startup_error(&app_handle, &format!("Could not find a free port to start the app server: {e}"));
                    return Ok(());
                }
            };
            log::info!("starting Next.js sidecar on port {port}");

            // Windows' `resource_dir()` can return an extended-length (`\\?\`) verbatim
            // path. Node's CommonJS loader (resolveMainPath -> realpathSync) mishandles
            // that prefix as the entry-script argument and crashes with
            // `EISDIR: lstat 'D:'`, so strip it before passing the path to the sidecar.
            let server_js_arg = strip_verbatim_prefix(&server_js.to_string_lossy());

            let sidecar = match app_handle.shell().sidecar("node") {
                Ok(cmd) => cmd
                    .args([server_js_arg])
                    .env("PORT", port.to_string())
                    .env("HOSTNAME", "127.0.0.1"),
                Err(e) => {
                    show_startup_error(&app_handle, &format!("Could not start the app server: {e}"));
                    return Ok(());
                }
            };

            let (mut rx, child) = match sidecar.spawn() {
                Ok(pair) => pair,
                Err(e) => {
                    show_startup_error(&app_handle, &format!("Could not start the app server: {e}"));
                    return Ok(());
                }
            };
            #[cfg(windows)]
            guard_child_with_job(child.pid());
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
                        show_startup_error(&app_handle, "The local server did not start in time. Please restart the app.");
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
