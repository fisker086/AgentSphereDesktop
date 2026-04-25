//! Local database query client (aligned with skills/db_query/SKILL.md).
//! Uses Rust drivers (`postgres`, `mysql`) so no `psql` / `mysql` CLI is required (avoids ENOENT on missing binaries).

use chrono::{NaiveDate, NaiveDateTime};
use postgres::{Client, NoTls, Row};
use serde_json::Value;

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

fn is_safe_sql(query: &str) -> bool {
    let q = query.to_uppercase();
    let blocked = [
        "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE", "GRANT", "REVOKE",
        "REPLACE", "MERGE",
    ];
    !blocked.iter().any(|b| q.contains(b))
}

fn normalize_driver(driver: &str) -> &'static str {
    match driver.to_lowercase().as_str() {
        "postgres" | "postgresql" | "pgx" => "postgres",
        "mysql" => "mysql",
        _ => "postgres",
    }
}

const PG_SSL_NOT_SUPPORTED: &str = "桌面端数据库工具当前不支持 SSL（仅支持 sslmode=disable）。若必须使用 SSL，请使用 psql、DBeaver 等客户端，或将连接改为非 SSL。";

/// `postgres://` / `postgresql://` URI: default `sslmode=disable` if omitted; reject explicit non-disable sslmode.
fn normalize_postgres_uri(dsn: &str) -> Result<String, String> {
    let (before_q, query) = match dsn.split_once('?') {
        Some((b, q)) => (b, q),
        None => (dsn, ""),
    };

    let mut sslmode_last: Option<String> = None;
    for segment in query.split('&').filter(|s| !s.is_empty()) {
        let mut parts = segment.splitn(2, '=');
        let k = parts.next().unwrap_or("").to_lowercase();
        if k == "sslmode" {
            let v = parts.next().unwrap_or("").to_string();
            sslmode_last = Some(v);
        }
    }

    if let Some(v) = sslmode_last {
        if v.eq_ignore_ascii_case("disable") {
            return Ok(dsn.to_string());
        }
        return Err(PG_SSL_NOT_SUPPORTED.to_string());
    }

    let q = if query.is_empty() {
        "sslmode=disable".to_string()
    } else {
        format!("{query}&sslmode=disable")
    };
    Ok(format!("{before_q}?{q}"))
}

/// libpq `key=value` style DSN (space-separated): default `sslmode=disable` if omitted; reject other sslmode.
fn normalize_postgres_libpq(dsn: &str) -> Result<String, String> {
    let dsn = dsn.trim();
    if dsn.is_empty() {
        return Err("empty DSN".into());
    }

    let mut sslmode: Option<String> = None;
    for part in dsn.split_whitespace() {
        let lower = part.to_lowercase();
        if let Some(v) = lower.strip_prefix("sslmode=") {
            sslmode = Some(v.trim().to_string());
        }
    }

    if let Some(v) = sslmode {
        if v.eq_ignore_ascii_case("disable") {
            return Ok(dsn.to_string());
        }
        return Err(PG_SSL_NOT_SUPPORTED.to_string());
    }

    Ok(format!("{dsn} sslmode=disable"))
}

fn normalize_postgres_dsn(dsn: &str) -> Result<String, String> {
    let dsn = dsn.trim();
    if dsn.starts_with("postgres://") || dsn.starts_with("postgresql://") {
        normalize_postgres_uri(dsn)
    } else {
        normalize_postgres_libpq(dsn)
    }
}

/// Convert Go-style MySQL DSN `user:pass@tcp(host:3306)/db` to `mysql://` URL when needed.
fn normalize_mysql_dsn(dsn: &str) -> Result<String, String> {
    let dsn = dsn.trim();
    if dsn.starts_with("mysql://") {
        return Ok(dsn.to_string());
    }
    // user:pass@tcp(HOST:PORT)/DATABASE
    if let Some(at) = dsn.find("@tcp(") {
        let userpass = &dsn[..at];
        let after_tcp = &dsn[at + 5..]; // after "@tcp("
        if let Some(close) = after_tcp.find(")/") {
            let host_port = &after_tcp[..close];
            let database = &after_tcp[close + 2..];
            let (user, pass) = userpass
                .split_once(':')
                .map(|(u, p)| (u, p))
                .ok_or_else(|| "invalid MySQL DSN (expected user:pass@tcp(...))".to_string())?;
            return Ok(format!(
                "mysql://{}:{}@{}/{}",
                urlencode_userinfo(user),
                urlencode_userinfo(pass),
                host_port,
                database
            ));
        }
    }
    Err(
        "unsupported MySQL DSN (use mysql://user:pass@host:3306/db or user:pass@tcp(host:3306)/db)"
            .into(),
    )
}

fn urlencode_userinfo(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            ':' | '@' | '/' | '?' | '#' | '[' | ']' => {
                out.push_str(&format!("%{:02X}", c as u8));
            }
            _ => out.push(c),
        }
    }
    out
}

fn pg_cell_to_string(row: &Row, idx: usize) -> String {
    match row.try_get::<_, Option<String>>(idx) {
        Ok(None) => return "NULL".to_string(),
        Ok(Some(v)) => return v,
        Err(_) => {}
    }
    if let Ok(v) = row.try_get::<_, Option<i16>>(idx) {
        return v
            .map(|x| x.to_string())
            .unwrap_or_else(|| "NULL".to_string());
    }
    if let Ok(v) = row.try_get::<_, Option<i32>>(idx) {
        return v
            .map(|x| x.to_string())
            .unwrap_or_else(|| "NULL".to_string());
    }
    if let Ok(v) = row.try_get::<_, Option<i64>>(idx) {
        return v
            .map(|x| x.to_string())
            .unwrap_or_else(|| "NULL".to_string());
    }
    if let Ok(v) = row.try_get::<_, Option<f32>>(idx) {
        return v
            .map(|x| x.to_string())
            .unwrap_or_else(|| "NULL".to_string());
    }
    if let Ok(v) = row.try_get::<_, Option<f64>>(idx) {
        return v
            .map(|x| x.to_string())
            .unwrap_or_else(|| "NULL".to_string());
    }
    if let Ok(v) = row.try_get::<_, Option<bool>>(idx) {
        return v
            .map(|x| x.to_string())
            .unwrap_or_else(|| "NULL".to_string());
    }
    if let Ok(v) = row.try_get::<_, Option<NaiveDateTime>>(idx) {
        return v
            .map(|x| x.to_string())
            .unwrap_or_else(|| "NULL".to_string());
    }
    if let Ok(v) = row.try_get::<_, Option<NaiveDate>>(idx) {
        return v
            .map(|x| x.to_string())
            .unwrap_or_else(|| "NULL".to_string());
    }
    if let Ok(v) = row.try_get::<_, Option<Vec<u8>>>(idx) {
        return v
            .map(|b| format!("<binary {} bytes>", b.len()))
            .unwrap_or_else(|| "NULL".to_string());
    }
    "(unprintable)".to_string()
}

fn format_pg_rows(rows: &[Row]) -> String {
    if rows.is_empty() {
        return "Query returned 0 rows.".to_string();
    }
    let cols: Vec<String> = rows[0]
        .columns()
        .iter()
        .map(|c| c.name().to_string())
        .collect();
    let mut out = String::new();
    out.push_str(&format!(
        "Query returned {} rows, {} columns:\n\n",
        rows.len(),
        cols.len()
    ));
    out.push_str(&cols.join(" | "));
    out.push('\n');
    out.push_str(&"-".repeat(80));
    out.push('\n');
    for row in rows {
        let mut vals = Vec::new();
        for i in 0..row.len() {
            vals.push(pg_cell_to_string(row, i));
        }
        out.push_str(&vals.join(" | "));
        out.push('\n');
    }
    out
}

fn run_postgres(dsn: &str, query: &str) -> Result<String, String> {
    let dsn = normalize_postgres_dsn(dsn)?;
    let mut client =
        Client::connect(&dsn, NoTls).map_err(|e| format!("postgres connect failed: {e}"))?;
    let rows = client
        .query(query, &[])
        .map_err(|e| format!("query failed: {e}"))?;
    Ok(format_pg_rows(&rows))
}

fn mysql_value_to_string(v: mysql::Value) -> String {
    match v {
        mysql::Value::NULL => "NULL".to_string(),
        mysql::Value::Bytes(b) => String::from_utf8_lossy(&b).into_owned(),
        mysql::Value::Int(i) => i.to_string(),
        mysql::Value::UInt(u) => u.to_string(),
        mysql::Value::Float(f) => f.to_string(),
        mysql::Value::Double(f) => f.to_string(),
        mysql::Value::Date(y, mo, d, h, mi, s, us) => format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:06}",
            y, mo, d, h, mi, s, us
        ),
        mysql::Value::Time(is_neg, d, h, mi, s, us) => {
            format!("time (neg={is_neg}) {d}d {h}:{mi}:{s}.{us}")
        }
    }
}

fn run_mysql(dsn: &str, query: &str) -> Result<String, String> {
    use mysql::prelude::Queryable;

    let url = normalize_mysql_dsn(dsn)?;
    let opts = mysql::Opts::from_url(&url).map_err(|e| format!("invalid MySQL URL: {e}"))?;
    let pool = mysql::Pool::new(opts).map_err(|e| format!("mysql pool: {e}"))?;
    let mut conn = pool.get_conn().map_err(|e| format!("mysql connect: {e}"))?;

    let mut result = conn
        .query_iter(query)
        .map_err(|e| format!("query failed: {e}"))?;

    let cols: Vec<String> = result
        .columns()
        .as_ref()
        .iter()
        .map(|c| c.name_str().to_string())
        .collect();

    let mut rows_out: Vec<Vec<String>> = Vec::new();
    for row in result.by_ref() {
        let row = row.map_err(|e| format!("row: {e}"))?;
        let mut line = Vec::with_capacity(row.len());
        for i in 0..row.len() {
            let v: mysql::Value = row
                .get::<mysql::Value, usize>(i)
                .unwrap_or(mysql::Value::NULL);
            line.push(mysql_value_to_string(v));
        }
        rows_out.push(line);
    }

    if rows_out.is_empty() {
        return Ok(if cols.is_empty() {
            "Query returned 0 rows.".to_string()
        } else {
            format!(
                "Query returned 0 rows, {} columns:\n\n{}",
                cols.len(),
                cols.join(" | ")
            )
        });
    }

    let mut out = String::new();
    out.push_str(&format!(
        "Query returned {} rows, {} columns:\n\n",
        rows_out.len(),
        cols.len()
    ));
    out.push_str(&cols.join(" | "));
    out.push('\n');
    out.push_str(&"-".repeat(80));
    out.push('\n');
    for line in rows_out {
        out.push_str(&line.join(" | "));
        out.push('\n');
    }
    Ok(out)
}

#[tauri::command]
pub fn run_client_db_query(params: Value) -> Result<String, String> {
    eprintln!("[db_query] invoked");

    let obj = params
        .as_object()
        .ok_or_else(|| "params must be a JSON object".to_string())?;

    let driver = str_arg(obj, &["driver", "db_type", "database_type"]);
    let dsn = str_arg(obj, &["dsn", "connection_string", "conn"]);
    let query = str_arg(obj, &["query", "sql", "statement"]);

    if driver.is_empty() {
        return Err("missing driver (mysql or postgres)".to_string());
    }
    if dsn.is_empty() {
        return Err("missing DSN (connection string)".to_string());
    }
    if query.is_empty() {
        return Err("missing query".to_string());
    }

    if !is_safe_sql(&query) {
        return Err("query contains blocked keywords (SELECT and EXPLAIN only)".to_string());
    }

    let driver_type = normalize_driver(&driver);
    eprintln!("[db_query] driver={}, query={}", driver_type, query);

    let output = match driver_type {
        "postgres" => run_postgres(&dsn, &query),
        "mysql" => run_mysql(&dsn, &query),
        _ => Err(format!("unsupported driver: {}", driver)),
    }?;

    eprintln!("[db_query] result lines={}", output.lines().count());
    Ok(format!("Query result:\n{}", output))
}
