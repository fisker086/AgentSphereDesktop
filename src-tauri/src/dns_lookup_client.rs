//! Local DNS lookup operations (aligned with internal/skills/dns_lookup.go).

use dns_lookup::Lookup;
use serde_json::Value;
use std::collections::HashMap;

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

fn allowed_dns_ops() -> HashMap<&'static str, bool> {
    [
        ("a", true),
        ("aaaa", true),
        ("cname", true),
        ("mx", true),
        ("txt", true),
        ("ns", true),
        ("soa", true),
        ("any", true),
    ]
    .into_iter()
    .collect()
}

/// Local DNS lookup: query A, AAAA, CNAME, MX, TXT, NS, SOA records.
#[tauri::command]
pub fn run_client_dns_lookup(params: Value) -> Result<String, String> {
    eprintln!("[dns_lookup_client] run_client_dns_lookup invoked");

    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let domain = str_arg(obj, &["domain", "host", "name", "address"]);
    if domain.is_empty() {
        return Err("missing domain".to_string());
    }

    let mut record_type = str_arg(obj, &["record_type", "type", "query_type"]);
    if record_type.is_empty() {
        record_type = "a".to_string();
    }

    let record_type = record_type.to_lowercase();

    if !allowed_dns_ops().contains_key(record_type.as_str()) {
        return Err(format!(
            "record type {:?} not allowed (allowed: a, aaaa, cname, mx, txt, ns, soa, any)",
            record_type
        ));
    }

    let mut result = String::new();
    result.push_str(&format!("DNS lookup for {} (type: {})\n\n", domain, record_type));

    match record_type.as_str() {
        "a" => {
            match Lookup::new().lookup_ip(domain.as_str()) {
                Ok(ips) => {
                    let ip_strs: Vec<String> = ips.iter().map(|ip| ip.to_string()).collect();
                    result.push_str(&format!("A records: {}\n", ip_strs.join(", ")));
                }
                Err(e) => result.push_str(&format!("A lookup failed: {}\n", e)),
            }
        }
        "aaaa" => {
            match Lookup::new().lookup_ip(domain.as_str()) {
                Ok(ips) => {
                    let ip_strs: Vec<String>> = ips.iter()
                        .filter(|ip| ip.is_ipv6())
                        .map(|ip| ip.to_string())
                        .collect();
                    result.push_str(&format!("AAAA records: {}\n", ip_strs.join(", ")));
                }
                Err(e) => result.push_str(&format!("AAAA lookup failed: {}\n", e)),
            }
        }
        "cname" => {
            result.push_str("(CNAME - not directly supported, use host command)\n");
            let output = std::process::Command::new("host")
                .arg("-t")
                .arg("CNAME")
                .arg(domain.as_str())
                .output();
            if let Ok(o) = output {
                result.push_str(&String::from_utf8_lossy(&o.stdout));
            }
        }
        "mx" => {
            let output = std::process::Command::new("host")
                .arg("-t")
                .arg("MX")
                .arg(domain.as_str())
                .output();
            if let Ok(o) = output {
                result.push_str(&String::from_utf8_lossy(&o.stdout));
            } else {
                result.push_str("MX lookup failed\n");
            }
        }
        "txt" => {
            let output = std::process::Command::new("host")
                .arg("-t")
                .arg("TXT")
                .arg(domain.as_str())
                .output();
            if let Ok(o) = output {
                result.push_str(&String::from_utf8_lossy(&o.stdout));
            } else {
                result.push_str("TXT lookup failed\n");
            }
        }
        "ns" => {
            let output = std::process::Command::new("host")
                .arg("-t")
                .arg("NS")
                .arg(domain.as_str())
                .output();
            if let Ok(o) = output {
                result.push_str(&String::from_utf8_lossy(&o.stdout));
            } else {
                result.push_str("NS lookup failed\n");
            }
        }
        "soa" => {
            let output = std::process::Command::new("host")
                .arg("-t")
                .arg("SOA")
                .arg(domain.as_str())
                .output();
            if let Ok(o) = output {
                result.push_str(&String::from_utf8_lossy(&o.stdout));
            } else {
                result.push_str("SOA lookup failed\n");
            }
        }
        "any" => {
            let output = std::process::Command::new("host")
                .arg("-a")
                .arg(domain.as_str())
                .output();
            if let Ok(o) = output {
                result.push_str(&String::from_utf8_lossy(&o.stdout));
            } else {
                result.push_str("ANY lookup failed\n");
            }
        }
        _ => return Err(format!("unknown DNS record type: {}", record_type)),
    }

    Ok(result.trim().to_string())
}