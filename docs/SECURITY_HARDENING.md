# Wallet security rollout

Version 0.5.3 prepares these changes; this source change does not publish installers or activate node policy.

- Portable wallet planners and the native transfer planner discard change below 1000 atoms. The discarded amount is included in the displayed fee before confirmation. Signing refuses an old review that omitted that extra fee. Exact payment value, integer precision, input validation and recovery formats are retained.
- Imported Argon2 parameters are rejected before allocation when memory exceeds 131072 KiB, passes exceed 6 or lanes exceed 4. Existing stricter browser import bounds remain. Creation parameters stay at 65536 KiB, three passes and one lane. The upstream source also lacked these import bounds, so the paired ReQuant PR adds them there instead of claiming they were already present.
- Android's main activity sets `FLAG_SECURE` before `super.onCreate`. It covers the entire wallet window, including recovery phrases, across screen transitions. This also disables screenshots elsewhere in that activity; public-address sharing still uses the existing native share flow. Preparation fails if the generated activity layout changes. See [Android guidance](https://developer.android.com/security/fraud-prevention/activities#flag_secure).
- ReCast approval requires entering the six-digit code displayed by ReCast. The wallet derives it locally from origin/network/pairing ID/intent/expiry and checks it before decrypting/signing. The v1 signed message remains compatible. Update all trusted wallet clients to gain this UI check.
- Signed executable delivery is described in [Signed releases](SIGNED_RELEASES.md).

Release native, web and extension builds together. Verify a 999-atom remainder is shown as extra fee, a 1000-atom remainder stays as change, existing encrypted backups restore, comparison-code approvals work, and Android prevents capture on the actual target device. Only then consider the operator-gated relay policy in the ReQuant node PR. No network policy or live installation is changed here.
