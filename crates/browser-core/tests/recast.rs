use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use requant_browser_core::{comparison_code, execute};
use requant_consensus::params::Network;
use requant_wallet_portable::{hd, wallet::WalletFile};
use serde_json::{json, Value};
const PASS: &str = "unfunded-fixture-password-only";
fn fixture() -> Value {
    let file = WalletFile::new(&Network::test(), &[0; 32], Some(PASS), &[1; 16], &[2; 24]).unwrap();
    json!({"file":file.to_text(),"password":PASS,"comparison_code":"228355","now":1800000000u64,"source_origin":"https://recast.example","request":{"protocol":"recast-connect-v1","id":"ab".repeat(32),"origin":"https://recast.example","network":"test","expires_at":1800000300u64,"intent":"login","document":null,"owner":""}})
}
fn call(v: &Value) -> Result<Value, String> {
    serde_json::from_str(&execute("recastApprove", &v.to_string())?).map_err(|e| e.to_string())
}
#[test]
fn wallet_ownership_and_channel_bytes_are_real_signatures() {
    let mut v = fixture();
    let login = call(&v).unwrap();
    let pk: [u8; 32] = hex::decode(login["public_key"].as_str().unwrap())
        .unwrap()
        .try_into()
        .unwrap();
    let key = VerifyingKey::from_bytes(&pk).unwrap();
    let signature =
        Signature::from_slice(&hex::decode(login["signature"].as_str().unwrap()).unwrap()).unwrap();
    key.verify(login["message"].as_str().unwrap().as_bytes(), &signature)
        .unwrap();
    let text = v["file"].as_str().unwrap();
    assert!(!login.to_string().contains(text));
    assert!(!login.to_string().contains(PASS));
    v["request"]["intent"] = json!("channel");
    v["request"]["owner"] = login["public_key"].clone();
    v["request"]["document"] = json!({"id":login["public_key"],"version":1,"slug":"test-channel","name":"Русский <&>","description":"art\u{2028}music","language":"ru","payout_address":""});
    v["comparison_code"] = json!(comparison_code(&v["request"]).unwrap());
    let channel = call(&v).unwrap();
    let message = channel["message"].as_str().unwrap();
    assert!(message.contains("\\u003c\\u0026\\u003e"));
    assert!(message.contains("\\u2028"));
    assert!(message.starts_with("ReCast channel v1\nNetwork: test\n{\"id\":"));
    let signature =
        Signature::from_slice(&hex::decode(channel["signature"].as_str().unwrap()).unwrap())
            .unwrap();
    key.verify(message.as_bytes(), &signature).unwrap();
    v["request"]["owner"] = json!("00".repeat(32));
    assert!(call(&v).is_err());
}
#[test]
fn expiry_origin_network_and_purpose_fail_closed() {
    let v = fixture();
    for (field, value) in [
        ("expires_at", json!(1800000000u64)),
        ("expires_at", json!(1800000400u64)),
        ("origin", json!("https://evil.example")),
        ("network", json!("main")),
        ("intent", json!("sendTransaction")),
        ("id", json!("invalid")),
    ] {
        let mut bad = v.clone();
        bad["request"][field] = value;
        assert!(call(&bad).is_err(), "{field}");
    }
    let mut bad = v.clone();
    bad["password"] = json!("wrong");
    assert!(call(&bad).is_err());
    let watch = WalletFile::new(&Network::test(), &[0; 32], None, &[1; 16], &[2; 24]).unwrap();
    let mut bad = v.clone();
    bad["file"] = json!(watch.watch_copy().to_text());
    assert!(call(&bad).is_err());
    let mut bad = v.clone();
    bad["request"]["document"] = json!({"unsigned_transaction":"00"});
    assert!(call(&bad).is_err());
    let phrase = hd::phrase_of(&[0; 32]);
    assert!(!call(&v).unwrap().to_string().contains(phrase.as_str()));
}

#[test]
fn comparison_matches_the_browser_vector_and_requires_user_input() {
    let v = fixture();
    assert_eq!(comparison_code(&v["request"]).unwrap(), "228355");
    for code in [serde_json::Value::Null, json!("000000"), json!(228355)] {
        let mut wrong = v.clone();
        wrong["comparison_code"] = code;
        assert!(call(&wrong).is_err());
    }
    let mut channel = v.clone();
    channel["request"]["intent"] = json!("channel");
    assert_eq!(comparison_code(&channel["request"]).unwrap(), "950127");
}
