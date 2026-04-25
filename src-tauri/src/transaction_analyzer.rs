//! Transaction analyzer tools (aligned with `internal/skills/transaction_analyzer.go`).

use num_bigint::BigUint;
use serde_json::{json, Value};

use super::ethereum_query::{
    ensure_0x, eth_call_rpc, eth_rpc_url, gwei_str, hex_to_biguint, str_arg, wei_to_eth,
};

const ERC20_TRANSFER_TOPIC: &str =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

fn tx_field_str(tx: &serde_json::Map<String, Value>, key: &str) -> String {
    tx.get(key)
        .and_then(|v| {
            if let Some(s) = v.as_str() {
                Some(s.to_string())
            } else {
                v.as_u64().map(|n| format!("0x{:x}", n))
            }
        })
        .unwrap_or_default()
}

pub fn exec_transaction_analyzer(obj: &serde_json::Map<String, Value>) -> Result<String, String> {
    let op = str_arg(obj, &["operation", "op", "action", "command"]);
    let mut network = str_arg(obj, &["network", "net"]);
    if network.is_empty() {
        network = "mainnet".to_string();
    }
    let rpc_url = eth_rpc_url(network.as_str());
    let mut tx_hash = str_arg(obj, &["tx_hash", "hash", "transaction"]);
    if tx_hash.is_empty() {
        return Err("missing tx_hash parameter".into());
    }
    tx_hash = ensure_0x(&tx_hash);

    match op.as_str() {
        "details" => {
            let result = eth_call_rpc(rpc_url, "eth_getTransactionByHash", json!([tx_hash]))?;
            if result.is_null() {
                return Ok(format!("Transaction {} not found on {}", tx_hash, network));
            }
            let tx = result
                .as_object()
                .ok_or_else(|| "invalid transaction".to_string())?;
            let from = tx_field_str(tx, "from");
            let to_str = match tx.get("to") {
                Some(Value::String(s)) if !s.is_empty() => s.as_str(),
                _ => "Contract Creation",
            };
            let value = tx_field_str(tx, "value");
            let gas = tx_field_str(tx, "gas");
            let gas_price = tx
                .get("gasPrice")
                .and_then(|v| v.as_str())
                .map(|s| hex_to_biguint(s).to_string())
                .unwrap_or_else(|| "n/a (EIP-1559)".to_string());
            let input = tx_field_str(tx, "input");
            let nonce = tx_field_str(tx, "nonce");
            let block_str = match tx.get("blockNumber") {
                Some(Value::String(s)) if !s.is_empty() => hex_to_biguint(s).to_string(),
                Some(Value::Null) | None => "Pending".to_string(),
                Some(v) => v
                    .as_str()
                    .map(|s| hex_to_biguint(s).to_string())
                    .unwrap_or_else(|| "Pending".to_string()),
            };
            let val = hex_to_biguint(&value);
            let mut input_preview = input.clone();
            if input_preview.len() > 66 {
                input_preview.truncate(66);
                input_preview.push_str("...");
            }
            Ok(format!(
                "Transaction Details ({}):\n  Hash: {}\n  Block: {}\n  From: {}\n  To: {}\n  Value: {} wei ({} ETH)\n  Gas Limit: {}\n  Gas Price: {} wei\n  Nonce: {}\n  Input Data: {}",
                network,
                tx_hash,
                block_str,
                from,
                to_str,
                val,
                wei_to_eth(&val),
                hex_to_biguint(&gas),
                gas_price,
                hex_to_biguint(&nonce),
                input_preview
            ))
        }
        "receipt" => {
            let result = eth_call_rpc(rpc_url, "eth_getTransactionReceipt", json!([tx_hash]))?;
            if result.is_null() {
                return Ok(format!(
                    "Transaction receipt not found for {} on {} (may be pending)",
                    tx_hash, network
                ));
            }
            let receipt = result
                .as_object()
                .ok_or_else(|| "invalid receipt".to_string())?;
            let status = receipt
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("0x0");
            let status_str = if status == "0x0" { "Failed" } else { "Success" };
            let block_number = receipt
                .get("blockNumber")
                .and_then(|v| v.as_str())
                .unwrap_or("0x0");
            let gas_used = receipt
                .get("gasUsed")
                .and_then(|v| v.as_str())
                .unwrap_or("0x0");
            let cum = receipt
                .get("cumulativeGasUsed")
                .and_then(|v| v.as_str())
                .unwrap_or("0x0");
            let eff = receipt
                .get("effectiveGasPrice")
                .and_then(|v| v.as_str())
                .map(|s| hex_to_biguint(s).to_string())
                .unwrap_or_else(|| "n/a".to_string());
            let contract_str = receipt
                .get("contractAddress")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("N/A");
            let log_count = receipt
                .get("logs")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            Ok(format!(
                "Transaction Receipt ({}):\n  Hash: {}\n  Status: {}\n  Block: {}\n  Gas Used: {}\n  Cumulative Gas Used: {}\n  Effective Gas Price: {} wei\n  Contract Address: {}\n  Log Entries: {}",
                network,
                tx_hash,
                status_str,
                hex_to_biguint(block_number),
                hex_to_biguint(gas_used),
                hex_to_biguint(cum),
                eff,
                contract_str,
                log_count
            ))
        }
        "gas_analysis" => {
            let tx_result = eth_call_rpc(rpc_url, "eth_getTransactionByHash", json!([tx_hash]))?;
            if tx_result.is_null() {
                return Ok(format!("Transaction {} not found on {}", tx_hash, network));
            }
            let tx = tx_result
                .as_object()
                .ok_or_else(|| "invalid transaction".to_string())?;
            let rec_result = eth_call_rpc(rpc_url, "eth_getTransactionReceipt", json!([tx_hash]))?;
            if rec_result.is_null() {
                return Ok(format!(
                    "Transaction receipt not found for {}",
                    tx_hash
                ));
            }
            let receipt = rec_result
                .as_object()
                .ok_or_else(|| "invalid receipt".to_string())?;
            let gas_limit = hex_to_biguint(tx_field_str(tx, "gas").as_str());
            let gas_used = hex_to_biguint(
                receipt
                    .get("gasUsed")
                    .and_then(|v| v.as_str())
                    .unwrap_or("0x0"),
            );
            let eff = receipt
                .get("effectiveGasPrice")
                .and_then(|v| v.as_str())
                .unwrap_or("0x0");
            let effective_gas_price = hex_to_biguint(eff);
            let pct = if gas_limit > BigUint::from(0u32) {
                let num = gas_used.clone() * BigUint::from(100u32);
                let q = num / &gas_limit;
                q.to_string()
            } else {
                "0".to_string()
            };
            let total_cost = gas_used.clone() * effective_gas_price.clone();
            let gwei = gwei_str(&effective_gas_price);
            Ok(format!(
                "Gas Analysis ({}):\n  Hash: {}\n  Gas Limit: {}\n  Gas Used: {}\n  Gas Used: {}%\n  Effective Gas Price: {} wei ({} Gwei)\n  Total Cost: {} wei ({} ETH)",
                network,
                tx_hash,
                gas_limit,
                gas_used,
                pct,
                effective_gas_price,
                gwei,
                total_cost,
                wei_to_eth(&total_cost)
            ))
        }
        "cost" => {
            let rec_result = eth_call_rpc(rpc_url, "eth_getTransactionReceipt", json!([tx_hash]))?;
            if rec_result.is_null() {
                return Ok(format!(
                    "Transaction receipt not found for {}",
                    tx_hash
                ));
            }
            let receipt = rec_result
                .as_object()
                .ok_or_else(|| "invalid receipt".to_string())?;
            let gas_used = hex_to_biguint(
                receipt
                    .get("gasUsed")
                    .and_then(|v| v.as_str())
                    .unwrap_or("0x0"),
            );
            let eff = receipt
                .get("effectiveGasPrice")
                .and_then(|v| v.as_str())
                .unwrap_or("0x0");
            let effective_gas_price = hex_to_biguint(eff);
            let total_cost = gas_used.clone() * effective_gas_price.clone();
            Ok(format!(
                "Transaction Cost ({}):\n  Hash: {}\n  Gas Used: {}\n  Gas Price: {} wei ({} Gwei)\n  Total Cost: {} wei\n  Total Cost: {} ETH",
                network,
                tx_hash,
                gas_used,
                effective_gas_price,
                gwei_str(&effective_gas_price),
                total_cost,
                wei_to_eth(&total_cost)
            ))
        }
        "token_transfers" => {
            let result = eth_call_rpc(rpc_url, "eth_getTransactionReceipt", json!([tx_hash]))?;
            if result.is_null() {
                return Ok(format!(
                    "Transaction receipt not found for {}",
                    tx_hash
                ));
            }
            let receipt = result
                .as_object()
                .ok_or_else(|| "invalid receipt".to_string())?;
            let logs = receipt
                .get("logs")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let mut transfers: Vec<String> = Vec::new();
            for (i, log) in logs.iter().enumerate() {
                let log_map = log.as_object().ok_or_else(|| "bad log".to_string())?;
                let topics = log_map
                    .get("topics")
                    .and_then(|v| v.as_array())
                    .ok_or_else(|| "bad topics".to_string())?;
                if topics.len() < 3 {
                    continue;
                }
                let t0 = topics[0].as_str().unwrap_or("");
                if t0 != ERC20_TRANSFER_TOPIC {
                    continue;
                }
                let contract = log_map
                    .get("address")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let t1 = topics[1].as_str().unwrap_or("");
                let t2 = topics[2].as_str().unwrap_or("");
                let from = if t1.len() >= 26 {
                    format!("0x{}", &t1[t1.len() - 40..])
                } else {
                    t1.to_string()
                };
                let to = if t2.len() >= 26 {
                    format!("0x{}", &t2[t2.len() - 40..])
                } else {
                    t2.to_string()
                };
                let data = log_map
                    .get("data")
                    .and_then(|v| v.as_str())
                    .unwrap_or("0x0");
                let value = hex_to_biguint(data);
                transfers.push(format!(
                    "  Transfer #{}:\n    Contract: {}\n    From: {}\n    To: {}\n    Value: {}",
                    i + 1,
                    contract,
                    from,
                    to,
                    value
                ));
            }
            if transfers.is_empty() {
                return Ok(format!(
                    "No ERC20 token transfers found in transaction {}",
                    tx_hash
                ));
            }
            Ok(format!(
                "Token Transfers ({}):\n  Hash: {}\n  Count: {}\n\n{}",
                network,
                tx_hash,
                transfers.len(),
                transfers.join("\n\n")
            ))
        }
        "internal_txs" => Ok(format!(
            "Internal transaction analysis requires an archive node with tracing enabled.\nUse a service like Etherscan or an archive node RPC to get internal transactions for: {}",
            tx_hash
        )),
        _ => Err(format!(
            "unknown operation: {} (supported: details, receipt, gas_analysis, cost, token_transfers, internal_txs)",
            op
        )),
    }
}

#[tauri::command]
pub fn run_client_transaction_analyzer(params: Value) -> Result<String, String> {
    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;
    eprintln!("[transaction_analyzer] run_client_transaction_analyzer");
    exec_transaction_analyzer(obj)
}
