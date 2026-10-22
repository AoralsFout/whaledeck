//! 联网元数据：Bangumi / VNDB / 月幕 检索、响应归一化与封面下载。
//!
//! 只使用公开接口，用户主动触发；图片只允许三家图床且限制大小。
//! 对应文档：docs/后端实现.md §9、docs/产品定义.md §6。
use crate::models::MetaItem;
use serde_json::Value;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const UA: &str = "WhaleDeck/0.3 (local game library; https://github.com/shasha111250/whaledeck)";
const YMGAL_CLIENT_ID: &str = "ymgal";
const YMGAL_CLIENT_SECRET: &str = "luna0327";
const YMGAL_TOKEN_TTL: Duration = Duration::from_secs(50 * 60);

static YMGAL_TOKEN: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(UA)
        .build()
        .map_err(|e| format!("初始化网络客户端失败：{e}"))
}

fn net_err(source: &str, err: reqwest::Error) -> String {
    if err.is_timeout() {
        format!("{source} 连接超时，请检查网络后重试")
    } else if err.is_connect() {
        format!("{source} 无法连接，可能是网络或代理问题")
    } else {
        format!("{source} 请求失败：{err}")
    }
}

pub fn percent_encode(input: &str) -> String {
    let mut out = String::new();
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// 只允许从这几家数据源的图床下载，避免被随意 URL 利用。
pub fn is_allowed_image_url(url: &str) -> bool {
    url.starts_with("https://lain.bgm.tv/")
        || url.starts_with("https://t.vndb.org/")
        || url.starts_with("https://cdn.ymgal.games/")
}

/// 按来源分发检索；关键词为空直接报错，不发起请求。
pub async fn search(source: &str, keyword: &str) -> Result<Vec<MetaItem>, String> {
    let keyword = keyword.trim();
    if keyword.is_empty() {
        return Err("请输入要搜索的名称".into());
    }
    match source {
        "bangumi" => search_bangumi(keyword).await,
        "vndb" => search_vndb(keyword).await,
        "ymgal" => search_ymgal(keyword).await,
        other => Err(format!("不支持的数据源：{other}")),
    }
}

fn parse_bangumi(value: &Value) -> Vec<MetaItem> {
    let Some(list) = value.get("data").and_then(|d| d.as_array()) else {
        return Vec::new();
    };
    list.iter()
        .map(|item| {
            let id = item
                .get("id")
                .and_then(|v| v.as_u64())
                .map(|v| v.to_string())
                .unwrap_or_default();
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let name_cn = item.get("name_cn").and_then(|v| v.as_str()).unwrap_or("");
            let title = if name_cn.trim().is_empty() {
                name
            } else {
                name_cn
            };
            MetaItem {
                source: "bangumi".into(),
                id,
                title: title.to_string(),
                subtitle: if title == name {
                    String::new()
                } else {
                    name.to_string()
                },
                cover_url: item
                    .get("images")
                    .and_then(|i| i.get("large"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                release_date: item
                    .get("date")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                developer: String::new(),
                summary: item
                    .get("summary")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                rating: item
                    .get("rating")
                    .and_then(|r| r.get("score"))
                    .and_then(|v| v.as_f64()),
            }
        })
        .collect()
}

async fn search_bangumi(keyword: &str) -> Result<Vec<MetaItem>, String> {
    let body = serde_json::json!({
        "keyword": keyword,
        "filter": { "type": [4] },
        "limit": 10
    });
    let resp = client()?
        .post("https://api.bgm.tv/v0/search/subjects")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| net_err("Bangumi", e))?;
    if !resp.status().is_success() {
        return Err(format!("Bangumi 返回 HTTP {}", resp.status()));
    }
    let value: Value = resp.json().await.map_err(|e| net_err("Bangumi", e))?;
    Ok(parse_bangumi(&value))
}

fn parse_vndb(value: &Value) -> Vec<MetaItem> {
    let Some(list) = value.get("results").and_then(|d| d.as_array()) else {
        return Vec::new();
    };
    list.iter()
        .map(|item| {
            let developers = item
                .get("developers")
                .and_then(|d| d.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|d| d.get("name").and_then(|n| n.as_str()))
                        .collect::<Vec<_>>()
                        .join("、")
                })
                .unwrap_or_default();
            MetaItem {
                source: "vndb".into(),
                id: item
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                title: item
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                subtitle: item
                    .get("alttitle")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                cover_url: item
                    .get("image")
                    .and_then(|i| i.get("url"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                release_date: item
                    .get("released")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                developer: developers,
                summary: item
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                rating: item.get("rating").and_then(|v| v.as_f64()),
            }
        })
        .collect()
}

async fn search_vndb(keyword: &str) -> Result<Vec<MetaItem>, String> {
    let body = serde_json::json!({
        "filters": ["search", "=", keyword],
        "fields": "id,title,alttitle,image.url,released,rating,description,developers.name",
        "results": 10
    });
    let resp = client()?
        .post("https://api.vndb.org/kana/vn")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| net_err("VNDB", e))?;
    if !resp.status().is_success() {
        return Err(format!("VNDB 返回 HTTP {}", resp.status()));
    }
    let value: Value = resp.json().await.map_err(|e| net_err("VNDB", e))?;
    Ok(parse_vndb(&value))
}

/// 获取月幕 token：进程内缓存 50 分钟；失败时返回可展示的中文错误。
async fn ymgal_token() -> Result<String, String> {
    if let Some((token, obtained)) = YMGAL_TOKEN.lock().unwrap().clone() {
        if obtained.elapsed() < YMGAL_TOKEN_TTL {
            return Ok(token);
        }
    }
    let url = format!(
        "https://www.ymgal.games/oauth/token?grant_type=client_credentials&client_id={YMGAL_CLIENT_ID}&client_secret={YMGAL_CLIENT_SECRET}&scope=public"
    );
    let resp = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| net_err("月幕", e))?;
    if !resp.status().is_success() {
        return Err(format!("月幕获取 token 失败（HTTP {}）", resp.status()));
    }
    let value: Value = resp.json().await.map_err(|e| net_err("月幕", e))?;
    let token = value
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "月幕返回的 token 格式不正确".to_string())?
        .to_string();
    *YMGAL_TOKEN.lock().unwrap() = Some((token.clone(), Instant::now()));
    Ok(token)
}

fn parse_ymgal(value: &Value) -> Vec<MetaItem> {
    let Some(list) = value
        .get("data")
        .and_then(|d| d.get("result"))
        .and_then(|d| d.as_array())
    else {
        return Vec::new();
    };
    list.iter()
        .map(|item| {
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let chinese = item
                .get("chineseName")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let title = if chinese.trim().is_empty() {
                name
            } else {
                chinese
            };
            let score = item
                .get("score")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<f64>().ok())
                .filter(|n| *n > 0.0);
            MetaItem {
                source: "ymgal".into(),
                id: item
                    .get("id")
                    .and_then(|v| v.as_u64())
                    .map(|v| v.to_string())
                    .unwrap_or_default(),
                title: title.to_string(),
                subtitle: if title == name {
                    String::new()
                } else {
                    name.to_string()
                },
                cover_url: item
                    .get("mainImg")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string()),
                release_date: item
                    .get("releaseDate")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                developer: item
                    .get("orgName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                summary: String::new(),
                rating: score,
            }
        })
        .collect()
}

async fn search_ymgal(keyword: &str) -> Result<Vec<MetaItem>, String> {
    let token = ymgal_token().await?;
    let url = format!(
        "https://www.ymgal.games/open/archive/search-game?mode=list&keyword={}&pageNum=1&pageSize=10",
        percent_encode(keyword)
    );
    let resp = client()?
        .get(url)
        .header("Accept", "application/json;charset=utf-8")
        .header("Authorization", format!("Bearer {token}"))
        .header("version", "1")
        .send()
        .await
        .map_err(|e| net_err("月幕", e))?;
    if !resp.status().is_success() {
        return Err(format!("月幕返回 HTTP {}", resp.status()));
    }
    let value: Value = resp.json().await.map_err(|e| net_err("月幕", e))?;
    if value.get("success").and_then(|v| v.as_bool()) == Some(false) {
        let msg = value
            .get("msg")
            .and_then(|v| v.as_str())
            .unwrap_or("未知错误");
        return Err(format!("月幕：{msg}"));
    }
    Ok(parse_ymgal(&value))
}

/// 下载封面，返回 (字节, 扩展名)。
pub async fn download_image(url: &str) -> Result<(Vec<u8>, String), String> {
    if !is_allowed_image_url(url) {
        return Err("封面地址不在允许的数据源域名内".into());
    }
    let resp = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| net_err("封面下载", e))?;
    if !resp.status().is_success() {
        return Err(format!("封面下载失败（HTTP {}）", resp.status()));
    }
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let ext = if content_type.contains("png") {
        "png"
    } else if content_type.contains("webp") {
        "webp"
    } else if content_type.contains("gif") {
        "gif"
    } else {
        "jpg"
    };
    let bytes = resp.bytes().await.map_err(|e| net_err("封面下载", e))?;
    if bytes.len() > 12 * 1024 * 1024 {
        return Err("封面图片超过 12MB，已取消".into());
    }
    Ok((bytes.to_vec(), ext.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_query() {
        assert_eq!(percent_encode("CLANNAD"), "CLANNAD");
        assert_eq!(percent_encode("月姬"), "%E6%9C%88%E5%A7%AC");
        assert_eq!(percent_encode("a b"), "a%20b");
    }

    #[test]
    fn only_allows_known_image_hosts() {
        assert!(is_allowed_image_url(
            "https://lain.bgm.tv/pic/cover/l/1.jpg"
        ));
        assert!(is_allowed_image_url("https://t.vndb.org/cv/1.jpg"));
        assert!(is_allowed_image_url("https://cdn.ymgal.games/a.webp"));
        assert!(!is_allowed_image_url("https://evil.example.com/a.jpg"));
        assert!(!is_allowed_image_url("http://lain.bgm.tv/a.jpg"));
    }

    #[test]
    fn parses_bangumi_payload() {
        let value: Value = serde_json::from_str(
            r#"{"data":[{"id":13,"name":"CLANNAD","name_cn":"","date":"2004-04-28","summary":"...","images":{"large":"https://lain.bgm.tv/x.jpg"},"rating":{"score":8.9}}]}"#,
        )
        .unwrap();
        let items = parse_bangumi(&value);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "CLANNAD");
        assert_eq!(items[0].release_date, "2004-04-28");
        assert_eq!(items[0].rating, Some(8.9));
        assert_eq!(
            items[0].cover_url.as_deref(),
            Some("https://lain.bgm.tv/x.jpg")
        );
    }

    #[test]
    fn parses_vndb_payload() {
        let value: Value = serde_json::from_str(
            r#"{"results":[{"id":"v4","title":"CLANNAD","alttitle":"クラナド","image":{"url":"https://t.vndb.org/cv/95/75895.jpg"},"released":"2004-04-28","rating":87.3,"developers":[{"id":"p1","name":"Key"}]}]}"#,
        )
        .unwrap();
        let items = parse_vndb(&value);
        assert_eq!(items[0].title, "CLANNAD");
        assert_eq!(items[0].subtitle, "クラナド");
        assert_eq!(items[0].developer, "Key");
        assert_eq!(items[0].rating, Some(87.3));
    }

    #[test]
    fn parses_ymgal_payload() {
        let value: Value = serde_json::from_str(
            r#"{"success":true,"data":{"result":[{"id":10008,"name":"CLANNAD","chineseName":"CLANNAD","mainImg":"https://cdn.ymgal.games/x.webp","releaseDate":"2004-04-28","orgName":"Key","score":"8.9"}]}}"#,
        )
        .unwrap();
        let items = parse_ymgal(&value);
        assert_eq!(items[0].title, "CLANNAD");
        assert_eq!(items[0].developer, "Key");
        assert_eq!(items[0].rating, Some(8.9));
    }

    #[test]
    fn empty_payload_is_safe() {
        assert!(parse_bangumi(&serde_json::json!({})).is_empty());
        assert!(parse_vndb(&serde_json::json!({})).is_empty());
        assert!(parse_ymgal(&serde_json::json!({})).is_empty());
    }

    /// 手动执行的联网冒烟测试：`cargo test -- --ignored live_search_smoke`
    #[test]
    #[ignore]
    fn live_search_smoke() {
        for source in ["bangumi", "vndb", "ymgal"] {
            let items = tauri::async_runtime::block_on(search(source, "CLANNAD"))
                .unwrap_or_else(|e| panic!("{source} 搜索失败：{e}"));
            assert!(!items.is_empty(), "{source} 没有返回结果");
            assert!(
                items.iter().all(|i| !i.title.trim().is_empty()),
                "{source} 存在空标题"
            );
            println!("{source}: {} 条，首条 = {}", items.len(), items[0].title);
        }
    }
}
