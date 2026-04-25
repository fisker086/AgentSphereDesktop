//! Smart contract read-only tools (aligned with `internal/skills/smart_contract.go`).

use num_bigint::BigUint;
use num_traits::Num;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::str::FromStr;

use super::ethereum_query::{ensure_0x, eth_call_rpc, eth_rpc_url, hex_to_biguint, str_arg};

fn pad_address(addr: &str) -> String {
    let a = addr.trim().trim_start_matches("0x");
    format!("{:0>64}", a)
}

fn decode_string_result(hex: &str) -> String {
    let h = hex.trim();
    if h.len() < 130 {
        return h.to_string();
    }
    let data = &h[130..];
    let mut bytes = Vec::new();
    let mut i = 0;
    while i + 1 < data.len() {
        if let Ok(b) = u8::from_str_radix(&data[i..i + 2], 16) {
            bytes.push(b);
        }
        i += 2;
    }
    let mut len = 0;
    for &b in &bytes {
        if b == 0 {
            break;
        }
        len += 1;
    }
    String::from_utf8_lossy(&bytes[..len]).into_owned()
}

fn token_id_word_hex(token_id: &str) -> Result<String, String> {
    let t = token_id.trim();
    let bi = if t.starts_with("0x") {
        BigUint::from_str_radix(t.trim_start_matches("0x"), 16)
            .map_err(|_| "invalid token_id hex".to_string())?
    } else {
        BigUint::from_str(t).map_err(|_| "invalid token_id".to_string())?
    };
    Ok(format!("{:064x}", bi))
}

static ERC20: &[(&str, &str)] = &[
    ("name", "0x06fdde03"),
    ("symbol", "0x95d89b41"),
    ("decimals", "0x313ce567"),
    ("totalSupply", "0x18160ddd"),
    ("balanceOf", "0x70a08231"),
    ("allowance", "0xdd62ed3e"),
];

fn erc20_selector(name: &str) -> Option<&'static str> {
    ERC20.iter().find(|(k, _)| *k == name).map(|(_, s)| *s)
}

pub fn exec_smart_contract(obj: &serde_json::Map<String, Value>) -> Result<String, String> {
    let op = str_arg(obj, &["operation", "op", "action", "command"]);
    let mut network = str_arg(obj, &["network", "net"]);
    if network.is_empty() {
        network = "mainnet".to_string();
    }
    let rpc_url = eth_rpc_url(network.as_str());
    let mut contract = str_arg(obj, &["contract_address", "contract", "addr"]);
    if contract.is_empty() {
        return Err("missing contract_address parameter".into());
    }
    contract = ensure_0x(&contract);

    match op.as_str() {
        "erc20_info" => {
            let mut results: HashMap<String, String> = HashMap::new();
            for field in ["name", "symbol", "decimals", "totalSupply"] {
                let data = erc20_selector(field).ok_or_else(|| "internal selector".to_string())?;
                let result = eth_call_rpc(
                    rpc_url,
                    "eth_call",
                    json!([{ "to": contract, "data": data }, "latest"]),
                )?;
                let hex_result = result.as_str().unwrap_or("0x");
                results.insert(field.to_string(), hex_result.to_string());
            }
            let name = decode_string_result(results.get("name").map(|s| s.as_str()).unwrap_or(""));
            let symbol = decode_string_result(results.get("symbol").map(|s| s.as_str()).unwrap_or(""));
            let decimals = hex_to_biguint(results.get("decimals").map(|s| s.as_str()).unwrap_or("0x"))
                .to_string()
                .parse::<u64>()
                .unwrap_or(0);
            let total_supply = hex_to_biguint(
                results
                    .get("totalSupply")
                    .map(|s| s.as_str())
                    .unwrap_or("0x"),
            );
            if decimals > 0 {
                let div = BigUint::from(10u32).pow(decimals as u32);
                let supply_int = &total_supply / &div;
                let remainder = &total_supply % &div;
                let width = decimals.min(18) as usize;
                let mut rem_s = remainder.to_string();
                while rem_s.len() < width {
                    rem_s.insert(0, '0');
                }
                if rem_s.len() > width {
                    rem_s.truncate(width);
                }
                Ok(format!(
                    "ERC20 Token Info:\n  Name: {}\n  Symbol: {}\n  Decimals: {}\n  Total Supply: {}.{}",
                    name, symbol, decimals, supply_int, rem_s
                ))
            } else {
                Ok(format!(
                    "ERC20 Token Info:\n  Name: {}\n  Symbol: {}\n  Decimals: {}\n  Total Supply: {}",
                    name, symbol, decimals, total_supply
                ))
            }
        }
        "erc20_balance" => {
            let mut address = str_arg(obj, &["address", "addr", "wallet"]);
            if address.is_empty() {
                return Err("missing address parameter for balance query".into());
            }
            address = ensure_0x(&address);
            let sel = erc20_selector("balanceOf").unwrap();
            let data = format!("{}{}", sel, pad_address(&address));
            let result = eth_call_rpc(
                rpc_url,
                "eth_call",
                json!([{ "to": contract, "data": data }, "latest"]),
            )?;
            let balance_hex = result.as_str().unwrap_or("0x");
            let dec_result = eth_call_rpc(
                rpc_url,
                "eth_call",
                json!([
                    { "to": contract, "data": erc20_selector("decimals").unwrap() },
                    "latest"
                ]),
            )?;
            let dec_hex = dec_result.as_str().unwrap_or("0x");
            let decimals = hex_to_biguint(dec_hex).to_string().parse::<u64>().unwrap_or(0);
            let balance = hex_to_biguint(balance_hex);
            if decimals > 0 && balance > BigUint::from(0u32) {
                let div = BigUint::from(10u32).pow(decimals as u32);
                let bi = &balance / &div;
                let rem = &balance % &div;
                let width = decimals.min(24) as usize;
                let mut rem_s = rem.to_string();
                while rem_s.len() < width {
                    rem_s.insert(0, '0');
                }
                if rem_s.len() > width {
                    rem_s.truncate(width);
                }
                Ok(format!(
                    "Token Balance:\n  Contract: {}\n  Address: {}\n  Balance: {}.{} (raw: {})",
                    contract, address, bi, rem_s, balance
                ))
            } else {
                Ok(format!(
                    "Token Balance:\n  Contract: {}\n  Address: {}\n  Balance: {}",
                    contract, address, balance
                ))
            }
        }
        "erc20_allowance" => {
            let mut address = str_arg(obj, &["address", "addr", "owner", "wallet"]);
            let mut spender = str_arg(obj, &["spender", "spender_address"]);
            if address.is_empty() || spender.is_empty() {
                return Err("missing address or spender parameter for allowance query".into());
            }
            address = ensure_0x(&address);
            spender = ensure_0x(&spender);
            let sel = erc20_selector("allowance").unwrap();
            let data = format!("{}{}{}", sel, pad_address(&address), pad_address(&spender));
            let result = eth_call_rpc(
                rpc_url,
                "eth_call",
                json!([{ "to": contract, "data": data }, "latest"]),
            )?;
            let allowance_hex = result.as_str().unwrap_or("0x");
            let allowance = hex_to_biguint(allowance_hex);
            Ok(format!(
                "ERC20 Allowance:\n  Contract: {}\n  Owner: {}\n  Spender: {}\n  Allowance: {}",
                contract, address, spender, allowance
            ))
        }
        "erc721_owner" => {
            let token_id = str_arg(obj, &["token_id", "tokenId", "id"]);
            if token_id.is_empty() {
                return Err("missing token_id parameter".into());
            }
            let tid = token_id_word_hex(&token_id)?;
            let data = format!("0x6352211e{}", tid);
            let result = eth_call_rpc(
                rpc_url,
                "eth_call",
                json!([{ "to": contract, "data": data }, "latest"]),
            )?;
            let owner_hex = result.as_str().unwrap_or("0x");
            let owner = if owner_hex.len() >= 42 {
                format!("0x{}", &owner_hex[owner_hex.len() - 40..])
            } else {
                owner_hex.to_string()
            };
            Ok(format!(
                "NFT Owner:\n  Contract: {}\n  Token ID: {}\n  Owner: {}",
                contract, token_id, owner
            ))
        }
        "erc721_metadata" => {
            let token_id = str_arg(obj, &["token_id", "tokenId", "id"]);
            if token_id.is_empty() {
                return Err("missing token_id parameter".into());
            }
            let tid = token_id_word_hex(&token_id)?;
            let data = format!("0xc87b56dd{}", tid);
            let result = eth_call_rpc(
                rpc_url,
                "eth_call",
                json!([{ "to": contract, "data": data }, "latest"]),
            )?;
            let uri_hex = result.as_str().unwrap_or("0x");
            let uri = decode_string_result(uri_hex);
            Ok(format!(
                "NFT Metadata:\n  Contract: {}\n  Token ID: {}\n  Token URI: {}",
                contract, token_id, uri
            ))
        }
        "code" => {
            let result = eth_call_rpc(rpc_url, "eth_getCode", json!([contract, "latest"]))?;
            let code_hex = result.as_str().unwrap_or("0x");
            let code_len = code_hex.len().saturating_sub(2) / 2;
            if code_len == 0 {
                return Ok(format!(
                    "Contract {} has no code (not a contract address)",
                    contract
                ));
            }
            let preview: String = code_hex.chars().take(100).collect();
            Ok(format!(
                "Contract Code:\n  Address: {}\n  Size: {} bytes\n  Code: {}...",
                contract, code_len, preview
            ))
        }
        "storage" => {
            let slot = str_arg(obj, &["slot", "storage_slot", "position"]);
            if slot.is_empty() {
                return Err("missing slot parameter for storage query".into());
            }
            let slot_bi = token_id_word_hex(&slot)?;
            let result = eth_call_rpc(
                rpc_url,
                "eth_getStorageAt",
                json!([contract, slot_bi, "latest"]),
            )?;
            let value_hex = result.as_str().unwrap_or("0x");
            let value = hex_to_biguint(value_hex);
            Ok(format!(
                "Contract Storage:\n  Contract: {}\n  Slot: {}\n  Value: {} (hex: {})",
                contract, slot, value, value_hex
            ))
        }
        _ => Err(format!(
            "unknown operation: {} (supported: erc20_info, erc20_balance, erc20_allowance, erc721_owner, erc721_metadata, code, storage)",
            op
        )),
    }
}

#[tauri::command]
pub fn run_client_smart_contract(params: Value) -> Result<String, String> {
    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;
    eprintln!("[smart_contract] run_client_smart_contract");
    exec_smart_contract(obj)
}
