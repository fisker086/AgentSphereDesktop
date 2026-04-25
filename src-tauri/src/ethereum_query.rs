//! Ethereum JSON-RPC client tools (aligned with `internal/skills/ethereum_query.go`).
//! Read-only: uses public RPC endpoints (same defaults as Go).

use num_bigint::BigUint;
use num_traits::Num;
use serde_json::{json, Value};
use std::str::FromStr;

pub(crate) fn str_arg(obj: &serde_json::Map<String, Value>, keys: &[&str]) -> String {
    for k in keys {
        if let Some(v) = obj.get(*k) {
            if let Some(s) = v.as_str() {
                return s.trim().to_string();
            }
            if let Some(n) = v.as_u64() {
                return n.to_string();
            }
            if let Some(n) = v.as_i64() {
                return n.to_string();
            }
        }
    }
    String::new()
}

pub(crate) fn eth_rpc_url(network: &str) -> &'static str {
    match network {
        "sepolia" => "https://rpc.sepolia.org",
        "holesky" => "https://rpc.holesky.ethpandaops.io",
        _ => "https://eth.llamarpc.com",
    }
}

pub(crate) fn eth_call_rpc(rpc_url: &str, method: &str, params: Value) -> Result<Value, String> {
    let body = json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1
    });
    let body_str = serde_json::to_string(&body).map_err(|e| e.to_string())?;
    let resp = ureq::post(rpc_url)
        .set("Content-Type", "application/json")
        .send_string(&body_str)
        .map_err(|e| format!("RPC request failed: {}", e))?;
    let text = resp.into_string().map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if let Some(err) = v.get("error") {
        if !err.is_null() {
            return Err(format!("RPC error: {}", err));
        }
    }
    v.get("result")
        .cloned()
        .ok_or_else(|| "missing result in RPC response".to_string())
}

pub(crate) fn hex_to_biguint(hex: &str) -> BigUint {
    let h = hex.trim().trim_start_matches("0x");
    if h.is_empty() {
        return BigUint::from(0u32);
    }
    BigUint::from_str_radix(h, 16).unwrap_or_else(|_| BigUint::from(0u32))
}

pub(crate) fn wei_to_eth(wei: &BigUint) -> String {
    let denom = BigUint::from(10u32).pow(18);
    let whole = wei / &denom;
    let frac_wei = wei % &denom;
    let scale = BigUint::from(10u32).pow(12);
    let dec6 = frac_wei / scale;
    format!("{}.{:06}", whole, dec6)
}

pub(crate) fn gwei_str(wei: &BigUint) -> String {
    let g = BigUint::from(10u32).pow(9);
    let whole = wei / &g;
    let rem = wei % &g;
    let frac = rem * BigUint::from(100u32) / g;
    format!("{}.{:02}", whole, frac)
}

pub(crate) fn ensure_0x(addr: &str) -> String {
    let a = addr.trim();
    if a.starts_with("0x") {
        a.to_string()
    } else {
        format!("0x{}", a)
    }
}

fn parse_block_param(block_num: &str) -> Result<String, String> {
    let s = block_num.trim();
    if s.is_empty() {
        return Ok("latest".to_string());
    }
    if s == "latest" || s == "pending" || s == "earliest" {
        return Ok(s.to_string());
    }
    if let Ok(n) = u64::from_str(s) {
        return Ok(format!("0x{:x}", n));
    }
    if s.starts_with("0x") {
        return Ok(s.to_string());
    }
    Err(format!("invalid block_number: {}", block_num))
}

pub fn exec_ethereum_query(obj: &serde_json::Map<String, Value>) -> Result<String, String> {
    let op = str_arg(obj, &["operation", "op", "action", "command"]);
    let mut network = str_arg(obj, &["network", "net"]);
    if network.is_empty() {
        network = "mainnet".to_string();
    }
    let rpc_url = eth_rpc_url(network.as_str());

    match op.as_str() {
        "block_number" => {
            let result = eth_call_rpc(rpc_url, "eth_blockNumber", json!([]))?;
            let block_hex = result
                .as_str()
                .ok_or_else(|| "invalid block number response".to_string())?;
            let n = hex_to_biguint(block_hex);
            Ok(format!("Current block number on {}: {}", network, n))
        }
        "block" => {
            let block_num = str_arg(obj, &["block_number", "block", "number"]);
            let block_param = parse_block_param(&block_num)?;
            let result = eth_call_rpc(
                rpc_url,
                "eth_getBlockByNumber",
                json!([block_param, false]),
            )?;
            if result.is_null() {
                return Ok(format!("Block not found on {}", network));
            }
            let block = result
                .as_object()
                .ok_or_else(|| "invalid block".to_string())?;
            let number = block
                .get("number")
                .and_then(|v| v.as_str())
                .unwrap_or("0x0");
            let hash = block
                .get("hash")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let timestamp = block
                .get("timestamp")
                .and_then(|v| v.as_str())
                .unwrap_or("0x0");
            let tx_count = block
                .get("transactions")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let gas_used = block
                .get("gasUsed")
                .and_then(|v| v.as_str())
                .unwrap_or("0x0");
            let gas_limit = block
                .get("gasLimit")
                .and_then(|v| v.as_str())
                .unwrap_or("0x0");
            Ok(format!(
                "Block {} on {}:\n  Hash: {}\n  Timestamp: {}\n  Transactions: {}\n  Gas Used: {}\n  Gas Limit: {}",
                hex_to_biguint(number),
                network,
                hash,
                hex_to_biguint(timestamp),
                tx_count,
                hex_to_biguint(gas_used),
                hex_to_biguint(gas_limit)
            ))
        }
        "balance" => {
            let mut address = str_arg(obj, &["address", "addr", "wallet"]);
            if address.is_empty() {
                return Err("missing address parameter".into());
            }
            address = ensure_0x(&address);
            let result = eth_call_rpc(rpc_url, "eth_getBalance", json!([address, "latest"]))?;
            let balance_hex = result
                .as_str()
                .ok_or_else(|| "invalid balance".to_string())?;
            let wei = hex_to_biguint(balance_hex);
            Ok(format!(
                "Address {} balance on {}:\n  Wei: {}\n  ETH: {}",
                address,
                network,
                wei,
                wei_to_eth(&wei)
            ))
        }
        "transaction" => {
            let mut tx_hash = str_arg(obj, &["tx_hash", "hash", "transaction"]);
            if tx_hash.is_empty() {
                return Err("missing tx_hash parameter".into());
            }
            tx_hash = ensure_0x(&tx_hash);
            let result = eth_call_rpc(rpc_url, "eth_getTransactionByHash", json!([tx_hash]))?;
            if result.is_null() {
                return Ok(format!("Transaction {} not found on {}", tx_hash, network));
            }
            let tx = result
                .as_object()
                .ok_or_else(|| "invalid transaction".to_string())?;
            let from = tx.get("from").and_then(|v| v.as_str()).unwrap_or("");
            let to_str = match tx.get("to") {
                Some(Value::String(s)) if !s.is_empty() => s.as_str(),
                _ => "Contract Creation",
            };
            let value = tx
                .get("value")
                .and_then(|v| v.as_str())
                .unwrap_or("0x0");
            let gas = tx.get("gas").and_then(|v| v.as_str()).unwrap_or("0x0");
            let gas_price = tx
                .get("gasPrice")
                .and_then(|v| v.as_str())
                .map(|s| hex_to_biguint(s).to_string())
                .unwrap_or_else(|| "n/a".to_string());
            let nonce = tx.get("nonce").and_then(|v| v.as_str()).unwrap_or("0x0");
            let val = hex_to_biguint(value);
            Ok(format!(
                "Transaction {} on {}:\n  From: {}\n  To: {}\n  Value: {} wei ({} ETH)\n  Gas: {}\n  Gas Price: {} wei\n  Nonce: {}",
                tx_hash,
                network,
                from,
                to_str,
                val,
                wei_to_eth(&val),
                hex_to_biguint(gas),
                gas_price,
                hex_to_biguint(nonce)
            ))
        }
        "gas_price" => {
            let result = eth_call_rpc(rpc_url, "eth_gasPrice", json!([]))?;
            let gas_hex = result
                .as_str()
                .ok_or_else(|| "invalid gas price".to_string())?;
            let wei = hex_to_biguint(gas_hex);
            Ok(format!(
                "Current gas price on {}:\n  Wei: {}\n  Gwei: {}",
                network,
                wei,
                gwei_str(&wei)
            ))
        }
        "nonce" => {
            let mut address = str_arg(obj, &["address", "addr", "wallet"]);
            if address.is_empty() {
                return Err("missing address parameter".into());
            }
            address = ensure_0x(&address);
            let result =
                eth_call_rpc(rpc_url, "eth_getTransactionCount", json!([address, "latest"]))?;
            let nonce_hex = result.as_str().ok_or_else(|| "invalid nonce".to_string())?;
            Ok(format!(
                "Address {} nonce on {}: {}",
                address,
                network,
                hex_to_biguint(nonce_hex)
            ))
        }
        "chain_id" => {
            let result = eth_call_rpc(rpc_url, "eth_chainId", json!([]))?;
            let chain_hex = result
                .as_str()
                .ok_or_else(|| "invalid chain id".to_string())?;
            let chain_id = hex_to_biguint(chain_hex);
            let cs = chain_id.to_string();
            let name = match cs.as_str() {
                "1" => "Ethereum Mainnet",
                "11155111" => "Sepolia Testnet",
                "17000" => "Holesky Testnet",
                _ => "Unknown Network",
            };
            Ok(format!("Chain ID: {} ({})", chain_id, name))
        }
        _ => Err(format!(
            "unknown operation: {} (supported: block_number, block, balance, transaction, gas_price, nonce, chain_id)",
            op
        )),
    }
}

#[tauri::command]
pub fn run_client_ethereum_query(params: Value) -> Result<String, String> {
    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;
    eprintln!("[ethereum_query] run_client_ethereum_query");
    exec_ethereum_query(obj)
}
