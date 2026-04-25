//! Local Redis client (aligned with internal/skills/redis_tool.go and skills/redis_tool/SKILL.md).

use redis::Commands;
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

fn parse_addr(addr: &str) -> Result<(String, u16), String> {
    let s = if addr.is_empty() {
        "127.0.0.1:6379"
    } else {
        addr.trim()
    };
    if s.starts_with('[') {
        if let Some(end) = s.find(']') {
            let host = s[1..end].to_string();
            let after = &s[end + 1..];
            if let Some(p) = after.strip_prefix(':') {
                let port: u16 = p.parse().map_err(|_| "invalid port".to_string())?;
                return Ok((host, port));
            }
        }
        return Err("invalid IPv6 address".into());
    }
    if let Some(idx) = s.rfind(':') {
        let host = s[..idx].to_string();
        let port: u16 = s[idx + 1..]
            .parse()
            .map_err(|_| "invalid port".to_string())?;
        if host.is_empty() {
            return Err("invalid addr".into());
        }
        return Ok((host, port));
    }
    Ok((s.to_string(), 6379))
}

fn open_connection(addr: &str, password: &str, db: i64) -> Result<redis::Connection, String> {
    let (host, port) = parse_addr(addr)?;
    let ci = redis::ConnectionInfo {
        addr: redis::ConnectionAddr::Tcp(host, port),
        redis: redis::RedisConnectionInfo {
            db,
            username: None,
            password: if password.is_empty() {
                None
            } else {
                Some(password.to_string())
            },
            ..Default::default()
        },
    };
    let client = redis::Client::open(ci).map_err(|e| e.to_string())?;
    client.get_connection().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn run_client_redis_tool(params: Value) -> Result<String, String> {
    eprintln!("[redis_tool] invoked");

    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let op = str_arg(obj, &["operation", "op", "action"]);
    if op.is_empty() {
        return Err("missing operation".into());
    }

    let allowed = [
        "get",
        "set",
        "del",
        "keys",
        "exists",
        "type",
        "ttl",
        "expire",
        "incr",
        "decr",
        "hash_get",
        "hash_set",
        "hash_del",
        "hash_getall",
        "list_push",
        "list_range",
        "set_add",
        "set_members",
        "zset_add",
        "zset_range",
        "info",
        "dbsize",
        "ping",
    ];
    if !allowed.contains(&op.as_str()) {
        return Err(format!(
            "operation {:?} not allowed (allowed: {:?})",
            op, allowed
        ));
    }

    let mut addr = str_arg(obj, &["addr", "address", "host"]);
    if addr.is_empty() {
        addr = "127.0.0.1:6379".into();
    }
    let password = str_arg(obj, &["password", "pass", "pwd"]);
    let db_str = str_arg(obj, &["db", "database"]);
    let db: i64 = if db_str.is_empty() {
        0
    } else {
        db_str.parse().unwrap_or(0)
    };

    let mut con = open_connection(&addr, &password, db)?;

    redis::cmd("PING")
        .query::<String>(&mut con)
        .map_err(|e| format!("failed to connect to redis: {e}"))?;

    match op.as_str() {
        "get" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let val: Option<String> = con.get(&key).map_err(|e| e.to_string())?;
            Ok(match val {
                None => format!("Key '{key}' not found"),
                Some(v) => format!("GET {key}:\n{v}"),
            })
        }
        "set" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let value = str_arg(obj, &["value"]);
            if value.is_empty() {
                return Err("missing value".into());
            }
            let ttl = str_arg(obj, &["ttl", "expire_seconds"]);
            if !ttl.is_empty() {
                if let Ok(sec) = ttl.parse::<u64>() {
                    if sec > 0 {
                        con.set_ex::<_, _, ()>(&key, &value, sec)
                            .map_err(|e| format!("set failed: {e}"))?;
                        return Ok(format!("SET {key} (TTL: {sec}s): OK"));
                    }
                }
            }
            con.set::<_, _, ()>(&key, &value)
                .map_err(|e| format!("set failed: {e}"))?;
            Ok(format!("SET {key}: OK"))
        }
        "del" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let n: i64 = con.del(&key).map_err(|e| format!("del failed: {e}"))?;
            Ok(format!("DEL {key}: removed {n} key(s)"))
        }
        "keys" => {
            let mut pattern = str_arg(obj, &["pattern", "match"]);
            if pattern.is_empty() {
                pattern = "*".into();
            }
            let keys: Vec<String> = con
                .keys(&pattern)
                .map_err(|e| format!("keys failed: {e}"))?;
            if keys.is_empty() {
                return Ok(format!("No keys found matching '{pattern}'"));
            }
            Ok(format!(
                "Keys matching '{pattern}' ({}):\n{}",
                keys.len(),
                keys.join("\n")
            ))
        }
        "exists" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let n: i64 = con
                .exists(&key)
                .map_err(|e| format!("exists failed: {e}"))?;
            Ok(format!("Key '{key}' exists: {}", n == 1))
        }
        "type" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let t: String = redis::cmd("TYPE")
                .arg(&key)
                .query(&mut con)
                .map_err(|e| format!("type failed: {e}"))?;
            Ok(format!("Key '{key}' type: {t}"))
        }
        "ttl" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let d: i64 = con.ttl(&key).map_err(|e| format!("ttl failed: {e}"))?;
            if d < 0 {
                Ok(format!("Key '{key}' has no expiry"))
            } else {
                Ok(format!("Key '{key}' TTL: {d}s"))
            }
        }
        "expire" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let ttl = str_arg(obj, &["ttl", "seconds"]);
            if ttl.is_empty() {
                return Err("missing ttl".into());
            }
            let sec: i64 = ttl.parse().map_err(|_| format!("invalid ttl: {ttl}"))?;
            let ok: bool = con
                .expire(&key, sec as i64)
                .map_err(|e| format!("expire failed: {e}"))?;
            Ok(format!("EXPIRE {key} {sec}s: {ok}"))
        }
        "incr" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let val: i64 = con.incr(&key, 1).map_err(|e| format!("incr failed: {e}"))?;
            Ok(format!("INCR {key}: {val}"))
        }
        "decr" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let val: i64 = con.decr(&key, 1).map_err(|e| format!("decr failed: {e}"))?;
            Ok(format!("DECR {key}: {val}"))
        }
        "hash_get" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let field = str_arg(obj, &["field"]);
            if field.is_empty() {
                return Err("missing field".into());
            }
            let val: Option<String> = con
                .hget(&key, &field)
                .map_err(|e| format!("hash_get failed: {e}"))?;
            Ok(match val {
                None => format!("Field '{field}' not found in hash '{key}'"),
                Some(v) => format!("HGET {key} {field}:\n{v}"),
            })
        }
        "hash_set" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let field = str_arg(obj, &["field"]);
            if field.is_empty() {
                return Err("missing field".into());
            }
            let value = str_arg(obj, &["value"]);
            if value.is_empty() {
                return Err("missing value".into());
            }
            con.hset::<_, _, _, ()>(&key, &field, &value)
                .map_err(|e| format!("hash_set failed: {e}"))?;
            Ok(format!("HSET {key} {field}: OK"))
        }
        "hash_del" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let field = str_arg(obj, &["field"]);
            if field.is_empty() {
                return Err("missing field".into());
            }
            let n: i64 = con
                .hdel(&key, &field)
                .map_err(|e| format!("hash_del failed: {e}"))?;
            Ok(format!("HDEL {key} {field}: removed {n} field(s)"))
        }
        "hash_getall" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let m: HashMap<String, String> = con
                .hgetall(&key)
                .map_err(|e| format!("hash_getall failed: {e}"))?;
            if m.is_empty() {
                return Ok(format!("Hash '{key}' is empty"));
            }
            let mut out = String::new();
            out.push_str(&format!("HGETALL {key}:\n"));
            for (f, v) in m {
                out.push_str(&format!("  {f}: {v}\n"));
            }
            Ok(out)
        }
        "list_push" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let value = str_arg(obj, &["value"]);
            if value.is_empty() {
                return Err("missing value".into());
            }
            let dir = str_arg(obj, &["direction", "pos"]);
            let n: i64 = if dir == "right" || dir == "rpush" {
                con.rpush(&key, &value)
            } else {
                con.lpush(&key, &value)
            }
            .map_err(|e| format!("list_push failed: {e}"))?;
            Ok(format!("LPUSH/RPUSH {key}: list length now {n}"))
        }
        "list_range" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let start = str_arg(obj, &["start", "offset"]);
            let end = str_arg(obj, &["end", "count"]);
            let mut s: isize = 0;
            let mut e: isize = -1;
            if !start.is_empty() {
                s = start.parse().unwrap_or(0);
            }
            if !end.is_empty() {
                e = end.parse().unwrap_or(-1);
            }
            let vals: Vec<String> = con
                .lrange(&key, s, e)
                .map_err(|e| format!("list_range failed: {e}"))?;
            if vals.is_empty() {
                return Ok(format!("List '{key}' is empty"));
            }
            let mut out = String::new();
            out.push_str(&format!("LRANGE {key} ({} items):\n", vals.len()));
            for (i, v) in vals.iter().enumerate() {
                out.push_str(&format!("  {}: {v}\n", s + i as isize));
            }
            Ok(out)
        }
        "set_add" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let member = str_arg(obj, &["member", "value"]);
            if member.is_empty() {
                return Err("missing member".into());
            }
            let n: i64 = con
                .sadd(&key, &member)
                .map_err(|e| format!("set_add failed: {e}"))?;
            Ok(format!("SADD {key}: added {n} member(s)"))
        }
        "set_members" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let members: Vec<String> = con
                .smembers(&key)
                .map_err(|e| format!("set_members failed: {e}"))?;
            if members.is_empty() {
                return Ok(format!("Set '{key}' is empty"));
            }
            Ok(format!(
                "SMEMBERS {} ({}):\n{}",
                key,
                members.len(),
                members.join("\n")
            ))
        }
        "zset_add" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let member = str_arg(obj, &["member", "value"]);
            if member.is_empty() {
                return Err("missing member".into());
            }
            let score_s = str_arg(obj, &["score"]);
            if score_s.is_empty() {
                return Err("missing score".into());
            }
            let score: f64 = score_s
                .parse()
                .map_err(|_| format!("invalid score: {score_s}"))?;
            let n: i64 = redis::cmd("ZADD")
                .arg(&key)
                .arg(score)
                .arg(&member)
                .query(&mut con)
                .map_err(|e| format!("zset_add failed: {e}"))?;
            Ok(format!("ZADD {key}: added {n} member(s)"))
        }
        "zset_range" => {
            let key = str_arg(obj, &["key"]);
            if key.is_empty() {
                return Err("missing key".into());
            }
            let start = str_arg(obj, &["start"]);
            let end = str_arg(obj, &["end"]);
            let mut s: i64 = 0;
            let mut e: i64 = -1;
            if !start.is_empty() {
                s = start.parse().unwrap_or(0);
            }
            if !end.is_empty() {
                e = end.parse().unwrap_or(-1);
            }
            let withscores = str_arg(obj, &["with_scores", "scores"]);
            let z: Vec<String> = con
                .zrange(&key, s as isize, e as isize)
                .map_err(|e| format!("zset_range failed: {e}"))?;
            let mut b = String::new();
            b.push_str(&format!("ZRANGE {key}:\n"));
            for (i, m) in z.iter().enumerate() {
                if withscores == "true" || withscores == "1" {
                    let sc: f64 = con
                        .zscore::<_, _, f64>(&key, m)
                        .map_err(|e| format!("zset_range failed: {e}"))?;
                    b.push_str(&format!("  {}: {} (score: {:.2})\n", s + i as i64, m, sc));
                } else {
                    b.push_str(&format!("  {}: {}\n", s + i as i64, m));
                }
            }
            Ok(b)
        }
        "info" => {
            let section = str_arg(obj, &["section", "target"]);
            let info: String = if section.is_empty() {
                redis::cmd("INFO").query(&mut con)
            } else {
                redis::cmd("INFO").arg(&section).query(&mut con)
            }
            .map_err(|e| format!("info failed: {e}"))?;
            Ok(format!("INFO:\n{info}"))
        }
        "dbsize" => {
            let size: i64 = redis::cmd("DBSIZE")
                .query(&mut con)
                .map_err(|e| format!("dbsize failed: {e}"))?;
            Ok(format!("DBSIZE: {size} keys"))
        }
        "ping" => {
            let pong: String = redis::cmd("PING")
                .query(&mut con)
                .map_err(|e| format!("ping failed: {e}"))?;
            Ok(format!("PONG: {pong}"))
        }
        _ => Err(format!("unsupported operation: {op}")),
    }
}
