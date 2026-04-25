//! Local Cisco IOS network device client (aligned with skills/cisco/SKILL.md).

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
        "show_vlan",
        "show_interfaces",
        "show_interface_status",
        "show_interface_trunk",
        "show_mac_address_table",
        "show_spanning_tree",
        "show_spanning_tree_detail",
        "show_ip_route",
        "show_ip_route_detail",
        "show_ip_ospf",
        "show_ip_ospf_neighbor",
        "show_ip_ospf_interface",
        "show_ip_ospf_database",
        "show_ip_bgp",
        "show_ip_bgp_neighbors",
        "show_ip_bgp_routing_table",
        "show_ip_eigrp_protocols",
        "show_ip_eigrp_neighbors",
        "show_ip_eigrp_topology",
        "show_ip_rip_database",
        "show_ip_nat_translations",
        "show_ip_nat_statistics",
        "show_access_lists",
        "show_ip_cef",
        "show_ip_cef_detail",
        "show_failover",
        "show_version",
        "show_inventory",
        "show_power",
        "show_environment",
        "show_cpu",
        "show_memory",
        "show_clock",
        "show_license",
        "show_vtp_status",
        "show_port_channel_summary",
        "show_cdp_neighbors",
        "show_cdp_neighbors_detail",
    ];
    ops.into_iter().collect()
}

fn build_command(op: &str) -> String {
    match op {
        "show_vlan" => "show vlan".to_string(),
        "show_interfaces" => "show interfaces".to_string(),
        "show_interface_status" => "show interface status".to_string(),
        "show_interface_trunk" => "show interface trunk".to_string(),
        "show_mac_address_table" => "show mac address-table".to_string(),
        "show_spanning_tree" => "show spanning-tree brief".to_string(),
        "show_spanning_tree_detail" => "show spanning-tree detail".to_string(),
        "show_ip_route" => "show ip route".to_string(),
        "show_ip_route_detail" => "show ip route detail".to_string(),
        "show_ip_ospf" => "show ip ospf".to_string(),
        "show_ip_ospf_neighbor" => "show ip ospf neighbor".to_string(),
        "show_ip_ospf_interface" => "show ip ospf interface".to_string(),
        "show_ip_ospf_database" => "show ip ospf database".to_string(),
        "show_ip_bgp" => "show ip bgp".to_string(),
        "show_ip_bgp_neighbors" => "show ip bgp neighbors".to_string(),
        "show_ip_bgp_routing_table" => "show ip bgp routing-table".to_string(),
        "show_ip_eigrp_protocols" => "show ip eigrp protocols".to_string(),
        "show_ip_eigrp_neighbors" => "show ip eigrp neighbors".to_string(),
        "show_ip_eigrp_topology" => "show ip eigrp topology".to_string(),
        "show_ip_rip_database" => "show ip rip database".to_string(),
        "show_ip_nat_translations" => "show ip nat translations".to_string(),
        "show_ip_nat_statistics" => "show ip nat statistics".to_string(),
        "show_access_lists" => "show access-lists".to_string(),
        "show_ip_cef" => "show ip cef".to_string(),
        "show_ip_cef_detail" => "show ip cef detail".to_string(),
        "show_failover" => "show failover".to_string(),
        "show_version" => "show version".to_string(),
        "show_inventory" => "show inventory".to_string(),
        "show_power" => "show power".to_string(),
        "show_environment" => "show environment all".to_string(),
        "show_cpu" => "show cpu".to_string(),
        "show_memory" => "show memory".to_string(),
        "show_clock" => "show clock".to_string(),
        "show_license" => "show license".to_string(),
        "show_vtp_status" => "show vtp status".to_string(),
        "show_port_channel_summary" => "show port-channel summary".to_string(),
        "show_cdp_neighbors" => "show cdp neighbors".to_string(),
        "show_cdp_neighbors_detail" => "show cdp neighbors detail".to_string(),
        _ => op.to_string(),
    }
}

#[tauri::command]
pub fn run_client_cisco_ios(params: Value) -> Result<String, String> {
    eprintln!("[cisco_ios] invoked");

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

    eprintln!("[cisco_ios] {}@{}: {}", user, host, cmd_str);

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
        return Ok(format!("Cisco IOS {}: no output", host));
    }

    eprintln!("[cisco_ios] done, output_len={}", result.len());
    Ok(format!("Cisco IOS {} [{}]:\n\n{}", host, op, result))
}
