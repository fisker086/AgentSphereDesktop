//! Local H3C network device client (aligned with skills/h3c_switch/SKILL.md).

use serde_json::Value;
use std::collections::HashSet;
use std::process::Command;

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

fn allowed_ops() -> HashSet<&'static str> {
    let ops = [
        "display_vlan",
        "display_interface",
        "display_version",
        "display_ip_route",
        "display_ip_route_verbose",
        "display_arp",
        "display_mac_address",
        "display_stp",
        "display_power",
        "display_fan",
        "display_temperature",
        "display_cpu",
        "display_memory",
        "display_device",
        "display_ospf_neighbor",
        "display_ospf_interface",
        "display_ospf_lsdb",
        "display_bgp_peer",
        "display_bgp_routing_table",
        "display_rip_neighbor",
        "display_rip_route",
        "display_fib",
        "display_routing_table_statistics",
        "display_bfd_session",
        "display_clock",
        "display_qos",
        "display_link_aggregation",
        "display_port_isolate",
        "display_nat_session",
        "display_nat_server",
        "display_acl_all",
    ];
    ops.into_iter().collect()
}

fn build_command(op: &str) -> String {
    match op {
        "display_vlan" => "display vlan".to_string(),
        "display_interface" => "display interface brief".to_string(),
        "display_version" => "display version".to_string(),
        "display_ip_route" => "display ip routing-table".to_string(),
        "display_ip_route_verbose" => "display ip routing-table verbose".to_string(),
        "display_arp" => "display arp".to_string(),
        "display_mac_address" => "display mac-address".to_string(),
        "display_stp" => "display stp brief".to_string(),
        "display_power" => "display power".to_string(),
        "display_fan" => "display fan".to_string(),
        "display_temperature" => "display temperature".to_string(),
        "display_cpu" => "display cpu".to_string(),
        "display_memory" => "display memory".to_string(),
        "display_device" => "display device".to_string(),
        "display_ospf_neighbor" => "display ospf peer".to_string(),
        "display_ospf_interface" => "display ospf interface".to_string(),
        "display_ospf_lsdb" => "display ospf lsdb".to_string(),
        "display_bgp_peer" => "display bgp peer".to_string(),
        "display_bgp_routing_table" => "display bgp routing-table".to_string(),
        "display_rip_neighbor" => "display rip neighbor".to_string(),
        "display_rip_route" => "display rip route".to_string(),
        "display_fib" => "display fib".to_string(),
        "display_routing_table_statistics" => "display routing-table statistics".to_string(),
        "display_bfd_session" => "display bfd session".to_string(),
        "display_clock" => "display clock".to_string(),
        "display_qos" => "display qos policy".to_string(),
        "display_link_aggregation" => "display link-aggregation verbose".to_string(),
        "display_port_isolate" => "display port-isolate group".to_string(),
        "display_nat_session" => "display nat session".to_string(),
        "display_nat_server" => "display nat server".to_string(),
        "display_acl_all" => "display acl all".to_string(),
        _ => op.to_string(),
    }
}

#[tauri::command]
pub fn run_client_h3c_switch(params: Value) -> Result<String, String> {
    eprintln!("[h3c_switch] invoked");

    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let op = str_arg(obj, &["operation", "op", "action"]);
    let host = str_arg(obj, &["host", "address", "ip"]);
    let port = str_arg(obj, &["port", "ssh_port"]);
    let user = str_arg(obj, &["user", "username"]);
    let password = str_arg(obj, &["password", "pass"]);
    let custom_cmd = str_arg(obj, &["command", "cmd"]);

    if op.is_empty() {
        return Err("missing operation".to_string());
    }
    if host.is_empty() {
        return Err("missing host".to_string());
    }

    let port = if port.is_empty() {
        "22".to_string()
    } else {
        port
    };
    let user = if user.is_empty() {
        "admin".to_string()
    } else {
        user
    };
    let cmd_str = if custom_cmd.is_empty() {
        build_command(&op)
    } else {
        custom_cmd
    };

    if !allowed_ops().contains(&op.as_str()) {
        return Err(format!("operation not allowed: {}", op));
    }

    eprintln!("[h3c_switch] {}@{}: {}", user, host, cmd_str);

    let output = if password.is_empty() {
        Command::new("ssh")
            .args([
                "-o",
                "StrictHostKeyChecking=no",
                "-o",
                "ConnectTimeout=10",
                "-p",
                &port,
                &format!("{}@{}", user, host),
                &cmd_str,
            ])
            .output()
            .map_err(|e| e.to_string())?
    } else {
        Command::new("sshpass")
            .args([
                "-p",
                &password,
                "ssh",
                "-o",
                "StrictHostKeyChecking=no",
                "-o",
                "ConnectTimeout=10",
                "-p",
                &port,
                &format!("{}@{}", user, host),
                &cmd_str,
            ])
            .output()
            .map_err(|e| e.to_string())?
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}{}", stdout, stderr);

    if !output.status.success() {
        return Err(format!("SSH failed: {}", combined));
    }

    let result = combined.trim();
    if result.is_empty() {
        return Ok(format!("H3C switch {}: no output", host));
    }

    eprintln!("[h3c_switch] done, output_len={}", result.len());
    Ok(format!("H3C switch {} [{}]:\n\n{}", host, op, result))
}
