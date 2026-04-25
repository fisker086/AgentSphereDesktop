//! Single shared headed Chrome instance for `builtin_browser`.
//! Avoids spawning extra `Browser::new()` processes across browser operations.

use headless_chrome::{Browser, LaunchOptions};
use std::ffi::OsStr;
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use sysinfo::{Pid, ProcessesToUpdate, System};

fn log_info(msg: &str) {
    eprintln!("[chrome_session] {}", msg);
}
fn log_err(msg: &str) {
    eprintln!("[chrome_session] ERROR: {}", msg);
}

static BROWSER: Mutex<Option<Browser>> = Mutex::new(None);

fn map_err(e: impl std::fmt::Display) -> String {
    let msg = e.to_string();
    log_err(&msg);
    msg
}

/// Prefer `AITASKMETA_CHROME_USER_DATA_DIR`, then legacy `AGENTSPHERE_CHROME_USER_DATA_DIR`.
pub fn chrome_user_data_dir_from_env() -> Option<String> {
    for var in [
        "AITASKMETA_CHROME_USER_DATA_DIR",
        "AGENTSPHERE_CHROME_USER_DATA_DIR",
    ] {
        if let Ok(dir) = std::env::var(var) {
            let t = dir.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

fn headed_launch_options() -> LaunchOptions<'static> {
    log_info("Building headed Chrome launch options");

    let mut opts = LaunchOptions::default();
    opts.headless = false;
    opts.idle_browser_timeout = Duration::from_secs(900);
    opts.window_size = Some((1280, 820));
    opts.enable_gpu = true;
    opts.ignore_certificate_errors = false;
    opts.ignore_default_args = vec![OsStr::new("--enable-automation")];
    opts.args = vec![
        OsStr::new("--disable-extensions"),
        OsStr::new("--disable-background-networking"),
        OsStr::new("--disable-sync"),
        OsStr::new("--disable-translate"),
        OsStr::new("--metrics-recording-only"),
        OsStr::new("--no-first-run"),
        OsStr::new("--safebrowsing-disable-auto-update"),
        OsStr::new("--disable-client-side-phishing-detection"),
        OsStr::new("--disable-default-apps"),
        OsStr::new("--disable-password-manager"),
        OsStr::new("--disable-features=TranslateUI"),
    ];
    if let Some(dir) = chrome_user_data_dir_from_env() {
        log_info(&format!("Using user data dir: {}", dir));
        opts.user_data_dir = Some(PathBuf::from(dir));
    } else {
        log_info("No user data dir set, using temp profile");
    }
    opts
}

fn process_pid_alive(pid: u32) -> bool {
    let mut sys = System::new();
    let p = Pid::from_u32(pid);
    sys.refresh_processes(ProcessesToUpdate::Some(&[p]), true);
    sys.process(p).is_some()
}

fn spawned_browser_process_alive(browser: &Browser) -> bool {
    match browser.get_process_id() {
        None => true,
        Some(pid) => process_pid_alive(pid),
    }
}

/// Same Chrome process reused across `run_client_browser` calls.
pub fn shared_headed_browser() -> Result<Browser, String> {
    log_info("Acquiring shared headed browser");

    let mut g = BROWSER.lock().map_err(map_err)?;
    let stale = match g.as_ref() {
        Some(b) => !spawned_browser_process_alive(b),
        None => false,
    };
    if stale {
        log_info("Existing browser process is stale, dropping");
        *g = None;
    }
    if g.is_none() {
        log_info("Launching new headed Chrome");
        let b = Browser::new(headed_launch_options()).map_err(map_err)?;
        if let Some(pid) = b.get_process_id() {
            log_info(&format!("Chrome launched with PID: {}", pid));
        }
        *g = Some(b);
    } else {
        log_info("Reusing existing browser");
    }
    Ok(g.as_ref()
        .ok_or_else(|| "browser not initialized".to_string())?
        .clone())
}

/// Drop the session **without** holding `BROWSER` while `Browser` tears down CDP + the child process.
pub fn close_browser_session() -> Result<bool, String> {
    log_info("Closing browser session");

    let browser = {
        let mut g = BROWSER.lock().map_err(map_err)?;
        g.take()
    };
    let Some(b) = browser else {
        log_info("No browser to close");
        return Ok(false);
    };
    let pid = b.get_process_id();
    log_info(&format!("Dropping browser, PID: {:?}", pid));
    drop(b);
    if let Some(pid) = pid {
        force_kill_chrome_child(pid);
    }
    log_info("Browser session closed");
    Ok(true)
}

fn force_kill_chrome_child(pid: u32) {
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("/bin/kill")
            .args(["-TERM", &pid.to_string()])
            .status();
        thread::sleep(Duration::from_millis(350));
        let _ = std::process::Command::new("/bin/kill")
            .args(["-KILL", &pid.to_string()])
            .status();
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}
