//! Typed ReCast approvals. This path never accepts transaction bytes or arbitrary messages.
use super::{field, hd_file, legacy, unlocked, Result};
use ed25519_dalek::{Signer, SigningKey};
use requant_consensus::{
    address::{address, parse_address},
    params::Network,
};
use requant_wallet_portable as wallet;
use serde_json::{json, Value};
use zeroize::Zeroizing;

fn hex32(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn quote(v: &Value, name: &str) -> Result<String> {
    Ok(serde_json::to_string(field(v, name)?)
        .map_err(|_| "Invalid channel text.")?
        .replace('&', "\\u0026")
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029"))
}
fn channel_message(d: &Value, owner: &str) -> Result<String> {
    if d.as_object().map(|m| m.len()) != Some(7) || field(d, "id")? != owner {
        return Err("Select the wallet that owns this channel.".into());
    }
    let version = d["version"]
        .as_u64()
        .filter(|n| *n > 0 && *n < (1u64 << 53))
        .ok_or("Invalid channel version.")?;
    let slug = field(d, "slug")?;
    let name = field(d, "name")?;
    let description = field(d, "description")?;
    let language = field(d, "language")?;
    let payout = field(d, "payout_address")?;
    if !(3..=32).contains(&slug.len())
        || !slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        || slug.starts_with('-')
        || slug.ends_with('-')
        || name.trim() != name
        || name.is_empty()
        || name.chars().count() > 80
        || description.chars().count() > 2000
    {
        return Err("Invalid channel fields.".into());
    }
    let tags: Vec<_> = language.split('-').collect();
    if language.len() > 35
        || !(2..=3).contains(&tags[0].len())
        || !tags[0].bytes().all(|b| b.is_ascii_lowercase())
        || tags[1..]
            .iter()
            .any(|t| !(2..=8).contains(&t.len()) || !t.bytes().all(|b| b.is_ascii_alphanumeric()))
    {
        return Err("Invalid channel language.".into());
    }
    if !payout.is_empty() {
        parse_address(&Network::test(), payout).map_err(|_| "Invalid testnet payout address.")?;
    }
    Ok(format!("ReCast channel v1\nNetwork: test\n{{\"id\":{},\"version\":{},\"slug\":{},\"name\":{},\"description\":{},\"language\":{},\"payout_address\":{}}}",quote(d,"id")?,version,quote(d,"slug")?,quote(d,"name")?,quote(d,"description")?,quote(d,"language")?,quote(d,"payout_address")?))
}
pub fn approve(v: &Value) -> Result<Value> {
    let r = &v["request"];
    if serde_json::to_string(r)
        .map_err(|_| "Invalid request.")?
        .len()
        > 16384
        || r["protocol"] != "recast-connect-v1"
        || r["network"] != "test"
        || !hex32(field(r, "id")?)
    {
        return Err("Unsupported ReCast request.".into());
    }
    let origin = field(r, "origin")?;
    let host = origin
        .strip_prefix("https://")
        .or_else(|| origin.strip_prefix("http://127.0.0.1:"))
        .or_else(|| origin.strip_prefix("http://localhost:"));
    if origin.len() > 255
        || host.is_none()
        || host.unwrap().is_empty()
        || host
            .unwrap()
            .chars()
            .any(|c| c.is_whitespace() || "/?#@\\".contains(c))
        || field(v, "source_origin")? != origin
    {
        return Err("ReCast origin does not match its connection URL.".into());
    }
    let expiry = r["expires_at"].as_u64().ok_or("Invalid expiry.")?;
    let now = v["now"].as_u64().ok_or("Missing current time.")?;
    if expiry <= now || expiry > now + 330 {
        return Err("ReCast request expired. Connect again.".into());
    }
    let text = field(v, "file")?;
    let password = field(v, "password")?;
    let file: Value = serde_json::from_str(text).map_err(|_| "Invalid wallet file.")?;
    let key = if let Some((encrypted, owner)) = legacy(&file)? {
        let secret = Zeroizing::new(
            wallet::decrypt_key(&encrypted, Some(password))
                .map_err(|_| "Wrong password or damaged key file.")?,
        );
        let key = SigningKey::from_bytes(&secret);
        if wallet::owner_of(&key) != owner {
            return Err("Key metadata mismatch.".into());
        }
        key
    } else {
        if hd_file(text)?.watch_only() {
            return Err("A watch-only wallet cannot approve sign-in.".into());
        }
        let (w, seed) = unlocked(text, password)?;
        w.keyring(&seed)
            .remove(&w.receive[0])
            .ok_or("Wallet signing key is unavailable.")?
    };
    let pk = hex::encode(key.verifying_key().as_bytes());
    let message = match field(r, "intent")? {
        "login" => {
            if !r["document"].is_null() {
                return Err("Login cannot contain a channel update.".into());
            }
            format!("ReCast authentication v1\nOrigin: {}\nNetwork: test\nPublic key: {}\nNonce: {}\nExpires: {}",origin,pk,field(r,"id")?,expiry)
        }
        "channel" => {
            if r["owner"] != pk {
                return Err("Select the wallet that owns this channel.".into());
            }
            channel_message(&r["document"], &pk)?
        }
        _ => return Err("Unsupported ReCast approval purpose.".into()),
    };
    Ok(
        json!({"public_key":pk,"signature":hex::encode(key.sign(message.as_bytes()).to_bytes()),"address":address(&Network::test(),&wallet::owner_of(&key)),"message":message}),
    )
}
