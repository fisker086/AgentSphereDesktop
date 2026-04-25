//! Built-in **`builtin_browser`**: drives a **visible** Chrome/Chromium window (`headless: false`) via DevTools.
//! User sees navigation, clicks, typing, etc. Page text/HTML is returned to the model for summarization.
//!
//! Tauri IPC: `run_client_browser` / `check_agent_browser` (matches `builtin_*` → `run_client_*` in the frontend).

use headless_chrome::browser::default_executable;
use headless_chrome::protocol::cdp::Page;
use headless_chrome::Browser;
use regex::Regex;
use serde_json::Value;
use std::thread;
use std::time::Duration;

use crate::chrome_session::{
    chrome_user_data_dir_from_env, close_browser_session, shared_headed_browser,
};

const MAX_TEXT_CHARS: usize = 120_000;
/// Default pause after `navigate_to` before reading DOM (slow SPAs may need more — use `nav_wait_ms`).
const DEFAULT_NAV_WAIT_MS: u64 = 8000;

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

fn validate_nav_url(url: &str) -> Result<(), String> {
    let u = url.trim();
    if u.is_empty() {
        return Err("missing url".to_string());
    }
    let lower = u.to_ascii_lowercase();
    if lower.starts_with("https://") {
        return Ok(());
    }
    if lower.starts_with("http://127.0.0.1")
        || lower.starts_with("http://localhost")
        || lower.starts_with("http://[::1]")
    {
        return Ok(());
    }
    if lower.starts_with("http://") {
        return Err("only https:// or http on 127.0.0.1/localhost/[::1]".to_string());
    }
    if lower.starts_with("file:") || lower.starts_with("javascript:") {
        return Err("blocked URL scheme".to_string());
    }
    Err("URL must start with https:// or allowed loopback http".to_string())
}

fn html_to_visible_text(html: &str) -> String {
    let script = Regex::new(r"(?is)<script[^>]*>.*?</script>").unwrap();
    let style = Regex::new(r"(?is)<style[^>]*>.*?</style>").unwrap();
    let noscript = Regex::new(r"(?is)<noscript[^>]*>.*?</noscript>").unwrap();
    let tags = Regex::new(r"<[^>]+>").unwrap();
    let mut s = script.replace_all(html, "").to_string();
    s = style.replace_all(&s, "").to_string();
    s = noscript.replace_all(&s, "").to_string();
    s = tags.replace_all(&s, " ").to_string();
    s = s
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"");
    let ws = Regex::new(r"\s+").unwrap();
    ws.replace_all(s.trim(), " ").to_string()
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out = String::with_capacity(max + 64);
    for (i, ch) in s.chars().enumerate() {
        if i >= max {
            break;
        }
        out.push(ch);
    }
    out.push_str("\n\n[truncated for model context]");
    out
}

fn log_info(msg: &str) {
    eprintln!("[builtin_browser] {}", msg);
}
fn log_err(msg: &str) {
    eprintln!("[builtin_browser] ERROR: {}", msg);
}

fn map_err(e: impl std::fmt::Display) -> String {
    let s = e.to_string();
    log_err(&s);
    // headless_chrome::util::Timeout — strict_until / until() exceeded default timeout
    if s.contains("The event waited for never came") {
        return format!(
            "{s}\n\
            Hint: Chrome automation timed out waiting (often: selector not found/wrong, element in shadow DOM, page still loading, or SPA never reached idle). \
            Defaults: timeout_ms≈120s, nav_wait_ms≈8s. Retry with \"timeout_ms\":180000 (max), \"nav_wait_ms\":15000–30000 after slow SPAs, \
            or operation \"wait\" with higher \"milliseconds\" before click; use a simpler CSS selector; ensure https / allowed loopback URL only."
        );
    }
    s
}

fn u64_from_obj_clamped(
    obj: &serde_json::Map<String, Value>,
    keys: &[&str],
    default: u64,
    min: u64,
    max: u64,
) -> u64 {
    for k in keys {
        if let Some(v) = obj.get(*k) {
            let n = v.as_u64().or_else(|| v.as_i64().map(|i| i.max(0) as u64));
            if let Some(n) = n {
                return n.clamp(min, max);
            }
        }
    }
    default.clamp(min, max)
}

/// `wait_for_element` / similar waits (headless_chrome default is 20s; we raise cap via this).
fn tab_timeout_from_obj(obj: &serde_json::Map<String, Value>) -> Duration {
    let ms = u64_from_obj_clamped(
        obj,
        &["timeout_ms", "element_timeout_ms", "wait_timeout_ms"],
        120_000,
        5_000,
        180_000,
    );
    Duration::from_millis(ms)
}

/// Pause after `navigate_to` before reading title/DOM (slow networks / SPAs).
fn nav_wait_ms_from_obj(obj: &serde_json::Map<String, Value>) -> u64 {
    u64_from_obj_clamped(
        obj,
        &["nav_wait_ms", "post_navigate_wait_ms", "after_navigate_ms"],
        DEFAULT_NAV_WAIT_MS,
        0,
        60_000,
    )
}

/// Picked tab + configurable default timeout for `wait_for_element` / navigation waits on slow pages.
fn prepare_tab(
    browser: &Browser,
    default_timeout: Duration,
) -> Result<std::sync::Arc<headless_chrome::Tab>, String> {
    let tab = primary_tab(browser)?;
    tab.set_default_timeout(default_timeout);
    Ok(tab)
}

/// Skip DevTools internal targets; keep automation on normal page tabs only.
fn is_normal_page_tab(tab: &headless_chrome::Tab) -> bool {
    let url = tab.get_url();
    !url.starts_with("devtools://")
}

/// Prefer one stable tab for all operations (no extra tab per action):
/// 1) Wait for Chrome’s initial tab to register (avoids racing `new_tab()` and duplicating tabs).
/// 2) If multiple page tabs exist, prefer one that already has a real URL over `about:blank` / `chrome://newtab`.
fn primary_tab(browser: &Browser) -> Result<std::sync::Arc<headless_chrome::Tab>, String> {
    browser.register_missing_tabs();

    let pick = |tabs: &[std::sync::Arc<headless_chrome::Tab>]| -> Option<std::sync::Arc<headless_chrome::Tab>> {
        let pages: Vec<_> = tabs.iter().filter(|t| is_normal_page_tab(t)).cloned().collect();
        if pages.is_empty() {
            return None;
        }
        if let Some(t) = pages.iter().find(|t| {
            let u = t.get_url();
            !u.starts_with("about:") && !u.starts_with("chrome://newtab")
        }) {
            return Some(t.clone());
        }
        pages.first().cloned()
    };

    // Cold Chrome startup can exceed 10s on some machines.
    let deadline = std::time::Instant::now() + Duration::from_secs(25);
    loop {
        let tabs = browser.get_tabs().lock().map_err(map_err)?;
        if let Some(t) = pick(&tabs) {
            drop(tabs);
            let _ = t.bring_to_front();
            return Ok(t);
        }
        drop(tabs);
        if std::time::Instant::now() > deadline {
            break;
        }
        thread::sleep(Duration::from_millis(80));
        browser.register_missing_tabs();
    }

    browser.register_missing_tabs();
    let tabs = browser.get_tabs().lock().map_err(map_err)?;
    if let Some(t) = pick(&tabs) {
        drop(tabs);
        let _ = t.bring_to_front();
        return Ok(t);
    }
    drop(tabs);

    // Truly no page tab (rare): create the only tab.
    let t = browser.new_tab().map_err(map_err)?;
    let _ = t.bring_to_front();
    Ok(t)
}

fn page_text_for_model(tab: &headless_chrome::Tab) -> Result<String, String> {
    let html = tab.get_content().map_err(map_err)?;
    let text = html_to_visible_text(&html);
    let text = if text.is_empty() {
        "(little or no static text; page may be JS-heavy — try wait + text again)".to_string()
    } else {
        text
    };
    Ok(truncate_chars(&text, MAX_TEXT_CHARS))
}

fn fill_input_via_js(tab: &headless_chrome::Tab, selector: &str, text: &str) -> Result<(), String> {
    let selector_json = serde_json::to_string(selector).map_err(map_err)?;
    let text_json = serde_json::to_string(text).map_err(map_err)?;
    let js = format!(
        r#"(function() {{
            const el = document.querySelector({selector});
            if (!el) {{
                throw new Error("selector not found for type fallback");
            }}
            if (typeof el.focus === "function") el.focus();
            if (typeof el.select === "function") {{
                try {{ el.select(); }} catch (_e) {{}}
            }}
            el.value = {text};
            el.dispatchEvent(new Event("input", {{ bubbles: true }}));
            el.dispatchEvent(new Event("change", {{ bubbles: true }}));
            return {{
                ok: true,
                tag: el.tagName,
                type: el.type || ""
            }};
        }})()"#,
        selector = selector_json,
        text = text_json
    );
    tab.evaluate(&js, true).map_err(map_err)?;
    Ok(())
}

fn type_into_with_fallback(
    tab: &headless_chrome::Tab,
    selector: &str,
    text: &str,
) -> Result<&'static str, String> {
    let el = tab.wait_for_element(selector).map_err(map_err)?;
    match el.type_into(text) {
        Ok(_) => Ok("keyboard"),
        Err(err) => {
            let raw = err.to_string();
            log_err(&raw);
            if raw.contains("The event waited for never came") {
                fill_input_via_js(tab, selector, text)?;
                log_info(&format!(
                    "type fallback via JS succeeded for selector: {}",
                    selector
                ));
                Ok("js_fallback")
            } else {
                Err(map_err(raw))
            }
        }
    }
}

#[tauri::command]
pub fn check_agent_browser() -> Result<String, String> {
    let exe = default_executable()?;
    let profile_hint = match chrome_user_data_dir_from_env() {
        Some(d) => {
            format!(" Persistent profile: {} (close other Chrome using this folder first).", d.trim())
        }
        _ => " No persistent profile (temp dir each run — logins not kept). Set AITASKMETA_CHROME_USER_DATA_DIR (or legacy AGENTSPHERE_CHROME_USER_DATA_DIR) to reuse a profile.".to_string(),
    };
    Ok(format!(
        "headed Chrome automation: OK (executable: {}). First tool call opens a visible window.{} \
         Flags: no --enable-automation, no --ignore-certificate-errors (normal TLS). \
         Saved-password autofill needs a persistent profile dir (env AITASKMETA_CHROME_USER_DATA_DIR or AGENTSPHERE_CHROME_USER_DATA_DIR) or log in each session.",
        exe.display(),
        profile_hint
    ))
}

#[tauri::command]
pub async fn run_client_browser(params: Value) -> Result<String, String> {
    log_info(&format!("Received params: {:?}", params));

    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let op = str_arg(obj, &["operation", "op", "action"]);
    if op.is_empty() {
        return Err(
            "missing operation (e.g. open, goto, click, text, html, screenshot, close)".to_string(),
        );
    }
    log_info(&format!("Executing operation: {}", op));

    // ASCII ops lowercased; Chinese aliases kept as-is for match arms below.
    let op = op.to_ascii_lowercase();

    let url = str_arg(obj, &["url", "target"]);
    let selector = str_arg(obj, &["selector", "css", "element"]);
    let text = str_arg(obj, &["text", "content", "value"]);
    let js = str_arg(obj, &["js", "code", "script"]);
    let path = str_arg(obj, &["path", "file"]);

    let tab_timeout = tab_timeout_from_obj(obj);
    let nav_wait_ms = nav_wait_ms_from_obj(obj);
    let key_field = str_arg(obj, &["key", "keys", "k"]);
    let wait_secs = obj
        .get("seconds")
        .and_then(|v| v.as_u64())
        .or_else(|| {
            obj.get("seconds")
                .and_then(|v| v.as_i64())
                .map(|n| n as u64)
        })
        .unwrap_or(2);
    let wait_ms = obj
        .get("milliseconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(wait_secs.saturating_mul(1000));

    let result = tokio::task::spawn_blocking(move || {
        log_info(&format!("Starting operation: {}", op));

        match op.as_str() {
            "open" | "goto" | "visit" | "fetch" | "get" | "content" | "navigate" => {
                if url.is_empty() {
                    return Err("missing url".to_string());
                }
                log_info(&format!("Navigating to: {}", url));
                validate_nav_url(&url)?;
                let browser = shared_headed_browser()?;
                log_info("Browser acquired, preparing tab");
                let tab = prepare_tab(&browser, tab_timeout)?;
                tab.navigate_to(&url).map_err(map_err)?;
                thread::sleep(Duration::from_millis(nav_wait_ms));
                let title = tab.get_title().map_err(map_err)?;
                let body = page_text_for_model(&tab)?;
                Ok(format!(
                    "[headed Chrome — visible window]\nStep: navigate\nURL: {}\nTitle: {}\n\n--- extracted text for model ---\n\n{}",
                    url, title, body
                ))
            }

        "text" => {
            let browser = shared_headed_browser()?;
            let tab = prepare_tab(&browser, tab_timeout)?;
            if !url.is_empty() {
                validate_nav_url(&url)?;
                tab.navigate_to(&url).map_err(map_err)?;
                thread::sleep(Duration::from_millis(nav_wait_ms));
            }
            if !selector.is_empty() {
                let el = tab.wait_for_element(&selector).map_err(map_err)?;
                let t = el.get_inner_text().map_err(map_err)?;
                return Ok(format!(
                    "[headed Chrome — visible]\nStep: text on selector\nSelector: {}\n\n{}",
                    selector,
                    truncate_chars(&t, MAX_TEXT_CHARS)
                ));
            }
            let title = tab.get_title().map_err(map_err)?;
            let body = page_text_for_model(&tab)?;
            Ok(format!(
                "[headed Chrome — visible]\nStep: full page text\nTitle: {}\n\n{}",
                title, body
            ))
        }

        "html" => {
            let browser = shared_headed_browser()?;
            let tab = prepare_tab(&browser, tab_timeout)?;
            if !url.is_empty() {
                validate_nav_url(&url)?;
                tab.navigate_to(&url).map_err(map_err)?;
                thread::sleep(Duration::from_millis(nav_wait_ms));
            }
            let raw = tab.get_content().map_err(map_err)?;
            Ok(truncate_chars(&raw, MAX_TEXT_CHARS))
        }

        "click" => {
            if selector.is_empty() {
                return Err("missing selector".to_string());
            }
            let browser = shared_headed_browser()?;
            let tab = prepare_tab(&browser, tab_timeout)?;
            tab.wait_for_element(&selector)
                .map_err(map_err)?
                .click()
                .map_err(map_err)?;
            thread::sleep(Duration::from_millis(nav_wait_ms));
            let title = tab.get_title().map_err(map_err)?;
            let body = page_text_for_model(&tab)?;
            Ok(format!(
                "[headed Chrome — visible]\nStep: click\nSelector: {}\n\nTitle: {}\n--- extracted text for model ---\n\n{}",
                selector, title, body
            ))
        }

        "dblclick" => {
            if selector.is_empty() {
                return Err("missing selector".to_string());
            }
            let browser = shared_headed_browser()?;
            let tab = prepare_tab(&browser, tab_timeout)?;
            let el = tab.wait_for_element(&selector).map_err(map_err)?;
            el.click().map_err(map_err)?;
            thread::sleep(Duration::from_millis(120));
            el.click().map_err(map_err)?;
            Ok(format!(
                "[headed Chrome — visible]\nStep: double-click\nSelector: {}\nDone.",
                selector
            ))
        }

        "type" | "input" | "fill" => {
            if selector.is_empty() || text.is_empty() {
                return Err("missing selector or text".to_string());
            }
            let browser = shared_headed_browser()?;
            let tab = prepare_tab(&browser, tab_timeout)?;
            let method = type_into_with_fallback(&tab, &selector, &text)?;
            thread::sleep(Duration::from_millis(nav_wait_ms));
            let title = tab.get_title().map_err(map_err)?;
            let body = page_text_for_model(&tab)?;
            Ok(format!(
                "[headed Chrome — visible]\nStep: type into\nSelector: {}\nMethod: {}\n\nTitle: {}\n--- extracted text for model ---\n\n{}",
                selector, method, title, body
            ))
        }

        "press" => {
            let k = if key_field.is_empty() { text } else { key_field };
            if k.is_empty() {
                return Err("missing key (field key or text)".to_string());
            }
            let browser = shared_headed_browser()?;
            let tab = prepare_tab(&browser, tab_timeout)?;
            tab.press_key(&k).map_err(map_err)?;
            thread::sleep(Duration::from_millis(nav_wait_ms));
            let title = tab.get_title().map_err(map_err)?;
            let body = page_text_for_model(&tab)?;
            Ok(format!(
                "[headed Chrome — visible]\nStep: press key\nKey: {}\n\nTitle: {}\n--- extracted text for model ---\n\n{}",
                k, title, body
            ))
        }

        "submit" | "submit-form" => {
            if selector.is_empty() {
                return Err("missing selector (form or submit button)".to_string());
            }
            let browser = shared_headed_browser()?;
            let tab = prepare_tab(&browser, tab_timeout)?;
            let el = tab.wait_for_element(&selector).map_err(map_err)?;
            el.click().map_err(map_err)?;
            thread::sleep(Duration::from_millis(nav_wait_ms));
            let title = tab.get_title().map_err(map_err)?;
            let body = page_text_for_model(&tab)?;
            Ok(format!(
                "[headed Chrome — visible]\nStep: submit\nSelector: {}\n\nTitle: {}\n--- extracted text for model ---\n\n{}",
                selector, title, body
            ))
        }

        "screenshot" => {
            let browser = shared_headed_browser()?;
            let tab = prepare_tab(&browser, tab_timeout)?;
            let png = tab
                .capture_screenshot(
                    Page::CaptureScreenshotFormatOption::Png,
                    None,
                    None,
                    true,
                )
                .map_err(map_err)?;
            if !path.is_empty() {
                std::fs::write(&path, &png).map_err(map_err)?;
                return Ok(format!(
                    "[headed Chrome — visible]\nScreenshot saved: {} ({} bytes)",
                    path,
                    png.len()
                ));
            }
            use base64::{engine::general_purpose::STANDARD, Engine as _};
            let b64 = STANDARD.encode(&png);
            let preview = if b64.len() > 8000 {
                format!("{}… [base64 truncated, {} bytes total]", &b64[..8000], b64.len())
            } else {
                b64
            };
            Ok(format!(
                "[headed Chrome — visible]\nPNG base64 (for vision models or save manually):\n{}",
                preview
            ))
        }

        "scroll" => {
            if selector.is_empty() {
                return Err("missing selector".to_string());
            }
            let browser = shared_headed_browser()?;
            let tab = prepare_tab(&browser, tab_timeout)?;
            tab.wait_for_element(&selector)
                .map_err(map_err)?
                .scroll_into_view()
                .map_err(map_err)?;
            Ok(format!(
                "[headed Chrome — visible]\nScrolled to selector: {}",
                selector
            ))
        }

        "wait" => {
            thread::sleep(Duration::from_millis(wait_ms.min(120_000)));
            Ok(format!(
                "[headed Chrome — visible]\nWaited {} ms (visible pause)",
                wait_ms
            ))
        }

        "eval" | "evaluate" | "js" => {
            if js.is_empty() {
                return Err("missing js".to_string());
            }
            let browser = shared_headed_browser()?;
            let tab = prepare_tab(&browser, tab_timeout)?;
            let r = tab.evaluate(&js, true).map_err(map_err)?;
            Ok(format!(
                "[headed Chrome — visible]\nJS result: {:?}",
                r.value
            ))
        }

        "reload" => {
            let browser = shared_headed_browser()?;
            let tab = prepare_tab(&browser, tab_timeout)?;
            tab.reload(false, None).map_err(map_err)?;
            thread::sleep(Duration::from_millis(800));
            Ok("[headed Chrome — visible]\nReloaded current tab.".to_string())
        }

        "back" => {
            let browser = shared_headed_browser()?;
            let tab = prepare_tab(&browser, tab_timeout)?;
            tab.evaluate("history.back()", true).map_err(map_err)?;
            thread::sleep(Duration::from_millis(600));
            Ok("[headed Chrome — visible]\nHistory back.".to_string())
        }

        "close" | "quit" | "shutdown" | "exit" | "关闭" | "关闭浏览器" | "结束" | "退出" => {
            let closed = close_browser_session()?;
            if closed {
                Ok("Visible Chrome session closed (process stopped).".to_string())
            } else {
                Ok("No Chrome session was active (nothing to close).".to_string())
            }
        }

        _ => Err(format!(
            "unsupported operation: {}. Try: open/goto, text, html, click, type, press, screenshot, scroll, wait, eval, reload, back, close.",
            op
        )),
    }
    });
    result.await.map_err(|e| e.to_string())?
}
