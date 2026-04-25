//! Local certificate checker operations (aligned with internal/skills/cert_checker.go).

use native_tls::TlsConnector;
use serde_json::Value;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

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

/// Local certificate checker: check SSL/TLS certificate expiry, issuer, and chain.
#[tauri::command]
pub fn run_client_cert_checker(params: Value) -> Result<String, String> {
    eprintln!("[cert_checker_client] run_client_cert_checker invoked");

    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let mut domain = str_arg(obj, &["domain", "host", "url", "address"]);
    if domain.is_empty() {
        return Err("missing domain".to_string());
    }

    // Strip protocol prefix
    domain = domain
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or(&domain)
        .to_string();

    let port = str_arg(obj, &["port", "p"]);
    let port = if port.is_empty() { "443" } else { &port };

    let addr = format!("{}:{}", domain, port);

    // Connect with TLS
    let connector = TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()
        .map_err(|e| format!("failed to build TLS connector: {}", e))?;

    let stream =
        TcpStream::connect(&addr).map_err(|e| format!("failed to connect to {}: {}", addr, e))?;
    stream.set_read_timeout(Some(Duration::from_secs(10))).ok();

    let tls_stream = connector
        .connect(domain.as_str(), stream)
        .map_err(|e| format!("TLS handshake failed: {}", e))?;

    // Get peer certificates
    let certs = tls_stream
        .peer_certificates()
        .ok_or_else(|| format!("No certificates found for {}", addr))?;

    if certs.is_empty() {
        return Ok(format!("No certificates found for {}", addr));
    }

    let cert = &certs[0];
    let now = std::time::SystemTime::now();
    let not_after = cert.not_after();
    let days_until_expiry = match not_after.duration_since(now) {
        Ok(d) => d.as_secs() as f64 / 86400.0,
        Err(_) => -(now.duration_since(not_after).unwrap().as_secs() as f64 / 86400.0),
    };

    let mut result = format!("=== Certificate Info for {} ===\n\n", domain);
    result.push_str(&format!("Subject: {}\n", cert.subject().common_name()));
    result.push_str(&format!("Issuer: {}\n", cert.issuer().common_name()));
    result.push_str(&format!("Valid From: {}\n", cert.not_before()));
    result.push_str(&format!("Valid Until: {}\n", not_after));

    if days_until_expiry < 0.0 {
        result.push_str(&format!(
            "Status: EXPIRED ({:.0} days ago)\n",
            -days_until_expiry
        ));
    } else if days_until_expiry < 30.0 {
        result.push_str(&format!(
            "Status: WARNING - expiring in {:.0} days\n",
            days_until_expiry
        ));
    } else {
        result.push_str(&format!(
            "Status: OK ({:.0} days remaining)\n",
            days_until_expiry
        ));
    }

    if certs.len() > 1 {
        result.push_str(&format!(
            "\nCertificate Chain ({} certificates):\n",
            certs.len()
        ));
        for (i, c) in certs.iter().enumerate().skip(1) {
            result.push_str(&format!(
                "  {}. {} (expires: {})\n",
                i,
                c.subject().common_name(),
                c.not_after()
            ));
        }
    }

    Ok(result)
}
