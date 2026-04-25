//! NFT query tools (aligned with `skills/nft_query/SKILL.md`).

use num_bigint::BigUint;
use num_traits::Num;
use serde_json::{json, Value};
use std::str::FromStr;

use super::ethereum_query::{ensure_0x, eth_call_rpc, eth_rpc_url, hex_to_biguint, str_arg};

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

pub fn exec_nft_query(obj: &serde_json::Map<String, Value>) -> Result<String, String> {
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
        "owner" => {
            let token_id = str_arg(obj, &["token_id", "tokenId", "id"]);
            if token_id.is_empty() {
                return Err("missing token_id".into());
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
        "metadata" => {
            let token_id = str_arg(obj, &["token_id", "tokenId", "id"]);
            if token_id.is_empty() {
                return Err("missing token_id".into());
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
        "balance" => {
            let mut owner_address = str_arg(obj, &["owner_address", "address", "addr", "wallet"]);
            if owner_address.is_empty() {
                return Err("missing owner_address".into());
            }
            owner_address = ensure_0x(&owner_address);
            let token_id_opt = str_arg(obj, &["token_id", "tokenId", "id"]);
            if token_id_opt.is_empty() {
                // ERC721 balanceOf(address)
                let sel = "0x70a08231";
                let data = format!("{}{}", sel, pad_address(&owner_address));
                let result = eth_call_rpc(
                    rpc_url,
                    "eth_call",
                    json!([{ "to": contract, "data": data }, "latest"]),
                )?;
                let bal_hex = result.as_str().unwrap_or("0x");
                let bal = hex_to_biguint(bal_hex);
                Ok(format!(
                    "NFT balance (ERC721):\n  Contract: {}\n  Owner: {}\n  Balance: {}",
                    contract, owner_address, bal
                ))
            } else {
                // ERC1155 balanceOf(address,uint256) — 0x00fdd58e
                let tid = token_id_word_hex(&token_id_opt)?;
                let data = format!(
                    "0x00fdd58e{}{}",
                    pad_address(&owner_address),
                    tid
                );
                let result = eth_call_rpc(
                    rpc_url,
                    "eth_call",
                    json!([{ "to": contract, "data": data }, "latest"]),
                )?;
                let bal_hex = result.as_str().unwrap_or("0x");
                let bal = hex_to_biguint(bal_hex);
                Ok(format!(
                    "NFT balance (ERC1155):\n  Contract: {}\n  Owner: {}\n  Token ID: {}\n  Balance: {}",
                    contract, owner_address, token_id_opt, bal
                ))
            }
        }
        "collection_info" => {
            let mut out = String::from("Collection (ERC721-style):\n");
            for (label, sel) in [
                ("name", "0x06fdde03"),
                ("symbol", "0x95d89b41"),
                ("totalSupply", "0x18160ddd"),
            ] {
                let result = eth_call_rpc(
                    rpc_url,
                    "eth_call",
                    json!([{ "to": contract, "data": sel }, "latest"]),
                )?;
                let hex_r = result.as_str().unwrap_or("0x");
                let text = if label == "name" || label == "symbol" {
                    decode_string_result(hex_r)
                } else {
                    hex_to_biguint(hex_r).to_string()
                };
                out.push_str(&format!("  {}: {}\n", label, text));
            }
            Ok(out.trim_end().to_string())
        }
        "tokens_of_owner" => {
            let owner_hint = str_arg(obj, &["owner_address", "address", "addr"]);
            Ok(format!(
            "Listing all token IDs for an address usually requires an indexer or an ERC721Enumerable contract.\nContract: {}\nOwner: {}\nTip: use a block explorer API or enumerate via tokenOfOwnerByIndex if the contract supports it.",
            contract,
            owner_hint
        ))
        }
        _ => Err(format!(
            "unknown operation: {} (supported: owner, metadata, balance, collection_info, tokens_of_owner)",
            op
        )),
    }
}

#[tauri::command]
pub fn run_client_nft_query(params: Value) -> Result<String, String> {
    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;
    eprintln!("[nft_query] run_client_nft_query");
    exec_nft_query(obj)
}
