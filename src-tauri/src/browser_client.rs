//! Local visible Chrome / Chromium automation via DevTools remote debugging.
//! Reuses a visible browser window so the user can watch the automation happen.

use headless_chrome::{
    protocol::cdp::{Page::CaptureScreenshotFormatOption, Runtime::RemoteObject},
    Browser, Tab,
};
use serde::Deserialize;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::sleep;
use std::time::{Duration, Instant};

const REMOTE_DEBUGGING_PORT: u16 = 9223;
const REMOTE_DEBUGGING_HOST: &str = "127.0.0.1";
/// Max time to wait for DevTools after spawning Chrome (slow disks / first profile init).
const REMOTE_STARTUP_WAIT_MS: u64 = 20_000;
const DEFAULT_OP_TIMEOUT_MS: u64 = 60_000;
const MIN_OP_TIMEOUT_MS: u64 = 5_000;
const MAX_OP_TIMEOUT_MS: u64 = 120_000;
/// After `Browser::connect`, CDP may not list page targets immediately — do not `new_tab()` until this elapses.
const TAB_DISCOVERY_WAIT: Duration = Duration::from_secs(10);
const TAB_POLL: Duration = Duration::from_millis(50);
/// headless_chrome drops the WebSocket if idle longer than this; one `invoke` can include slow navigations.
const BROWSER_CONNECT_IDLE: Duration = Duration::from_secs(600);

/// Keeps the `Child` handle for Chrome we spawned. If dropped without storing, Rust kills the process on `Drop`.
static AUTOMATION_CHROME_CHILD: Mutex<Option<Child>> = Mutex::new(None);

fn store_automation_chrome(child: Child) -> Result<(), String> {
    let mut guard = AUTOMATION_CHROME_CHILD
        .lock()
        .map_err(|_| "Chrome process lock poisoned".to_string())?;
    if let Some(mut old) = guard.take() {
        eprintln!(
            "[browser_client] stopping previous automation Chrome pid={}",
            old.id()
        );
        let _ = old.kill();
        let _ = old.wait();
    }
    eprintln!("[browser_client] retaining automation Chrome pid={}", child.id());
    *guard = Some(child);
    Ok(())
}

/// Stops Chrome that was started by [`launch_visible_browser_process`] (if any).
fn close_automation_chrome() -> Result<String, String> {
    let mut guard = AUTOMATION_CHROME_CHILD
        .lock()
        .map_err(|_| "Chrome process lock poisoned".to_string())?;
    if let Some(mut child) = guard.take() {
        let pid = child.id();
        eprintln!("[browser_client] closing automation Chrome pid={pid}");
        child
            .kill()
            .map_err(|e| format!("failed to stop Chrome (pid {pid}): {e}"))?;
        let _ = child.wait();
        return Ok(
            "Closed the Chrome instance started for AgentSphere automation.".to_string(),
        );
    }
    Ok(
        "No AgentSphere-managed Chrome process is running (start automation first, or close the window manually if you connected to an existing browser)."
            .to_string(),
    )
}

fn str_arg(obj: &serde_json::Map<String, Value>, keys: &[&str]) -> String {
    for k in keys {
        if let Some(v) = obj.get(*k) {
            if let Some(s) = v.as_str() {
                return s.trim().to_string();
            }
        }
    }
    String::new()
}

/// Optional `timeout_ms` / `timeout` / `navigation_timeout_ms` on tool params (CDP default timeout).
fn timeout_ms_from_params(obj: &serde_json::Map<String, Value>) -> u64 {
    for k in ["timeout_ms", "timeout", "navigation_timeout_ms"] {
        if let Some(v) = obj.get(k) {
            let n_opt = match v {
                Value::Number(n) => n
                    .as_u64()
                    .or_else(|| n.as_i64().and_then(|i| if i >= 0 { Some(i as u64) } else { None })),
                Value::String(s) => s.trim().parse::<u64>().ok(),
                _ => None,
            };
            if let Some(n) = n_opt {
                return n.clamp(MIN_OP_TIMEOUT_MS, MAX_OP_TIMEOUT_MS);
            }
        }
    }
    DEFAULT_OP_TIMEOUT_MS
}

fn remote_object_to_string(r: RemoteObject) -> String {
    if let Some(v) = r.value {
        return serde_json::to_string(&v).unwrap_or_else(|_| "(serialize failed)".to_string());
    }
    r.description.unwrap_or_else(|| "(no value)".to_string())
}

fn validate_http_url(url: &str) -> Result<(), String> {
    let u = url.trim();
    if u.is_empty() {
        return Err("missing url".to_string());
    }
    let lower = u.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("only http and https URLs are allowed".to_string());
    }
    if lower.starts_with("javascript:") || lower.starts_with("file:") {
        return Err("unsupported URL scheme".to_string());
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct DevtoolsVersionInfo {
    #[serde(rename = "webSocketDebuggerUrl")]
    web_socket_debugger_url: String,
}

fn browser_profile_dir() -> Result<PathBuf, String> {
    let dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("agentsphere")
        .join("visible-browser-profile");
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create browser profile dir: {e}"))?;
    Ok(dir)
}

fn chrome_candidates() -> Vec<String> {
    let mut out = Vec::new();
    for env_key in ["CHROME", "CHROME_PATH"] {
        if let Ok(v) = std::env::var(env_key) {
            let trimmed = v.trim();
            if !trimmed.is_empty() {
                out.push(trimmed.to_string());
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        out.extend(
            [
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Chromium.app/Contents/MacOS/Chromium",
                "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
            ]
            .iter()
            .map(|s| s.to_string()),
        );
    }

    #[cfg(target_os = "windows")]
    {
        out.extend(
            [
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files\Chromium\Application\chrome.exe",
            ]
            .iter()
            .map(|s| s.to_string()),
        );
    }

    #[cfg(target_os = "linux")]
    {
        out.extend(
            ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"]
                .iter()
                .map(|s| s.to_string()),
        );
    }

    out
}

fn command_exists(candidate: &str) -> bool {
    if candidate.contains(std::path::MAIN_SEPARATOR) {
        return PathBuf::from(candidate).exists();
    }
    Command::new(candidate)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn resolve_chrome_command() -> Result<String, String> {
    for candidate in chrome_candidates() {
        if command_exists(&candidate) {
            return Ok(candidate);
        }
    }
    Err(
        "Chrome/Chromium not found. Install Chrome, or set CHROME / CHROME_PATH to the executable path."
            .to_string(),
    )
}

fn fetch_devtools_ws_url(verbose: bool) -> Result<String, String> {
    if verbose {
        eprintln!(
            "[browser_client] probing devtools endpoint {}:{}",
            REMOTE_DEBUGGING_HOST, REMOTE_DEBUGGING_PORT
        );
    }
    // Use HTTP client instead of raw TcpStream read: on macOS, `read_to_string` on a half-ready
    // DevTools socket can return EAGAIN (os error 35) while Chrome is still starting.
    let url = format!(
        "http://{REMOTE_DEBUGGING_HOST}:{REMOTE_DEBUGGING_PORT}/json/version"
    );
    let body = ureq::get(&url)
        .timeout(Duration::from_secs(3))
        .call()
        .map_err(|e| format!("devtools HTTP GET failed: {e}"))?
        .into_string()
        .map_err(|e| format!("devtools HTTP read body: {e}"))?;
    let body = body.trim();
    let info: DevtoolsVersionInfo =
        serde_json::from_str(body).map_err(|e| format!("invalid devtools JSON: {e}"))?;
    if info.web_socket_debugger_url.trim().is_empty() {
        return Err("devtools endpoint returned empty websocket URL".to_string());
    }
    if verbose {
        eprintln!("[browser_client] devtools websocket URL acquired");
    }
    Ok(info.web_socket_debugger_url)
}

fn launch_visible_browser_process() -> Result<(), String> {
    let chrome = resolve_chrome_command()?;
    let profile_dir = browser_profile_dir()?;
    #[cfg(target_os = "macos")]
    {
        eprintln!(
            "[browser_client] launching visible chrome binary={} profile={}",
            chrome,
            profile_dir.to_string_lossy()
        );
    }
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!(
            "[browser_client] launching visible chrome command={} profile={}",
            chrome,
            profile_dir.to_string_lossy()
        );
    }

    // Spawn the real Chrome/Chromium binary (macOS included). Using `open -a … --args` is
    // unreliable: Launch Services may not forward flags consistently, so DevTools never binds.
    let mut cmd = Command::new(&chrome);
    cmd.arg(format!("--remote-debugging-port={REMOTE_DEBUGGING_PORT}"))
        .arg("--remote-debugging-address=127.0.0.1")
        // Chromium 111+: WebSocket debugger requires an allowlist; headless_chrome connects with Origin.
        .arg("--remote-allow-origins=*")
        .arg(format!(
            "--user-data-dir={}",
            profile_dir.to_string_lossy()
        ))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "linux")]
    {
        cmd.arg("--no-sandbox")
            .arg("--disable-dev-shm-usage")
            .arg("--disable-gpu");
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch visible Chrome/Chromium: {e}"))?;
    eprintln!(
        "[browser_client] chrome spawn ok pid={}",
        child.id()
    );
    store_automation_chrome(child)?;
    Ok(())
}

fn connect_or_launch_visible_browser() -> Result<Browser, String> {
    if let Ok(ws_url) = fetch_devtools_ws_url(true) {
        eprintln!("[browser_client] connecting to existing chrome devtools session");
        return Browser::connect_with_timeout(ws_url, BROWSER_CONNECT_IDLE)
            .map_err(|e| format!("failed to connect Chrome: {e}"));
    }

    eprintln!("[browser_client] no existing devtools session found; launching chrome");
    launch_visible_browser_process()?;

    let mut last_err = String::from("visible Chrome did not expose devtools endpoint");
    let deadline = Duration::from_millis(REMOTE_STARTUP_WAIT_MS);
    let start = Instant::now();
    let mut last_progress = start;
    let mut n: u32 = 0;
    while start.elapsed() < deadline {
        // Fast polls at first (Chrome often ready within ~500ms), then back off.
        let delay_ms = if n < 25 { 100 } else { 300 };
        sleep(Duration::from_millis(delay_ms));
        n = n.saturating_add(1);

        if last_progress.elapsed() >= Duration::from_secs(2) {
            eprintln!(
                "[browser_client] still waiting for devtools on {}:{} (elapsed {:?})",
                REMOTE_DEBUGGING_HOST,
                REMOTE_DEBUGGING_PORT,
                start.elapsed()
            );
            last_progress = Instant::now();
        }

        match fetch_devtools_ws_url(false) {
            Ok(ws_url) => {
                eprintln!(
                    "[browser_client] devtools ready after {:?}; connecting WebSocket",
                    start.elapsed()
                );
                return Browser::connect_with_timeout(ws_url, BROWSER_CONNECT_IDLE)
                    .map_err(|e| format!("failed to connect launched Chrome: {e}"));
            }
            Err(e) => {
                last_err = e;
            }
        }
    }

    Err(format!(
        "failed to start visible Chrome automation session after {:?}: {last_err}",
        start.elapsed()
    ))
}

fn active_tab(browser: &Browser) -> Result<Arc<Tab>, String> {
    eprintln!("[browser_client] resolving active tab");
    // Each `run_client_browser` builds a new `Browser::connect`. `get_tabs()` is filled asynchronously
    // via Target discovery; reading it too soon yields an empty vec and we used to call `new_tab()`
    // every time — which looks like "always opening new windows/tabs". Wait for an existing page.
    let start = Instant::now();
    browser.register_missing_tabs();
    let mut last_register = Instant::now();
    while start.elapsed() < TAB_DISCOVERY_WAIT {
        if last_register.elapsed() >= Duration::from_millis(250) {
            browser.register_missing_tabs();
            last_register = Instant::now();
        }
        let tabs = browser
            .get_tabs()
            .lock()
            .map_err(|_| "failed to lock Chrome tab list".to_string())?;
        if let Some(tab) = tabs.first().cloned() {
            drop(tabs);
            tab.bring_to_front()
                .map_err(|e| format!("failed to activate Chrome tab: {e}"))?;
            eprintln!(
                "[browser_client] reusing existing tab (waited {:?})",
                start.elapsed()
            );
            return Ok(tab);
        }
        drop(tabs);
        sleep(TAB_POLL);
    }

    eprintln!(
        "[browser_client] no page tab listed after {:?}; opening one tab in the browser window",
        TAB_DISCOVERY_WAIT
    );
    let tab = browser
        .new_tab()
        .map_err(|e| format!("failed to create Chrome tab: {e}"))?;
    tab.bring_to_front()
        .map_err(|e| format!("failed to activate new Chrome tab: {e}"))?;
    Ok(tab)
}

fn maybe_navigate(tab: &Tab, url: &str) -> Result<(), String> {
    if url.is_empty() {
        return Ok(());
    }
    validate_http_url(url)?;
    eprintln!("[browser_client] navigate start url={}", url);
    tab.navigate_to(url).map_err(|e| e.to_string())?;
    tab.wait_until_navigated().map_err(|e| e.to_string())?;
    eprintln!("[browser_client] navigate done url={}", url);
    Ok(())
}

fn truncate_html(mut s: String) -> String {
    const MAX: usize = 50_000;
    if s.len() > MAX {
        s.truncate(MAX);
        s.push_str("\n\n[truncated]");
    }
    s
}

/// Runs `builtin_browser` locally via a visible Chrome / Chromium window.
#[tauri::command]
pub fn run_client_browser(params: Value) -> Result<String, String> {
    eprintln!("[browser_client] run_client_browser invoked");

    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let op = str_arg(obj, &["operation", "op", "action"]);
    if op.is_empty() {
        return Err("missing operation".to_string());
    }

    let op = op.to_ascii_lowercase();
    if matches!(
        op.as_str(),
        "close" | "quit" | "shutdown" | "exit" | "stop_browser"
    ) {
        eprintln!("[browser_client] requested operation={} (close session)", op);
        return close_automation_chrome();
    }

    let url = str_arg(obj, &["url", "target", "link"]);
    let timeout_ms = timeout_ms_from_params(obj);
    eprintln!(
        "[browser_client] requested operation={} url={} timeout_ms={}",
        op,
        if url.is_empty() { "(none)" } else { &url },
        timeout_ms
    );

    let browser = connect_or_launch_visible_browser()?;
    let tab = active_tab(&browser)?;
    tab.set_default_timeout(Duration::from_millis(timeout_ms));
    eprintln!("[browser_client] tab ready, executing operation={}", op);

    match op.as_str() {
        "goto" | "visit" | "open" => {
            validate_http_url(&url)?;
            maybe_navigate(&tab, &url)?;
            let title = tab.get_title().map_err(|e| e.to_string())?;
            eprintln!("[browser_client] goto done title={}", title);
            Ok(format!(
                "Successfully visited: {}\nPage title: {}",
                url, title
            ))
        }

        "click" => {
            maybe_navigate(&tab, &url)?;
            let selector = str_arg(obj, &["selector", "element", "css"]);
            if selector.is_empty() {
                return Err("missing selector for click".to_string());
            }
            eprintln!("[browser_client] click selector={}", selector);
            tab.wait_for_element(&selector)
                .map_err(|e| e.to_string())?
                .click()
                .map_err(|e| e.to_string())?;
            eprintln!("[browser_client] click done selector={}", selector);
            Ok(format!("Clicked element: {}", selector))
        }

        "type" | "input" | "fill" => {
            maybe_navigate(&tab, &url)?;
            let selector = str_arg(obj, &["selector", "element", "css"]);
            let text = str_arg(obj, &["text", "content", "value", "input"]);
            if selector.is_empty() {
                return Err("missing selector for input".to_string());
            }
            if text.is_empty() {
                return Err("missing text for input".to_string());
            }
            eprintln!(
                "[browser_client] type selector={} chars={}",
                selector,
                text.chars().count()
            );
            tab.wait_for_element(&selector)
                .map_err(|e| e.to_string())?
                .click()
                .map_err(|e| e.to_string())?;
            tab.type_str(&text).map_err(|e| e.to_string())?;
            eprintln!("[browser_client] type done selector={}", selector);
            Ok(format!("Input text to: {}", selector))
        }

        "screenshot" => {
            maybe_navigate(&tab, &url)?;
            eprintln!("[browser_client] screenshot start");
            let png = tab
                .capture_screenshot(CaptureScreenshotFormatOption::Png, None, None, true)
                .map_err(|e| e.to_string())?;
            eprintln!("[browser_client] screenshot done bytes={}", png.len());
            Ok(format!("Screenshot captured: {} bytes", png.len()))
        }

        "html" | "content" | "page_source" => {
            maybe_navigate(&tab, &url)?;
            eprintln!("[browser_client] html start");
            let html = tab.get_content().map_err(|e| e.to_string())?;
            eprintln!("[browser_client] html done chars={}", html.len());
            Ok(truncate_html(html))
        }

        "text" | "get_text" => {
            maybe_navigate(&tab, &url)?;
            let mut selector = str_arg(obj, &["selector", "element", "css"]);
            if selector.is_empty() {
                selector = "body".to_string();
            }
            eprintln!("[browser_client] text selector={}", selector);
            let text = tab
                .wait_for_element(&selector)
                .map_err(|e| e.to_string())?
                .get_inner_text()
                .map_err(|e| e.to_string())?;
            eprintln!("[browser_client] text done chars={}", text.chars().count());
            Ok(text)
        }

        "scroll" => {
            maybe_navigate(&tab, &url)?;
            let selector = str_arg(obj, &["selector", "element", "css"]);
            let y = str_arg(obj, &["y", "scroll_y", "pixels"]);
            eprintln!(
                "[browser_client] scroll selector={} y={}",
                if selector.is_empty() { "(none)" } else { &selector },
                if y.is_empty() { "(default)" } else { &y }
            );
            if !selector.is_empty() {
                tab.wait_for_element(&selector)
                    .map_err(|e| e.to_string())?
                    .scroll_into_view()
                    .map_err(|e| e.to_string())?;
            } else if !y.is_empty() {
                let dy: i32 = y
                    .parse()
                    .map_err(|_| "invalid y: expected integer pixels".to_string())?;
                tab.evaluate(&format!("window.scrollBy(0, {dy})"), false)
                    .map_err(|e| e.to_string())?;
            } else {
                tab.evaluate("window.scrollBy(0, 500)", false)
                    .map_err(|e| e.to_string())?;
            }
            Ok("Scrolled successfully".to_string())
        }

        "wait" => {
            maybe_navigate(&tab, &url)?;
            let selector = str_arg(obj, &["selector", "element", "css"]);
            let visible = str_arg(obj, &["visible", "wait_for"]);
            eprintln!(
                "[browser_client] wait selector={} visible={}",
                if selector.is_empty() { "(none)" } else { &selector },
                if visible.is_empty() { "(none)" } else { &visible }
            );
            if !selector.is_empty() {
                tab.wait_until_visible(&selector)
                    .map_err(|e| e.to_string())?;
                return Ok(format!("Element {} is visible", selector));
            }
            if !visible.is_empty() {
                std::thread::sleep(Duration::from_secs(2));
                return Ok("Waited for 2 seconds".to_string());
            }
            Err("missing selector or visible parameter".to_string())
        }

        "submit" => {
            maybe_navigate(&tab, &url)?;
            let mut selector = str_arg(obj, &["selector", "element", "css"]);
            if selector.is_empty() {
                selector = "form".to_string();
            }
            eprintln!("[browser_client] submit selector={}", selector);
            let sel = serde_json::to_string(&selector).map_err(|e| e.to_string())?;
            let js = format!(
                "(() => {{ const root = document.querySelector({}); if (!root) throw 'element not found'; const f = root.tagName === 'FORM' ? root : root.closest('form'); if (!f) throw 'no form'; f.submit(); }})()",
                sel
            );
            tab.evaluate(&js, false).map_err(|e| e.to_string())?;
            Ok(format!("Form submitted: {}", selector))
        }

        "evaluate" | "eval" | "js" => {
            maybe_navigate(&tab, &url)?;
            let js_code = str_arg(obj, &["js", "code", "script"]);
            if js_code.is_empty() {
                return Err("missing js code".to_string());
            }
            eprintln!("[browser_client] evaluate chars={}", js_code.chars().count());
            let r = tab.evaluate(&js_code, false).map_err(|e| e.to_string())?;
            eprintln!("[browser_client] evaluate done");
            Ok(remote_object_to_string(r))
        }

        _ => Err(format!(
            "unsupported operation: {} (supported: goto, click, type, screenshot, html, text, scroll, wait, submit, evaluate, close)",
            op
        )),
    }
}
